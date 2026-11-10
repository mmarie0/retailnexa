/**
 * Financial statements from ledger figures (accrual basis).
 * Inputs use debit-normal amounts (debits − credits); statements present
 * natural-sign amounts (revenue and liabilities positive). All cents.
 */
export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
export interface LedgerRow { id: string; code: string; name: string; type: AccountType; role: string | null; net: number }
export interface Line { id: string; code: string; name: string; amount: number }
export interface Section { title: string; lines: Line[]; total: number }

const line = (r: LedgerRow, sign: 1 | -1): Line => ({ id: r.id, code: r.code, name: r.name, amount: sign * r.net });
const section = (title: string, rows: LedgerRow[], sign: 1 | -1, keepZero = false): Section => {
  const lines = rows.filter((r) => keepZero || r.net !== 0).map((r) => line(r, sign));
  return { title, lines, total: lines.reduce((a, l) => a + l.amount, 0) };
};

const NON_OPERATING_EXPENSE = new Set(['interest', 'other_expense', 'income_taxes']);

export interface IncomeStatement {
  revenue: Section; cogs: Section; grossProfit: number;
  operatingExpenses: Section; operatingProfit: number;
  otherIncome: Section; otherExpenses: Section; netIncome: number;
}

/** P&L for a period from per-account activity in that period. */
export function incomeStatement(rows: LedgerRow[]): IncomeStatement {
  const rev = rows.filter((r) => r.type === 'revenue');
  const exp = rows.filter((r) => r.type === 'expense');
  const revenue = section('Revenue', rev.filter((r) => r.role !== 'other_income'), -1);
  const otherIncome = section('Other income', rev.filter((r) => r.role === 'other_income'), -1);
  const cogs = section('Cost of goods sold', exp.filter((r) => r.role === 'cogs'), 1);
  const operatingExpenses = section('Operating expenses', exp.filter((r) => r.role !== 'cogs' && !NON_OPERATING_EXPENSE.has(r.role ?? '')), 1);
  const otherExpenses = section('Other expenses, interest and taxes', exp.filter((r) => NON_OPERATING_EXPENSE.has(r.role ?? '')), 1);
  const grossProfit = revenue.total - cogs.total;
  const operatingProfit = grossProfit - operatingExpenses.total;
  return { revenue, cogs, grossProfit, operatingExpenses, operatingProfit, otherIncome, otherExpenses,
    netIncome: operatingProfit + otherIncome.total - otherExpenses.total };
}

export interface BalanceSheet {
  assets: Section; liabilities: Section; equity: Section;
  /** Revenue − expenses to date not yet closed into retained earnings. */
  currentEarnings: number;
  totalLiabilitiesAndEquity: number;
  balanced: boolean;
}

/** Balance sheet from cumulative balances as of a date (e.g. trial_balance rows). */
export function balanceSheet(rows: LedgerRow[]): BalanceSheet {
  const assets = section('Assets', rows.filter((r) => r.type === 'asset'), 1);
  const liabilities = section('Liabilities', rows.filter((r) => r.type === 'liability'), -1);
  const equityBase = section('Equity', rows.filter((r) => r.type === 'equity'), -1);
  const currentEarnings = -rows.filter((r) => r.type === 'revenue' || r.type === 'expense').reduce((a, r) => a + r.net, 0);
  const equity: Section = {
    ...equityBase,
    lines: currentEarnings ? [...equityBase.lines, { id: 'current-earnings', code: '', name: 'Net income to date', amount: currentEarnings }] : equityBase.lines,
    total: equityBase.total + currentEarnings,
  };
  const totalLiabilitiesAndEquity = liabilities.total + equity.total;
  return { assets, liabilities, equity, currentEarnings, totalLiabilitiesAndEquity, balanced: assets.total === totalLiabilitiesAndEquity };
}
