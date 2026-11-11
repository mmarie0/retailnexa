/**
 * Overview (#108), copied from the owner's RetailNexa home page: date ranges
 * with last-year comparison, projected profit, spend vs last year, a 12-month
 * trend and a per-user tile layout. Pure; money in integer cents.
 * No cash tiles (the owner excluded cash & safe tracking).
 */

const DAY = 86_400_000;
const ms = (d: string) => Date.parse(`${d}T00:00:00Z`);
export const addDays = (d: string, n: number) => new Date(ms(d) + n * DAY).toISOString().slice(0, 10);
export const ymAdd = (ym: string, n: number) => new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 1 + n, 1)).toISOString().slice(0, 7);
export const daysIn = (ym: string) => new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).getUTCDate();
export const daysBetween = (a: string, b: string) => Math.round((ms(b) - ms(a)) / DAY);
/** A real calendar date (Date.parse rolls 2026-02-30 over, so round-trip it). */
export const isDate = (v: unknown): v is string =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && v >= '2000-01-01' && v <= '2100-12-31' && !Number.isNaN(ms(v)) && new Date(ms(v)).toISOString().slice(0, 10) === v;

// ---------- date ranges ----------
export const RANGES = [['', 'Month'], ['week', 'This week'], ['lweek', 'Last week'], ['30', 'Last 30 days'], ['ytd', 'This year'], ['lyear', 'Last year'], ['custom', 'Custom']] as const;
export type RangeKey = (typeof RANGES)[number][0];
export interface Range { key: RangeKey; from: string; to: string }

/** The range for `?r=` (and `from`/`to` for custom). Weeks start Sunday. Null = the normal month view. */
export function rangeFor(r: unknown, today: string, from?: unknown, to?: unknown): Range | null {
  const key = RANGES.find(([k]) => k === r)?.[0];
  if (!key) return null;
  const wk = addDays(today, -new Date(ms(today)).getUTCDay()), y = +today.slice(0, 4);
  switch (key) {
    case 'week': return { key, from: wk, to: today };
    case 'lweek': return { key, from: addDays(wk, -7), to: addDays(wk, -1) };
    case '30': return { key, from: addDays(today, -29), to: today };
    case 'ytd': return { key, from: `${y}-01-01`, to: today };
    case 'lyear': return { key, from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
    default: {
      let f = isDate(from) ? from : addDays(today, -29), t = isDate(to) ? to : today;
      if (f > t) [f, t] = [t, f];
      if (daysBetween(f, t) > 731) f = addDays(t, -731); // at most about two years
      return { key, from: f, to: t };
    }
  }
}

/** Last year's matching dates: same weekdays (364 days back) up to about two months, calendar dates for longer ranges. */
export function lastYearOf(r: { from: string; to: string }): { from: string; to: string; sameWeekdays: boolean } {
  const cal = (d: string) => { const md = d.slice(5); return `${+d.slice(0, 4) - 1}-${md === '02-29' ? '02-28' : md}`; };
  return daysBetween(r.from, r.to) + 1 <= 62
    ? { from: addDays(r.from, -364), to: addDays(r.to, -364), sameWeekdays: true }
    : { from: cal(r.from), to: cal(r.to), sameWeekdays: false };
}

// ---------- sales by month (daily roll-ups + uploaded monthly reports) ----------
export interface Rollup { location_id: string; period: string; net_cents: number; tax_cents: number; days: number; last_day: string }
export interface Report { location_id: string; month: string; sales_cents: number; tax_cents: number }
export interface MonthSales { net: number; tax: number; reported: boolean }

/** Sales per month; per store, an uploaded monthly report replaces that store's daily roll-up (same rule as Months & history). */
export function salesByMonth(rollups: Rollup[], reports: Report[]): Map<string, MonthSales> {
  const per = new Map<string, MonthSales & { ym: string }>();
  for (const r of rollups) {
    const ym = r.period.slice(0, 7), k = `${r.location_id}|${ym}`;
    const v = per.get(k) ?? { ym, net: 0, tax: 0, reported: false };
    v.net += Number(r.net_cents); v.tax += Number(r.tax_cents);
    per.set(k, v);
  }
  for (const r of reports) {
    const ym = r.month.slice(0, 7);
    per.set(`${r.location_id}|${ym}`, { ym, net: Number(r.sales_cents), tax: Number(r.tax_cents), reported: true });
  }
  const out = new Map<string, MonthSales>();
  for (const v of per.values()) {
    const m = out.get(v.ym) ?? { net: 0, tax: 0, reported: false };
    m.net += v.net; m.tax += v.tax; m.reported ||= v.reported;
    out.set(v.ym, m);
  }
  return out;
}

/**
 * This month's sales on pace for the whole month. Each store's daily roll-up is
 * scaled by days in month / its last recorded day; a store with an uploaded
 * report for the month is taken as-is. Null when nothing is recorded yet.
 */
export function projectMonth(ym: string, rollups: Rollup[], reports: Report[]): MonthSales | null {
  const reported = new Set(reports.filter((r) => r.month.startsWith(ym)).map((r) => r.location_id));
  const dim = daysIn(ym);
  let net = 0, tax = 0, any = false;
  for (const r of rollups) {
    if (!r.period.startsWith(ym) || reported.has(r.location_id)) continue;
    const elapsed = +r.last_day.slice(8);
    net += Math.round((Number(r.net_cents) / elapsed) * dim); tax += Math.round((Number(r.tax_cents) / elapsed) * dim); any = true;
  }
  for (const r of reports) if (r.month.startsWith(ym)) { net += Number(r.sales_cents); tax += Number(r.tax_cents); any = true; }
  return any ? { net, tax, reported: reported.size > 0 } : null;
}

/** Net sales per day with sales: for each period the most days any one store reported (stores share calendar days). */
export function dailyAverage(rollups: Rollup[]): { cents: number | null; days: number } {
  const by = new Map<string, { net: number; days: number }>();
  for (const r of rollups) { const v = by.get(r.period) ?? { net: 0, days: 0 }; v.net += Number(r.net_cents); v.days = Math.max(v.days, Number(r.days)); by.set(r.period, v); }
  let net = 0, days = 0;
  for (const v of by.values()) { net += v.net; days += v.days; }
  return { cents: days ? Math.round(net / days) : null, days };
}

/** Sales + tax − bills − payroll: the owner's profit formula (sales tax goes out as a bill, so it's counted in). */
export const profitOf = (s: { net: number; tax: number } | null, billsCents: number, payrollCents: number) =>
  s === null ? null : s.net + s.tax - billsCents - payrollCents;

/** 12 months ending with `ym`, each with last year's same month. This month uses the projection when there is one. */
export function trend12(ym: string, months: Map<string, MonthSales>, projected: MonthSales | null) {
  return Array.from({ length: 12 }, (_, i) => {
    const m = ymAdd(ym, i - 11);
    const cur = m === ym && projected ? projected.net : months.get(m)?.net ?? null;
    return { ym: m, cents: cur, lastYearCents: months.get(ymAdd(m, -12))?.net ?? null, projected: m === ym && !!projected };
  });
}

/** Spend vs last year: this month's bills against the same month last year, and the year so far against the same months. */
export function spendVsLastYear(ym: string, byMonth: Map<string, number>, thisMonthCents: number) {
  const lym = ymAdd(ym, -12);
  let ytd = thisMonthCents, lytd = byMonth.get(lym) ?? 0;
  for (let m = `${ym.slice(0, 4)}-01`; m < ym; m = ymAdd(m, 1)) { ytd += byMonth.get(m) ?? 0; lytd += byMonth.get(ymAdd(m, -12)) ?? 0; }
  return { month: thisMonthCents, lastYearMonth: byMonth.get(lym) ?? null, ytd, lastYtd: lytd };
}

export const pct = (cur: number | null, prev: number | null) => (cur === null || !prev ? null : Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10);

// ---------- tiles ----------
export const TILES = [
  { id: 'quick', name: 'Quick actions', note: 'Add sales, a bill, invoices, payroll' },
  { id: 'sales', name: 'Sales this month', note: 'Month so far vs last year, with today, yesterday and last 7 days' },
  { id: 'payroll', name: 'Projected payroll', note: 'Half-width; scheduled cost for the month and paid so far', half: true },
  { id: 'profit', name: 'Projected profit', note: 'Half-width; sales + tax − bills − payroll, with last year', half: true },
  { id: 'bills', name: 'Bills this month', note: 'Due, paid and left to pay, with your budget' },
  { id: 'salesChart', name: 'Sales by day', note: 'Net sales, last 14 days' },
  { id: 'billsToPay', name: 'Bills to pay & overdue', note: 'Half-width pair from your approved bills', half: true },
  { id: 'books', name: 'Profit from your books', note: 'Half-width pair: gross and operating profit this month', half: true },
  { id: 'upcoming', name: 'Due next 7 days', note: 'Bills coming up this week' },
  { id: 'spend', name: 'Spend by vendor', note: 'This month, top 6 as bars' },
  { id: 'lySpend', name: 'Spend vs last year', note: 'This month and year to date vs last year' },
  { id: 'trend', name: '12-month sales trend', note: 'Net sales by month vs last year' },
] as const;
export type TileId = (typeof TILES)[number]['id'];
export const DEFAULT_LAYOUT: TileId[] = ['quick', 'sales', 'payroll', 'profit', 'bills', 'salesChart', 'billsToPay', 'books'];
const known = new Set<string>(TILES.map((t) => t.id));

/** A saved layout, cleaned: unknown ids and repeats dropped. Nothing saved → the default. */
export function cleanLayout(raw: unknown): TileId[] {
  if (!Array.isArray(raw)) return [...DEFAULT_LAYOUT];
  const seen = new Set<string>();
  return raw.filter((x): x is TileId => typeof x === 'string' && known.has(x) && !seen.has(x) && !!seen.add(x));
}

/** Apply one customize step. Unknown tiles and out-of-range moves leave the layout as it was. */
export function editLayout(layout: TileId[], op: 'up' | 'down' | 'remove' | 'add', id: string): TileId[] {
  if (!known.has(id)) return layout;
  const i = layout.indexOf(id as TileId), out = [...layout];
  if (op === 'add') return i >= 0 ? layout : [...layout, id as TileId];
  if (i < 0) return layout;
  if (op === 'remove') { out.splice(i, 1); return out; }
  const j = op === 'up' ? i - 1 : i + 1;
  if (j < 0 || j >= out.length) return layout;
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}
