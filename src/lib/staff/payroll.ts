/**
 * Staff math for Batch B (#102), copied from the owner's RetailNexa app:
 * hours from shifts and the regular weekly schedule, paid-lunch and overtime
 * rules, pay-run lines, weekly/monthly payroll estimates and labor %.
 * Pure; money in integer cents; dates are business-local YYYY-MM-DD.
 */

export interface DayShift { in: string; out: string; lunch?: number }
export interface Employee {
  id: string; name: string; role_title: string | null; location_id: string | null;
  start_date: string | null; end_date: string | null; is_active: boolean; regular: (DayShift | null)[] | null; notes?: string | null;
}
export interface Pay {
  employee_id: string; pay_type: 'hourly' | 'salary'; rate_cents: number; weekly_hours: number | null;
  burden_pct: number; tax_type: 'w2' | '1099' | null; pay_method: 'cash' | 'check' | 'ach' | null;
}
export interface Shift {
  employee_id: string; work_date: string; off: boolean; start_time: string | null; end_time: string | null;
  lunch_min: number; actual_in: string | null; actual_out: string | null;
}
export interface Rules {
  paid_lunch: boolean; overtime: boolean; overtime_after_hours: number; overtime_multiplier: number;
  pay_week_start: number; pay_every_weeks: number; labor_target_pct: number;
}
export const DEFAULT_RULES: Rules = {
  paid_lunch: true, overtime: false, overtime_after_hours: 40, overtime_multiplier: 1.5, pay_week_start: 0, pay_every_weeks: 1, labor_target_pct: 12,
};
export const PAY_METHOD_LABEL = { cash: 'Cash', check: 'Check', ach: 'Direct deposit (ACH)' } as const;
export const TAX_TYPE_LABEL = { w2: 'W-2 employee', '1099': '1099 contractor' } as const;

const DAY = 86_400_000;
const ms = (d: string) => Date.parse(`${d}T00:00:00Z`);
export const addDays = (d: string, n: number) => new Date(ms(d) + n * DAY).toISOString().slice(0, 10);
export const dow = (d: string) => new Date(ms(d)).getUTCDay();
export const toMin = (t: string) => { const [h, m] = t.slice(0, 5).split(':').map(Number); return h * 60 + m; };
const round2 = (n: number) => Math.round(n * 100) / 100;

/** First day of the week containing `d`, weeks starting on `startDow` (0 = Sunday). */
export function weekStart(d: string, startDow = 0): string {
  return addDays(d, -((dow(d) - startDow + 7) % 7));
}

/** Paid hours of one shift: overnight shifts wrap; unpaid lunch is taken out. */
export function shiftHours(s: { in: string; out: string; lunch?: number } | null, paidLunch: boolean): number {
  if (!s) return 0;
  let m = toMin(s.out) - toMin(s.in);
  if (m <= 0) m += 1440;
  return Math.max(0, round2((m - (paidLunch ? 0 : s.lunch ?? 0)) / 60));
}

export function activeOn(e: Employee, d: string): boolean {
  if (e.start_date && e.start_date > d) return false;
  if (e.end_date && e.end_date < d) return false;
  return e.is_active || (!!e.end_date && e.end_date >= d);
}

export type ShiftIndex = Map<string, Shift>; // `${employee}|${date}`
export const indexShifts = (shifts: Shift[]): ShiftIndex => new Map(shifts.map((s) => [`${s.employee_id}|${s.work_date}`, s]));

/** What `e` works on `d`: the week's own shift if set (or a day off), else the regular schedule. */
export function dayPlan(e: Employee, d: string, idx: ShiftIndex): (DayShift & { actIn?: string | null; actOut?: string | null; fromWeek: boolean }) | null {
  const s = idx.get(`${e.id}|${d}`);
  if (s) return s.off || !s.start_time || !s.end_time ? null
    : { in: s.start_time.slice(0, 5), out: s.end_time.slice(0, 5), lunch: s.lunch_min, actIn: s.actual_in?.slice(0, 5) ?? null, actOut: s.actual_out?.slice(0, 5) ?? null, fromWeek: true };
  const r = e.regular?.[dow(d)] ?? null;
  return r ? { ...r, fromWeek: false } : null;
}

/** Hours `e` works on `d` (clock times when entered). Without any schedule, weekly_hours / 7. */
export function dayHours(e: Employee, pay: Pay | undefined, d: string, idx: ShiftIndex, rules: Rules): number {
  if (!activeOn(e, d)) return 0;
  const p = dayPlan(e, d, idx);
  if (p) return shiftHours(p.actIn && p.actOut ? { in: p.actIn, out: p.actOut, lunch: p.lunch } : p, rules.paid_lunch);
  if (!e.regular && !idx.has(`${e.id}|${d}`) && pay?.weekly_hours) return round2(Number(pay.weekly_hours) / 7);
  return 0;
}

const burden = (p: Pay | undefined) => 1 + Number(p?.burden_pct ?? 0) / 100;

/** Usual weekly cost including employer taxes (Employees page). */
export function weeklyCost(e: Employee, pay: Pay | undefined, rules: Rules): number {
  if (!pay) return 0;
  if (pay.pay_type === 'salary') return Math.round((Number(pay.rate_cents) / 52) * burden(pay));
  const hours = e.regular ? e.regular.reduce((a, r) => a + shiftHours(r, rules.paid_lunch), 0) : Number(pay.weekly_hours ?? 0);
  return Math.round(paidHours(hours, rules) * Number(pay.rate_cents) * burden(pay));
}
/** Hours paid in a week once overtime counts extra. */
export function paidHours(h: number, rules: Rules): number {
  if (!rules.overtime || h <= rules.overtime_after_hours) return h;
  return rules.overtime_after_hours + (h - rules.overtime_after_hours) * rules.overtime_multiplier;
}

export interface LaborDay { date: string; hours: number; costCents: number; by: { id: string; name: string; hours: number | null; costCents: number }[] }
/** Labor cost of one day: hours × rate × employer taxes; salaried staff count 1/365 of salary. */
export function laborDay(d: string, emps: Employee[], pays: Map<string, Pay>, idx: ShiftIndex, rules: Rules): LaborDay {
  const by: LaborDay['by'] = [];
  let hours = 0, cost = 0;
  for (const e of emps) {
    if (!activeOn(e, d)) continue;
    const p = pays.get(e.id);
    if (!p) continue;
    if (p.pay_type === 'salary') { const c = Math.round((Number(p.rate_cents) / 365) * burden(p)); if (c) { cost += c; by.push({ id: e.id, name: e.name, hours: null, costCents: c }); } continue; }
    const h = dayHours(e, p, d, idx, rules);
    if (!h) continue;
    const c = Math.round(h * Number(p.rate_cents) * burden(p));
    hours += h; cost += c; by.push({ id: e.id, name: e.name, hours: h, costCents: c });
  }
  return { date: d, hours: round2(hours), costCents: cost, by };
}

/** Labor % for a month: each day with a sales report, averages by weekday, totals. */
export function laborMonth(ym: string, today: string, salesByDate: Map<string, number>, emps: Employee[], pays: Map<string, Pay>, idx: ShiftIndex, rules: Rules) {
  const dim = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).getUTCDate();
  const last = today.startsWith(ym) ? +today.slice(8) : dim;
  const days = Array.from({ length: Math.max(0, last) }, (_, i) => {
    const date = `${ym}-${String(i + 1).padStart(2, '0')}`;
    const L = laborDay(date, emps, pays, idx, rules);
    const sales = salesByDate.get(date) ?? null;
    return { ...L, dow: dow(date), salesCents: sales, pct: sales ? (L.costCents / sales) * 100 : null };
  });
  const withSales = days.filter((d) => d.salesCents);
  const sum = (xs: typeof days, f: (d: (typeof days)[number]) => number) => xs.reduce((a, d) => a + f(d), 0);
  const weekdays = [0, 1, 2, 3, 4, 5, 6].map((w) => {
    const ds = withSales.filter((d) => d.dow === w), s = sum(ds, (d) => d.salesCents!), c = sum(ds, (d) => d.costCents);
    return { dow: w, n: ds.length, salesCents: ds.length ? s / ds.length : null, costCents: ds.length ? c / ds.length : null, hours: ds.length ? sum(ds, (d) => d.hours) / ds.length : null, pct: s ? (c / s) * 100 : null };
  });
  const tS = sum(withSales, (d) => d.salesCents!), tC = sum(withSales, (d) => d.costCents), tH = sum(withSales, (d) => d.hours);
  return { days, weekdays, salesCents: tS, costCents: tC, hours: tH, pct: tS ? (tC / tS) * 100 : null, n: withSales.length, salesPerHourCents: tH ? tS / tH : null };
}

export interface PayLine {
  employee_id: string; name: string; pay_type: 'hourly' | 'salary'; pay_method: Pay['pay_method'];
  hours: number; overtime_hours: number; rate_cents: number; regular_cents: number; overtime_cents: number;
  bonus_cents: number; employer_tax_cents: number; burden_pct: number;
}
/** Suggested pay-run lines for a period from the schedule, with weekly overtime. */
export function periodLines(start: string, end: string, emps: Employee[], pays: Map<string, Pay>, idx: ShiftIndex, rules: Rules): PayLine[] {
  const out: PayLine[] = [];
  const nDays = Math.round((ms(end) - ms(start)) / DAY) + 1;
  for (const e of emps) {
    const p = pays.get(e.id);
    if (!p) continue;
    const dates = Array.from({ length: nDays }, (_, i) => addDays(start, i)).filter((d) => activeOn(e, d));
    if (!dates.length) continue;
    const rate = Number(p.rate_cents);
    if (p.pay_type === 'salary') {
      const regular = Math.round((rate / 365) * dates.length);
      out.push({ employee_id: e.id, name: e.name, pay_type: 'salary', pay_method: p.pay_method, hours: 0, overtime_hours: 0, rate_cents: rate,
        regular_cents: regular, overtime_cents: 0, bonus_cents: 0, employer_tax_cents: Math.round((regular * Number(p.burden_pct)) / 100), burden_pct: Number(p.burden_pct) });
      continue;
    }
    // Hours per pay week, so overtime is counted week by week.
    const weeks = new Map<string, number>();
    for (const d of dates) { const w = weekStart(d, rules.pay_week_start); weeks.set(w, (weeks.get(w) ?? 0) + dayHours(e, p, d, idx, rules)); }
    let reg = 0, ot = 0;
    for (const h of weeks.values()) { if (rules.overtime && h > rules.overtime_after_hours) { reg += rules.overtime_after_hours; ot += h - rules.overtime_after_hours; } else reg += h; }
    reg = round2(reg); ot = round2(ot);
    if (!reg && !ot) continue;
    const regular = Math.round(reg * rate), overtime = Math.round(ot * rate * rules.overtime_multiplier);
    out.push({ employee_id: e.id, name: e.name, pay_type: 'hourly', pay_method: p.pay_method, hours: round2(reg + ot), overtime_hours: ot, rate_cents: rate,
      regular_cents: regular, overtime_cents: overtime, bonus_cents: 0, employer_tax_cents: Math.round(((regular + overtime) * Number(p.burden_pct)) / 100), burden_pct: Number(p.burden_pct) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** The pay period that contains `d` (pay weeks start on rules.pay_week_start; 2-week periods anchored to 2026-01-04). */
export function payPeriod(d: string, rules: Rules): { start: string; end: string } {
  let start = weekStart(d, rules.pay_week_start);
  if (rules.pay_every_weeks === 2) {
    const anchor = weekStart('2026-01-04', rules.pay_week_start);
    const weeks = Math.round((ms(start) - ms(anchor)) / (7 * DAY));
    if (((weeks % 2) + 2) % 2 === 1) start = addDays(start, -7);
  }
  return { start, end: addDays(start, 7 * rules.pay_every_weeks - 1) };
}

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const t12 = (t: string) => { const m = toMin(t), h = Math.floor(m / 60) % 24, mm = m % 60; return `${((h + 11) % 12) + 1}${mm ? `:${String(mm).padStart(2, '0')}` : ''}${h < 12 ? 'a' : 'p'}`; };

/** First and last day of the month of `d` (YYYY-MM-DD). */
export function monthRange(d: string): { from: string; to: string } {
  const ym = d.slice(0, 7);
  const last = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).getUTCDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}` };
}
