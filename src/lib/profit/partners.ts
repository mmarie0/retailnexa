/**
 * Profit and partners (#104), copied from the owner's RetailNexa app. Pure;
 * money in integer cents. "Profit" here is the owner's cash-basis formula
 * (sales + tax − bills − payroll ± location balances), not an accounting net
 * income: bills include inventory purchases in the month they're due.
 */
import { parseAmount } from '@/lib/sales/import';
import { parseMonth } from '@/lib/sales/history';

export interface MonthParts { sales: number | null; tax: number; bills: number; payroll: number; balancesIn: number; balancesOut: number }
export interface MonthProfit extends MonthParts { ym: string; formula: number | null; manual: number | null; profit: number | null; note: string | null }

/** A month's profit: a manual figure wins; otherwise sales + tax + owed to me − bills − I owe − payroll (null with no sales). */
export function monthProfit(ym: string, p: MonthParts, manual?: { profit_cents: number; note: string | null }): MonthProfit {
  const formula = p.sales === null ? null : p.sales + p.tax + p.balancesIn - p.bills - p.balancesOut - p.payroll;
  const m = manual ? Number(manual.profit_cents) : null;
  return { ym, ...p, formula, manual: m, profit: m ?? formula, note: manual?.note ?? null };
}

/** Year totals and averages over months that have a profit. */
export function yearSummary(months: MonthProfit[]) {
  const withProfit = months.filter((m) => m.profit !== null);
  const total = withProfit.reduce((a, m) => a + m.profit!, 0);
  const sales = months.reduce((a, m) => a + (m.sales ?? 0), 0);
  return { total, months: withProfit.length, average: withProfit.length ? Math.round(total / withProfit.length) : null, sales, margin: sales ? (total / sales) * 100 : null };
}

/** Split a total by partner % exactly like the database: floor each share, then hand leftover cents to the biggest shares (ties by name). */
export function splitByPct(total: number, partners: { id: string; name: string; pct: number }[]) {
  const out = partners.map((p) => ({ ...p, share: Math.floor((total * p.pct) / 100) }));
  let left = total - out.reduce((a, p) => a + p.share, 0);
  const order = [...out].filter((p) => p.pct > 0).sort((a, b) => b.pct - a.pct || a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  for (const p of order) { if (left <= 0) break; p.share++; left--; }
  return out;
}

/**
 * The owner's profit calculator, "cash you can take": cash in the safe + bank
 * balance − the larger of your reserve and bills due on the 1st–15th of next
 * month − what's unpaid on this month's bills − payroll not yet run − what
 * you owe other stores. Never below zero.
 */
export function cashYouCanTake(i: { safe: number; bank: number; reserve: number; nextMonthEarlyBills: number; unpaidThisMonth: number; unrunPayroll: number; owedToStores: number }) {
  const hold = Math.max(i.reserve, i.nextMonthEarlyBills);
  const take = i.safe + i.bank - hold - i.unpaidThisMonth - i.unrunPayroll - i.owedToStores;
  return { cash: i.safe + i.bank, hold, take: Math.max(0, take), short: take < 0 ? -take : 0 };
}

/** Bulk profit import: Month + Profit (or Net, Income) columns. */
export function parseProfitSheet(rows: string[][], today: string) {
  const [head, ...body] = rows;
  const errors: { line: number; message: string }[] = [];
  if (!head) return { rows: [], errors: [{ line: 1, message: 'The sheet is empty.' }] };
  const h = head.map((x) => (x ?? '').toLowerCase().trim());
  const mi = h.findIndex((x) => /^(month|period|date)$/.test(x)), pi = h.findIndex((x) => /^(profit|net profit|net|net income|income)$/.test(x));
  const ni = h.findIndex((x) => /^(note|notes|memo)$/.test(x));
  if (mi < 0 || pi < 0) return { rows: [], errors: [{ line: 1, message: 'Add "Month" and "Profit" columns.' }] };
  const out: { month: string; profit_cents: number; note: string | null }[] = [];
  const seen = new Set<string>();
  body.forEach((r, i) => {
    const line = i + 2;
    if (r.every((x) => !x?.trim())) return;
    const ym = parseMonth(r[mi]);
    if (!ym || ym < '2000-01' || ym > today.slice(0, 7)) return errors.push({ line, message: `“${r[mi] ?? ''}” isn’t a month that has started` }) && undefined;
    const c = parseAmount(r[pi]);
    if (c === null || Math.abs(c) > 100_000_000_000) return errors.push({ line, message: `${ym}: profit must be an amount like 1234.56 or -500` }) && undefined;
    if (seen.has(ym)) return errors.push({ line, message: `${ym} is in the sheet twice` }) && undefined;
    seen.add(ym);
    out.push({ month: `${ym}-01`, profit_cents: c, note: ni >= 0 ? (r[ni] ?? '').trim().slice(0, 300) || null : null });
  });
  return { rows: out, errors };
}
