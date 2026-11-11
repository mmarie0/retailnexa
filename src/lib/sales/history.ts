/**
 * Sales history (#103) and category reports (#112), copied from the owner's
 * RetailNexa app. Months roll up from daily entries; the POS's month-end report,
 * when uploaded, carries what daily entries don't (transactions, store card,
 * points) and wins for that month. Pure; money in integer cents.
 */
import { parseAmount, parseDate } from './import';

export interface DayRow {
  business_date: string; location_id: string; gross_sales_cents: number; discounts_cents: number; sales_tax_cents: number;
  cash_cents: number; card_cents: number; customer_credit_cents: number; transaction_count: number | null;
}
export interface MonthReport {
  location_id: string; month: string; sales_cents: number; gross_cents: number | null; tax_cents: number; cash_cents: number;
  card_cents: number; store_card_cents: number; points_cents: number; transactions: number | null;
}
export interface MonthTotals {
  ym: string; sales: number; gross: number; tax: number; cash: number; card: number; storeCard: number; points: number;
  transactions: number | null; days: number; source: 'report' | 'daily' | 'mixed';
}

const n = (v: unknown) => Number(v ?? 0);

/** Every month with data, newest first. Per store, the uploaded report replaces that store's daily roll-up. */
export function monthTotals(days: DayRow[], reports: MonthReport[]): MonthTotals[] {
  const key = (loc: string, ym: string) => `${loc}|${ym}`;
  const daily = new Map<string, MonthTotals>();
  for (const d of days) {
    const ym = d.business_date.slice(0, 7), k = key(d.location_id, ym);
    const t = daily.get(k) ?? { ym, sales: 0, gross: 0, tax: 0, cash: 0, card: 0, storeCard: 0, points: 0, transactions: null, days: 0, source: 'daily' as const };
    t.gross += n(d.gross_sales_cents); t.points += n(d.discounts_cents); t.sales += n(d.gross_sales_cents) - n(d.discounts_cents);
    t.tax += n(d.sales_tax_cents); t.cash += n(d.cash_cents); t.card += n(d.card_cents); t.storeCard += n(d.customer_credit_cents);
    if (d.transaction_count !== null && d.transaction_count !== undefined) t.transactions = (t.transactions ?? 0) + n(d.transaction_count);
    t.days++;
    daily.set(k, t);
  }
  const perStore = new Map(daily);
  for (const r of reports) {
    const ym = r.month.slice(0, 7), k = key(r.location_id, ym);
    perStore.set(k, {
      ym, sales: n(r.sales_cents), gross: r.gross_cents === null ? n(r.sales_cents) + n(r.points_cents) : n(r.gross_cents), tax: n(r.tax_cents),
      cash: n(r.cash_cents), card: n(r.card_cents), storeCard: n(r.store_card_cents), points: n(r.points_cents),
      transactions: r.transactions === null ? null : n(r.transactions), days: daily.get(k)?.days ?? 0, source: 'report',
    });
  }
  const byMonth = new Map<string, MonthTotals>();
  for (const t of perStore.values()) {
    const m = byMonth.get(t.ym);
    if (!m) { byMonth.set(t.ym, { ...t }); continue; }
    m.sales += t.sales; m.gross += t.gross; m.tax += t.tax; m.cash += t.cash; m.card += t.card; m.storeCard += t.storeCard; m.points += t.points;
    m.transactions = m.transactions === null && t.transactions === null ? null : (m.transactions ?? 0) + (t.transactions ?? 0);
    m.days += t.days;
    if (m.source !== t.source) m.source = 'mixed';
  }
  return [...byMonth.values()].sort((a, b) => b.ym.localeCompare(a.ym));
}

export const share = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : null);
export const avgSale = (t: Pick<MonthTotals, 'sales' | 'transactions'>) => (t.transactions ? Math.round(t.sales / t.transactions) : null);
export const pctChange = (cur: number, prev: number | null | undefined) => (prev ? ((cur - prev) / Math.abs(prev)) * 100 : null);

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9#%]+/g, ' ').trim();
function col(head: string[], ...aliases: string[]): number | undefined {
  const h = head.map(norm);
  for (const a of aliases) { const i = h.indexOf(a); if (i >= 0) return i; }
  return undefined;
}
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
/** "2026-10", "10/2026", "Oct 2026", "October 2026", or any date in the month → "2026-10". */
export function parseMonth(raw: string | undefined): string | null {
  const s = (raw ?? '').trim();
  let m = /^(\d{4})[-/](\d{1,2})$/.exec(s);
  if (m && +m[2] >= 1 && +m[2] <= 12) return `${m[1]}-${m[2].padStart(2, '0')}`;
  m = /^(\d{1,2})[-/](\d{4})$/.exec(s);
  if (m && +m[1] >= 1 && +m[1] <= 12) return `${m[2]}-${m[1].padStart(2, '0')}`;
  m = /^([a-z]{3,9})\.?\s+(\d{4})$/i.exec(s);
  if (m) { const i = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()); if (i >= 0) return `${m[2]}-${String(i + 1).padStart(2, '0')}`; }
  const d = parseDate(s);
  return d ? d.slice(0, 7) : null;
}

export interface MonthCsvRow { month: string; sales_cents: number; gross_cents: number | null; tax_cents: number; cash_cents: number; card_cents: number; store_card_cents: number; points_cents: number; transactions: number | null }
/** Monthly reports sheet: Month, Sales, Gross, Tax, Cash, Card, Store card, Points, Transactions. */
export function parseMonthSheet(rows: string[][], today: string): { rows: MonthCsvRow[]; errors: { line: number; message: string }[] } {
  const [head, ...body] = rows;
  const errors: { line: number; message: string }[] = [];
  if (!head) return { rows: [], errors: [{ line: 1, message: 'The sheet is empty.' }] };
  const c = {
    month: col(head, 'month', 'period', 'date'), sales: col(head, 'sales', 'net sales', 'net'), gross: col(head, 'gross', 'gross sales'),
    tax: col(head, 'tax', 'sales tax'), cash: col(head, 'cash'), card: col(head, 'card', 'credit card', 'cards'),
    storeCard: col(head, 'store card', 'store credit', 'gift card'), points: col(head, 'points', 'discounts', 'discount'),
    txns: col(head, 'transactions', 'txns', 'tickets', 'customers', 'transaction count'),
  };
  if (c.month === undefined || (c.sales === undefined && c.gross === undefined)) return { rows: [], errors: [{ line: 1, message: 'Add "Month" and "Sales" columns.' }] };
  const out: MonthCsvRow[] = [];
  const amt = (r: string[], i: number | undefined) => (i === undefined ? 0 : parseAmount(r[i]));
  body.forEach((r, i) => {
    const line = i + 2;
    if (r.every((x) => !x?.trim())) return;
    const ym = parseMonth(r[c.month!]);
    if (!ym || ym < '2000-01' || ym > today.slice(0, 7)) return errors.push({ line, message: `“${r[c.month!] ?? ''}” isn’t a month that has started` }) && undefined;
    const gross = c.gross === undefined ? null : amt(r, c.gross);
    const points = amt(r, c.points) ?? 0;
    const sales = c.sales !== undefined ? amt(r, c.sales) : gross === null ? null : gross - points;
    const vals = [sales, amt(r, c.tax), amt(r, c.cash), amt(r, c.card), amt(r, c.storeCard), points];
    if (vals.some((v) => v === null || v < 0) || (gross !== null && gross < 0)) return errors.push({ line, message: `${ym}: amounts must be numbers like 1234.56` }) && undefined;
    const tx = c.txns === undefined ? null : (r[c.txns] ?? '').replace(/[,\s]/g, '');
    if (tx && !/^\d+$/.test(tx)) return errors.push({ line, message: `${ym}: transactions must be a whole number` }) && undefined;
    out.push({ month: ym, sales_cents: sales!, gross_cents: gross, tax_cents: vals[1]!, cash_cents: vals[2]!, card_cents: vals[3]!, store_card_cents: vals[4]!, points_cents: points, transactions: tx ? Number(tx) : null });
  });
  return { rows: out, errors };
}

/** Category report sheet: Category (or Department), Sales (or Net sales/Amount), optional Qty. */
export function parseCategorySheet(rows: string[][]): { rows: { category: string; sales_cents: number; quantity: number | null }[]; errors: { line: number; message: string }[] } {
  const [head, ...body] = rows;
  const errors: { line: number; message: string }[] = [];
  if (!head) return { rows: [], errors: [{ line: 1, message: 'The sheet is empty.' }] };
  const c = { cat: col(head, 'category', 'department', 'dept', 'subcategory', 'name', 'item category'), sales: col(head, 'sales', 'net sales', 'amount', 'total', 'net'), qty: col(head, 'qty', 'quantity', 'units', 'items sold', 'count') };
  if (c.cat === undefined || c.sales === undefined) return { rows: [], errors: [{ line: 1, message: 'Add "Category" and "Sales" columns.' }] };
  const out: { category: string; sales_cents: number; quantity: number | null }[] = [];
  body.forEach((r, i) => {
    const line = i + 2, name = (r[c.cat!] ?? '').trim();
    if (!name || /^(total|grand total|totals)$/i.test(name)) return;
    const cents = parseAmount(r[c.sales!]);
    if (cents === null) return errors.push({ line, message: `${name}: sales must be a number like 1234.56` }) && undefined;
    const qRaw = c.qty === undefined ? '' : (r[c.qty] ?? '').replace(/[,\s]/g, '');
    const q = qRaw === '' ? null : Number(qRaw);
    out.push({ category: name.slice(0, 120), sales_cents: cents, quantity: q === null || Number.isNaN(q) ? null : q });
  });
  return { rows: out, errors };
}

export interface CategoryRow { category: string; sales_cents: number; quantity: number | null }
/** This month's categories against last month and the same month last year, biggest first. */
export function compareCategories(cur: CategoryRow[], prev: CategoryRow[], lastYear: CategoryRow[]) {
  const sum = (xs: CategoryRow[]) => { const m = new Map<string, { name: string; cents: number; qty: number | null }>(); for (const x of xs) { const k = x.category.trim().toLowerCase(); const v = m.get(k) ?? { name: x.category, cents: 0, qty: null }; v.cents += n(x.sales_cents); if (x.quantity !== null) v.qty = (v.qty ?? 0) + n(x.quantity); m.set(k, v); } return m; };
  const c = sum(cur), p = sum(prev), y = sum(lastYear);
  const total = [...c.values()].reduce((a, v) => a + v.cents, 0);
  const keys = new Set([...c.keys(), ...p.keys(), ...y.keys()]);
  return [...keys].map((k) => {
    const cv = c.get(k), pv = p.get(k), yv = y.get(k);
    const cents = cv?.cents ?? 0;
    return { category: cv?.name ?? pv?.name ?? yv?.name ?? k, cents, qty: cv?.qty ?? null, sharePct: share(cents, total), prevCents: pv?.cents ?? null, lastYearCents: yv?.cents ?? null,
      vsPrevPct: pctChange(cents, pv?.cents), vsLastYearPct: pctChange(cents, yv?.cents) };
  }).sort((a, b) => b.cents - a.cents || a.category.localeCompare(b.category));
}
