import { describe, expect, it } from 'vitest';
import { balanceSheet, incomeStatement, type LedgerRow } from './statements';

const r = (code: string, type: LedgerRow['type'], role: string | null, net: number): LedgerRow => ({ id: code, code, name: code, type, role, net });

// One month: $1,000 sales, $50 discounts, $70 tax, $400 COGS, $300 rent, $20 card fees, $10 interest, $5 other income.
const month: LedgerRow[] = [
  r('1000', 'asset', 'cash_on_hand', 1_020_00 - 300_00 - 10_00 + 5_00),
  r('1200', 'asset', 'inventory', 600_00),
  r('2000', 'liability', 'accounts_payable', -1_000_00),
  r('2100', 'liability', 'sales_tax_payable', -70_00),
  r('3000', 'equity', 'owner_equity', 0),
  r('4000', 'revenue', 'sales', -1_000_00),
  r('4100', 'revenue', 'sales_discounts', 50_00),
  r('4900', 'revenue', 'other_income', -5_00),
  r('5000', 'expense', 'cogs', 400_00),
  r('6100', 'expense', 'rent', 300_00),
  r('6300', 'expense', 'card_fees', 20_00),
  r('6200', 'expense', 'utilities', 0),
  r('7000', 'expense', 'interest', 10_00),
];

describe('incomeStatement', () => {
  const p = incomeStatement(month);
  it('nets discounts in revenue, separates COGS, operating and other items', () => {
    expect(p.revenue.total).toBe(950_00);
    expect(p.cogs.total).toBe(400_00);
    expect(p.grossProfit).toBe(550_00);
    expect(p.operatingExpenses.total).toBe(320_00);
    expect(p.operatingProfit).toBe(230_00);
    expect(p.otherIncome.total).toBe(5_00);
    expect(p.otherExpenses.total).toBe(10_00);
    expect(p.netIncome).toBe(225_00);
  });
  it('hides zero lines', () => {
    expect(p.operatingExpenses.lines.map((l) => l.code)).toEqual(['6100', '6300']);
  });
});

describe('balanceSheet', () => {
  it('balances once net income to date is included in equity', () => {
    // Make the ledger balance: cash 715, inventory 600 (= 1,315) vs AP 1,000 + tax 70 + earnings 225 + equity 20.
    const rows = month.map((x) => (x.code === '3000' ? { ...x, net: -20_00 } : x));
    const b = balanceSheet(rows);
    expect(b.assets.total).toBe(1_315_00);
    expect(b.liabilities.total).toBe(1_070_00);
    expect(b.currentEarnings).toBe(225_00);
    expect(b.equity.total).toBe(245_00);
    expect(b.balanced).toBe(true);
  });
  it('reports when it does not balance', () => {
    expect(balanceSheet(month).balanced).toBe(false);
  });
});
