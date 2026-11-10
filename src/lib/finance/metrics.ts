/**
 * Profit metrics with correct separation (spec §6):
 *   Gross profit     = net sales − cost of goods sold (recognised COGS, not inventory purchases)
 *   Operating profit = gross profit − operating expenses (payroll, rent, utilities, card fees, …)
 *   Net income       = operating profit + other income − other expenses − interest − taxes
 *
 * Net income is only reported as "complete" when every component has been
 * provided. Otherwise callers must label the figure as partial.
 * All amounts are integer cents.
 */
export interface ProfitInputs {
  netSalesCents: number;
  cogsCents: number;
  operatingExpensesCents: Partial<Record<'payroll' | 'rent' | 'utilities' | 'cardFees' | 'other', number>>;
  otherIncomeCents?: number;
  otherExpensesCents?: number;
  interestCents?: number;
  taxesCents?: number;
}

export interface ProfitResult {
  netSalesCents: number;
  grossProfitCents: number;
  grossMarginPct: number | null;
  operatingExpensesCents: number;
  operatingProfitCents: number;
  netIncomeCents: number;
  netIncomeComplete: boolean;
  missing: string[];
}

const REQUIRED_OPEX = ['payroll', 'rent', 'utilities', 'cardFees', 'other'] as const;

export function computeProfit(i: ProfitInputs): ProfitResult {
  const missing: string[] = [];
  for (const k of REQUIRED_OPEX) if (i.operatingExpensesCents[k] === undefined) missing.push(`operating expense: ${k}`);
  if (i.otherIncomeCents === undefined) missing.push('other income');
  if (i.otherExpensesCents === undefined) missing.push('other expenses');
  if (i.interestCents === undefined) missing.push('interest');
  if (i.taxesCents === undefined) missing.push('taxes');

  const opex = Object.values(i.operatingExpensesCents).reduce((a, b) => a + (b ?? 0), 0);
  const gross = i.netSalesCents - i.cogsCents;
  const operating = gross - opex;
  const net = operating + (i.otherIncomeCents ?? 0) - (i.otherExpensesCents ?? 0) - (i.interestCents ?? 0) - (i.taxesCents ?? 0);
  return {
    netSalesCents: i.netSalesCents,
    grossProfitCents: gross,
    grossMarginPct: i.netSalesCents ? Math.round((gross / i.netSalesCents) * 10_000) / 100 : null,
    operatingExpensesCents: opex,
    operatingProfitCents: operating,
    netIncomeCents: net,
    netIncomeComplete: missing.length === 0,
    missing,
  };
}

export interface DailySale {
  date: string; // YYYY-MM-DD (business-local date)
  salesCents: number;
  transactions: number;
}

const dayMs = 86_400_000;
const parse = (d: string) => new Date(`${d}T00:00:00Z`);
const fmt = (d: Date) => d.toISOString().slice(0, 10);

/** Same weekday, 52 weeks earlier (364 days) — the retail-standard comparable day. */
export function comparableDate(date: string): string {
  return fmt(new Date(parse(date).getTime() - 364 * dayMs));
}

export function pctChange(current: number, previous: number): number | null {
  if (!previous) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

export function averageTicketCents(salesCents: number, transactions: number): number | null {
  return transactions > 0 ? Math.round(salesCents / transactions) : null;
}

/**
 * Month-end projection: month-to-date actuals plus, for each remaining day, the
 * average of that weekday so far this month (falls back to the overall daily
 * average when a weekday has not occurred yet). Returns null with fewer than 7
 * days of data — too little to project responsibly.
 */
export function projectMonthEnd(sales: DailySale[], asOf: string): { projectedCents: number; basisDays: number } | null {
  const as = parse(asOf);
  const monthStart = new Date(Date.UTC(as.getUTCFullYear(), as.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(as.getUTCFullYear(), as.getUTCMonth() + 1, 0));
  const mtd = sales.filter((s) => parse(s.date) >= monthStart && parse(s.date) <= as);
  if (mtd.length < 7) return null;

  const byWeekday = new Map<number, number[]>();
  for (const s of mtd) {
    const w = parse(s.date).getUTCDay();
    byWeekday.set(w, [...(byWeekday.get(w) ?? []), s.salesCents]);
  }
  const overall = mtd.reduce((a, s) => a + s.salesCents, 0) / mtd.length;
  let projected = mtd.reduce((a, s) => a + s.salesCents, 0);
  for (let d = new Date(as.getTime() + dayMs); d <= monthEnd; d = new Date(d.getTime() + dayMs)) {
    const vals = byWeekday.get(d.getUTCDay());
    projected += vals ? vals.reduce((a, b) => a + b, 0) / vals.length : overall;
  }
  return { projectedCents: Math.round(projected), basisDays: mtd.length };
}

export function sumRange(sales: DailySale[], from: string, to: string) {
  const f = parse(from), t = parse(to);
  return sales
    .filter((s) => parse(s.date) >= f && parse(s.date) <= t)
    .reduce((a, s) => ({ salesCents: a.salesCents + s.salesCents, transactions: a.transactions + s.transactions }), { salesCents: 0, transactions: 0 });
}
