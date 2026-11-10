import { describe, expect, it } from 'vitest';
import { cashFlow, type BalanceRow } from './cash-flow';
import { dailySales, inventoryBill, billPayment, cardDeposit, ownerDraw, salesTaxPayment, type RoleLine } from './postings';

// Build balances by role from posting rules, so the test uses the same rules as production.
const ROLES: Record<string, BalanceRow['type']> = {
  cash_on_hand: 'asset', bank: 'asset', card_clearing: 'asset', inventory: 'asset', accounts_payable: 'liability',
  sales_tax_payable: 'liability', owner_equity: 'equity', owner_draws: 'equity', sales: 'revenue', sales_discounts: 'revenue',
  card_fees: 'expense', cogs: 'expense', customer_credits: 'liability',
};
function balances(entries: RoleLine[][]): BalanceRow[] {
  const b: Record<string, number> = Object.fromEntries(Object.keys(ROLES).map((r) => [r, 0]));
  for (const e of entries) for (const l of e) b[l.role] += l.debitCents - l.creditCents;
  return Object.entries(ROLES).map(([role, type]) => ({ id: role, code: role, name: role.replace(/_/g, ' '), type, role, balance: b[role] }));
}

describe('cashFlow', () => {
  const opening = [
    [{ role: 'bank', debitCents: 1_000_000, creditCents: 0 }, { role: 'owner_equity', debitCents: 0, creditCents: 1_000_000 }] as RoleLine[],
  ];
  const period = [
    inventoryBill(300_000),
    billPayment(200_000),
    dailySales({ grossSalesCents: 100_000, discountsCents: 5_000, salesTaxCents: 7_125, cashCents: 30_000, cardCents: 72_125 }),
    cardDeposit(72_125, 2_100),
    salesTaxPayment(7_125),
    ownerDraw(10_000),
  ];

  it('ties net change in cash to the three sections', () => {
    const cf = cashFlow(balances(opening), balances([...opening, ...period]));
    expect(cf.ties).toBe(true);
    expect(cf.cashStart).toBe(1_000_000);
    expect(cf.cashEnd - cf.cashStart).toBe(cf.netChange);
  });

  it('puts working capital in operating and owner draws in financing', () => {
    const cf = cashFlow(balances(opening), balances([...opening, ...period]));
    expect(cf.netIncome).toBe(95_000 - 2_100);
    const labels = cf.operating.map((l) => l.label);
    expect(labels).toContain('Increase in inventory');
    expect(labels).toContain('Increase in accounts payable');
    expect(cf.operating.find((l) => l.label === 'Increase in inventory')!.amount).toBe(-300_000);
    expect(cf.operating.find((l) => l.label === 'Increase in accounts payable')!.amount).toBe(100_000);
    expect(cf.financing).toEqual([{ id: 'owner_draws', label: 'Owner draws', amount: -10_000 }]);
    expect(cf.investingTotal).toBe(0);
  });

  it('an empty period has no flows and ties at zero', () => {
    const cf = cashFlow(balances(opening), balances(opening));
    expect(cf.netChange).toBe(0);
    expect(cf.ties).toBe(true);
  });
});
