/**
 * Posting rules: turn business events into balanced journal lines by account
 * *role* (resolved to the organization's account ids at posting time).
 *
 * These rules encode the corrections to the RetailNexa prototype's accounting
 * (docs/REQUIREMENTS_INVENTORY.md, "Accounting problems in prototype C"):
 *   - inventory purchases are an ASSET (inventory), not an expense;
 *   - cost of goods sold is recognised when items sell;
 *   - paying a bill moves cash and reduces payables; it is not a new expense;
 *   - sales tax collected is a LIABILITY and paying it is not an expense;
 *   - owner draws/distributions are EQUITY, never expenses;
 *   - card deposits clear the card receivable and expose processing fees.
 * All amounts are integer cents.
 */

export type AccountRole =
  | 'cash_on_hand' | 'bank' | 'card_clearing' | 'accounts_receivable' | 'inventory'
  | 'accounts_payable' | 'sales_tax_payable' | 'payroll_liabilities' | 'customer_credits'
  | 'owner_equity' | 'owner_draws' | 'retained_earnings'
  | 'sales' | 'sales_discounts' | 'other_income'
  | 'cogs' | 'inventory_adjustments' | 'payroll' | 'rent' | 'utilities' | 'card_fees'
  | 'other_operating' | 'interest' | 'other_expense' | 'income_taxes';

export type ExpenseRole = Extract<AccountRole, 'payroll' | 'rent' | 'utilities' | 'card_fees' | 'other_operating' | 'interest' | 'other_expense' | 'income_taxes'>;

export interface RoleLine {
  role: AccountRole;
  debitCents: number;
  creditCents: number;
  memo?: string;
}

export class PostingError extends Error {}

const cents = (n: number, name: string) => {
  if (!Number.isInteger(n) || n < 0) throw new PostingError(`${name} must be a non-negative whole number of cents`);
  return n;
};
const dr = (role: AccountRole, amount: number, memo?: string): RoleLine => ({ role, debitCents: amount, creditCents: 0, memo });
const cr = (role: AccountRole, amount: number, memo?: string): RoleLine => ({ role, debitCents: 0, creditCents: amount, memo });

/** Drops zero lines and checks the entry balances (same rules the database enforces). */
export function finalize(lines: RoleLine[]): RoleLine[] {
  const out = lines.filter((l) => l.debitCents > 0 || l.creditCents > 0);
  for (const l of out) {
    if ((l.debitCents > 0) === (l.creditCents > 0)) throw new PostingError('each line is either a debit or a credit');
  }
  const d = out.reduce((a, l) => a + l.debitCents, 0);
  const c = out.reduce((a, l) => a + l.creditCents, 0);
  if (out.length < 2) throw new PostingError('an entry needs at least two lines');
  if (d !== c) throw new PostingError(`entry does not balance: debits ${d} vs credits ${c}`);
  return out;
}

export interface DailySalesInput {
  /** Sales before discounts, excluding tax. */
  grossSalesCents: number;
  discountsCents: number;
  salesTaxCents: number;
  /** Tender totals (must equal gross − discounts + tax). */
  cashCents: number;
  cardCents: number;
  /** Store credit / gift card redemptions used as tender. */
  customerCreditCents?: number;
}

/** A register's day (Z-report). Revenue excludes tax; tax goes to a liability. */
export function dailySales(i: DailySalesInput): RoleLine[] {
  const gross = cents(i.grossSalesCents, 'gross sales');
  const disc = cents(i.discountsCents, 'discounts');
  const tax = cents(i.salesTaxCents, 'sales tax');
  const cash = cents(i.cashCents, 'cash');
  const card = cents(i.cardCents, 'card');
  const credit = cents(i.customerCreditCents ?? 0, 'customer credit');
  if (cash + card + credit !== gross - disc + tax) {
    throw new PostingError(`tenders (${cash + card + credit}) must equal sales − discounts + tax (${gross - disc + tax})`);
  }
  return finalize([
    dr('cash_on_hand', cash, 'Cash sales'),
    dr('card_clearing', card, 'Card sales awaiting deposit'),
    dr('customer_credits', credit, 'Store credit redeemed'),
    dr('sales_discounts', disc, 'Discounts'),
    cr('sales', gross, 'Sales'),
    cr('sales_tax_payable', tax, 'Sales tax collected'),
  ]);
}

/** Cost of the items sold (from inventory cost layers / imported cost). */
export function costOfGoodsSold(costCents: number): RoleLine[] {
  const c = cents(costCents, 'cost');
  return finalize([dr('cogs', c, 'Cost of goods sold'), cr('inventory', c, 'Inventory sold')]);
}

/** A vendor bill for stock: increases inventory (asset) and what we owe. */
export function inventoryBill(totalCents: number, freightCents = 0): RoleLine[] {
  const t = cents(totalCents, 'bill total');
  const f = cents(freightCents, 'freight');
  if (f > t) throw new PostingError('freight cannot exceed the bill total');
  // Freight-in is part of landed inventory cost.
  return finalize([dr('inventory', t, 'Stock received (incl. freight)'), cr('accounts_payable', t, 'Owed to vendor')]);
}

/** A bill for an operating expense (rent, utilities, …). */
export function expenseBill(role: ExpenseRole, amountCents: number): RoleLine[] {
  const a = cents(amountCents, 'amount');
  return finalize([dr(role, a), cr('accounts_payable', a, 'Owed to vendor')]);
}

/** Paying a bill: settles the payable; not an expense in itself. */
export function billPayment(amountCents: number, from: 'bank' | 'cash_on_hand' = 'bank'): RoleLine[] {
  const a = cents(amountCents, 'amount');
  return finalize([dr('accounts_payable', a, 'Bill paid'), cr(from, a, 'Payment')]);
}

/** Card processor deposit: gross card sales minus fees lands in the bank. */
export function cardDeposit(grossCents: number, feesCents: number): RoleLine[] {
  const g = cents(grossCents, 'gross');
  const f = cents(feesCents, 'fees');
  if (f > g) throw new PostingError('fees cannot exceed the gross deposit');
  return finalize([dr('bank', g - f, 'Card deposit'), dr('card_fees', f, 'Processing fees'), cr('card_clearing', g, 'Card sales settled')]);
}

/** Paying collected sales tax to the state: reduces the liability. */
export function salesTaxPayment(amountCents: number): RoleLine[] {
  const a = cents(amountCents, 'amount');
  return finalize([dr('sales_tax_payable', a, 'Sales tax remitted'), cr('bank', a)]);
}

/** Owner draw / partner distribution: equity, never an expense. */
export function ownerDraw(amountCents: number, from: 'bank' | 'cash_on_hand' = 'bank'): RoleLine[] {
  const a = cents(amountCents, 'amount');
  return finalize([dr('owner_draws', a, 'Owner draw'), cr(from, a)]);
}

/** Moving cash from the drawer/safe to the bank. */
export function cashDeposit(amountCents: number): RoleLine[] {
  const a = cents(amountCents, 'amount');
  return finalize([dr('bank', a, 'Cash deposited'), cr('cash_on_hand', a)]);
}

/** Resolves roles to the organization's account ids for post_journal_entry. */
export function toAccountLines(lines: RoleLine[], accountByRole: Partial<Record<AccountRole, string>>) {
  return lines.map((l) => {
    const id = accountByRole[l.role];
    if (!id) throw new PostingError(`no account is set up for “${l.role}”`);
    return { account_id: id, debit_cents: l.debitCents, credit_cents: l.creditCents, memo: l.memo ?? null };
  });
}

const REVENUE: AccountRole[] = ['sales', 'sales_discounts'];
const OPEX: AccountRole[] = ['payroll', 'rent', 'utilities', 'card_fees', 'other_operating', 'inventory_adjustments'];

/**
 * Profit inputs from ledger balances by role (debit-normal balance = debits − credits).
 * Revenue/income balances are credit-normal, so they are negated.
 */
export function profitInputsFromBalances(balance: Partial<Record<AccountRole, number>>) {
  const b = (r: AccountRole) => balance[r] ?? 0;
  return {
    netSalesCents: -REVENUE.reduce((a, r) => a + b(r), 0),
    cogsCents: b('cogs'),
    operatingExpensesCents: Object.fromEntries(OPEX.map((r) => [r, b(r)])) as Record<string, number>,
    otherIncomeCents: -b('other_income'),
    otherExpensesCents: b('other_expense'),
    interestCents: b('interest'),
    taxesCents: b('income_taxes'),
  };
}
