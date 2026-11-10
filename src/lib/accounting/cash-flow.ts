/**
 * Cash flow statement, indirect method, from account balances at the start and
 * end of a period (debit-normal: debits − credits).
 *
 *   Operating  = net income + changes in working capital
 *                (card clearing, receivables, inventory, payables, sales tax,
 *                 payroll liabilities, customer credits, other current items)
 *   Investing  = changes in other (non-current, unclassified) asset accounts
 *   Financing  = owner contributions, draws and other equity / long-term liabilities
 *   Net change = Δ cash (cash on hand + bank) — must tie out.
 * All cents. Amounts are shown as cash effects (+ in, − out).
 */
import type { AccountType } from './statements';

export interface BalanceRow { id: string; code: string; name: string; type: AccountType; role: string | null; balance: number }
export interface FlowLine { id: string; label: string; amount: number }
export interface CashFlow {
  netIncome: number;
  operating: FlowLine[]; operatingTotal: number;
  investing: FlowLine[]; investingTotal: number;
  financing: FlowLine[]; financingTotal: number;
  netChange: number;
  cashStart: number; cashEnd: number;
  ties: boolean;
}

const CASH = new Set(['cash_on_hand', 'bank']);
const WORKING_CAPITAL_ASSETS = new Set(['card_clearing', 'accounts_receivable', 'inventory']);
const WORKING_CAPITAL_LIABILITIES = new Set(['accounts_payable', 'sales_tax_payable', 'payroll_liabilities', 'customer_credits']);
const EQUITY_ROLES = new Set(['owner_equity', 'owner_draws']);

/** `start` = balances at the end of the day before the period; `end` = at the end of its last day. */
export function cashFlow(start: BalanceRow[], end: BalanceRow[]): CashFlow {
  const before = new Map(start.map((r) => [r.id, r.balance]));
  const delta = end.map((r) => ({ ...r, change: r.balance - (before.get(r.id) ?? 0) }));
  const netIncome = -delta.filter((r) => r.type === 'revenue' || r.type === 'expense').reduce((a, r) => a + r.change, 0);

  const line = (r: (typeof delta)[number], label: string): FlowLine => ({ id: r.id, label, amount: -r.change });
  const operating: FlowLine[] = [{ id: 'net-income', label: 'Net income', amount: netIncome }];
  const investing: FlowLine[] = [];
  const financing: FlowLine[] = [];

  for (const r of delta) {
    if (r.change === 0 || r.type === 'revenue' || r.type === 'expense') continue;
    if (r.role && CASH.has(r.role)) continue;
    // A debit-normal increase in an asset uses cash; an increase in a liability/equity (more negative) provides it.
    if (r.type === 'asset') {
      if (r.role && WORKING_CAPITAL_ASSETS.has(r.role)) operating.push(line(r, `${r.change > 0 ? 'Increase' : 'Decrease'} in ${r.name.toLowerCase()}`));
      else investing.push(line(r, r.name));
    } else if (r.type === 'liability') {
      if (!r.role || WORKING_CAPITAL_LIABILITIES.has(r.role)) operating.push(line(r, `${r.change < 0 ? 'Increase' : 'Decrease'} in ${r.name.toLowerCase()}`));
      else financing.push(line(r, r.name));
    } else if (r.type === 'equity') {
      // Retained earnings moves only at year-end close, which is already inside net income history.
      if (r.role === 'retained_earnings') continue;
      financing.push(line(r, EQUITY_ROLES.has(r.role ?? '') ? (r.role === 'owner_draws' ? 'Owner draws' : 'Owner contributions') : r.name));
    }
  }

  const sum = (l: FlowLine[]) => l.reduce((a, x) => a + x.amount, 0);
  const cashOf = (rows: { role: string | null; balance: number }[]) => rows.filter((r) => r.role && CASH.has(r.role)).reduce((a, r) => a + r.balance, 0);
  const cashStart = cashOf(start);
  const cashEnd = cashOf(end);
  const operatingTotal = sum(operating), investingTotal = sum(investing), financingTotal = sum(financing);
  const netChange = operatingTotal + investingTotal + financingTotal;
  return { netIncome, operating, operatingTotal, investing, investingTotal, financing, financingTotal, netChange, cashStart, cashEnd, ties: netChange === cashEnd - cashStart };
}
