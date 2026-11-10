/**
 * The Due view, copied from the owner's RetailNexa app (vMonth): every bill due
 * in a month, plus recurring bills that haven't been created yet, split into
 * Orders (vendor invoices) and Bills (rent, utilities, services). Pure so the
 * page and its tests share one source. All money in integer cents; dates are
 * business-local YYYY-MM-DD strings.
 */

export type Kind = 'order' | 'bill';
export type DotState = 'paid' | 'late' | 'soon' | 'upcoming';

export interface BillRow {
  id: string; vendor_id: string; bill_number: string; bill_date: string; due_date: string;
  status: 'draft' | 'approved' | 'paid' | 'void'; total_cents: number; paid_cents: number;
  recurring_bill_id: string | null;
}
export interface TemplateRow {
  id: string; vendor_id: string; name: string; frequency: 'weekly' | 'monthly' | 'quarterly' | 'yearly';
  day_of_month: number | null; next_date: string; end_date: string | null; due_days: number;
  is_active: boolean; amount_cents: number;
}
export interface DueItem {
  /** Bill id, or `tpl:<template>:<bill date>` for a recurring bill not created yet. */
  id: string;
  billId: string | null;
  templateId: string | null;
  kind: Kind;
  name: string;
  detail: string;
  dueDate: string;
  amountCents: number;
  paidCents: number;
  leftCents: number;
  /** draft = waiting for approval; scheduled = recurring bill not created yet. */
  stage: 'draft' | 'open' | 'paid' | 'scheduled';
  dot: DotState;
}
export interface Budget { month: string | null; amount_cents: number }

/** Same list as the live app: names that mean a fixed bill, not merchandise. */
export const BILL_WORDS = /\b(rent|lease|landlord|electric|power|energy|utilit|water|sewer|gas co|natural gas|waste|trash|garbage|insurance|phone|wireless|mobile|internet|cable|comcast|verizon|at&t|spectrum|xfinity|t-mobile|alarm|security|adt|software|subscription|pos\b|card processing|merchant|processing fee|credit card fee|bank fee|loan|mortgage|tax|irs|payroll|accountant|cpa|cleaning|pest|license|permit|hoa|cam\b|common area)/i;

/** The vendor's own setting wins (as in the live app); otherwise recurring or bill-like names are Bills. */
export function kindOf(name: string, recurring: boolean, override?: Kind | null): Kind {
  if (override) return override;
  return recurring || BILL_WORDS.test(name) ? 'bill' : 'order';
}

const DAY = 86_400_000;
const toMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
export const addDays = (d: string, n: number) => new Date(toMs(d) + n * DAY).toISOString().slice(0, 10);
export const daysBetween = (a: string, b: string) => Math.round((toMs(b) - toMs(a)) / DAY);
export const daysInMonth = (ym: string) => new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).getUTCDate();
export function ymAdd(ym: string, n: number): string {
  const d = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}
export const isYm = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);

/** Mirrors private.next_occurrence in the database. */
export function nextOccurrence(date: string, freq: TemplateRow['frequency'], day: number | null): string {
  if (freq === 'weekly') return addDays(date, 7);
  const months = freq === 'monthly' ? 1 : freq === 'quarterly' ? 3 : 12;
  const ym = ymAdd(date.slice(0, 7), months);
  const d = Math.min(day ?? +date.slice(8), daysInMonth(ym));
  return `${ym}-${String(d).padStart(2, '0')}`;
}

export function dotFor(dueDate: string, leftCents: number, today: string): DotState {
  if (leftCents <= 0) return 'paid';
  const d = daysBetween(today, dueDate);
  return d < 0 ? 'late' : d <= 7 ? 'soon' : 'upcoming';
}

/** Bills due in `ym` (void ones left out) plus recurring bills that will fall due in it. */
export function monthItems(ym: string, bills: BillRow[], templates: TemplateRow[], vendorName: Map<string, string>, today: string, vendorKind?: Map<string, Kind>): DueItem[] {
  const out: DueItem[] = [];
  for (const b of bills) {
    if (b.status === 'void' || !b.due_date.startsWith(ym)) continue;
    const total = Number(b.total_cents), paid = Number(b.paid_cents), left = Math.max(0, total - paid);
    const name = vendorName.get(b.vendor_id) ?? 'Vendor';
    out.push({
      id: b.id, billId: b.id, templateId: b.recurring_bill_id, kind: kindOf(name, b.recurring_bill_id !== null, vendorKind?.get(b.vendor_id)),
      name, detail: `#${b.bill_number}`, dueDate: b.due_date, amountCents: total, paidCents: paid, leftCents: left,
      stage: b.status === 'draft' ? 'draft' : left === 0 ? 'paid' : 'open', dot: dotFor(b.due_date, left, today),
    });
  }
  const monthEnd = `${ym}-${String(daysInMonth(ym)).padStart(2, '0')}`;
  for (const t of templates) {
    if (!t.is_active || t.amount_cents <= 0) continue;
    // Templates only ever move forward, so every occurrence from next_date on is not created yet.
    let billDate = t.next_date;
    for (let i = 0; i < 400; i++) {
      if (t.end_date && billDate > t.end_date) break;
      const due = addDays(billDate, t.due_days);
      if (due > monthEnd) break;
      if (due.startsWith(ym)) {
        out.push({
          id: `tpl:${t.id}:${billDate}`, billId: null, templateId: t.id, kind: vendorKind?.get(t.vendor_id) ?? 'bill',
          name: t.name, detail: vendorName.get(t.vendor_id) ?? 'Recurring', dueDate: due,
          amountCents: t.amount_cents, paidCents: 0, leftCents: t.amount_cents, stage: 'scheduled', dot: dotFor(due, t.amount_cents, today),
        });
      }
      billDate = nextOccurrence(billDate, t.frequency, t.day_of_month);
    }
  }
  return out.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.name.localeCompare(b.name));
}

export function totals(items: DueItem[]) {
  let total = 0, paid = 0, left = 0, late = 0;
  for (const i of items) { total += i.amountCents; paid += Math.min(i.paidCents, i.amountCents); left += i.leftCents; if (i.dot === 'late') late++; }
  return { total, paid, left, late, count: items.length };
}

/** Budget for a month: its own, else the default, else none. */
export function budgetFor(ym: string, budgets: Budget[]): { cents: number; own: boolean } | null {
  const own = budgets.find((b) => b.month?.slice(0, 7) === ym);
  if (own) return { cents: Number(own.amount_cents), own: true };
  const def = budgets.find((b) => b.month === null);
  return def ? { cents: Number(def.amount_cents), own: false } : null;
}

/** Bills due vs budget for `months` months starting at `ym`. */
export function forecast(ym: string, months: number, bills: BillRow[], templates: TemplateRow[], vendorName: Map<string, string>, budgets: Budget[], today: string, vendorKind?: Map<string, Kind>) {
  return Array.from({ length: months }, (_, i) => {
    const m = ymAdd(ym, i);
    const t = totals(monthItems(m, bills, templates, vendorName, today, vendorKind));
    return { ym: m, total: t.total, left: t.left, budget: budgetFor(m, budgets)?.cents ?? null };
  });
}

// ---------------------------------------------------------------------------
// Rep schedule (#114): worked out from invoice dates, as in the live app.
// ---------------------------------------------------------------------------
export interface RepRow {
  vendorId: string; name: string; visits: number; days: number[]; counts: number[];
  freq: string; last: string; next: string | null;
}
const dow = (d: string) => new Date(toMs(d)).getUTCDay();

/** Vendor bills (not recurring) → the weekdays each vendor usually comes and how often. */
export function repSchedule(bills: Pick<BillRow, 'vendor_id' | 'bill_date' | 'status' | 'recurring_bill_id'>[], vendorName: Map<string, string>, today: string): RepRow[] {
  const by = new Map<string, Set<string>>();
  for (const b of bills) {
    if (b.status === 'void' || b.recurring_bill_id) continue;
    if (!by.has(b.vendor_id)) by.set(b.vendor_id, new Set());
    by.get(b.vendor_id)!.add(b.bill_date);
  }
  const out: RepRow[] = [];
  for (const [vendorId, set] of by) {
    const ds = [...set].sort();
    if (ds.length < 2) continue;
    const counts = [0, 0, 0, 0, 0, 0, 0];
    for (const d of ds) counts[dow(d)]++;
    const days = counts.map((c, i) => [i, c] as const).filter(([, c]) => c >= 2 && c / ds.length >= 0.25)
      .sort((a, b) => b[1] - a[1]).map(([i]) => i);
    const gaps = ds.slice(1).map((d, i) => daysBetween(ds[i], d)).sort((a, b) => a - b);
    const gap = gaps[Math.floor(gaps.length / 2)];
    const freq = gap <= 9 ? 'Weekly' : gap <= 18 ? 'Every 2 weeks' : gap <= 24 ? 'Every 3 weeks' : gap <= 40 ? 'Monthly' : 'Now and then';
    const last = ds[ds.length - 1];
    let next: string | null = null;
    if (days.length && gap <= 40) {
      let c = addDays(last, Math.max(1, gap - 3));
      for (let i = 0; i < 14 && !next; i++, c = addDays(c, 1)) if (days.includes(dow(c))) next = c;
      if (next && next < today) {
        next = null;
        let c2 = today;
        for (let i = 0; i < 7 && !next; i++, c2 = addDays(c2, 1)) if (days.includes(dow(c2))) next = c2;
      }
    }
    out.push({ vendorId, name: vendorName.get(vendorId) ?? 'Vendor', visits: ds.length, days, counts, freq, last, next });
  }
  return out.sort((a, b) => (a.days[0] ?? 9) - (b.days[0] ?? 9) || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Fixed-cost suggestions (#113): withdrawals that repeat month after month.
// ---------------------------------------------------------------------------
export const QUICK_FIXED = ['Rent', 'Credit card fee', 'Utilities', 'Phone & internet', 'Insurance', 'POS / software'] as const;

const normDesc = (s: string) => s.toLowerCase().replace(/[0-9#*]+/g, ' ').replace(/[^a-z& ]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);

/** Bank withdrawals with the same description in 3+ different months. Average amount, usual day. */
export function suggestRecurring(lines: { posted_on: string; description: string; amount_cents: number }[], exclude: string[] = []) {
  const groups = new Map<string, { label: string; months: Set<string>; amounts: number[]; days: number[] }>();
  for (const l of lines) {
    if (Number(l.amount_cents) >= 0) continue;
    const key = normDesc(l.description);
    if (key.length < 3) continue;
    const g = groups.get(key) ?? { label: l.description.trim().slice(0, 60), months: new Set(), amounts: [], days: [] };
    g.months.add(l.posted_on.slice(0, 7)); g.amounts.push(-Number(l.amount_cents)); g.days.push(+l.posted_on.slice(8));
    groups.set(key, g);
  }
  const skip = exclude.map(normDesc).filter(Boolean);
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  return [...groups.entries()]
    .filter(([k, g]) => g.months.size >= 3 && !skip.some((s) => k.includes(s) || s.includes(k)))
    .map(([, g]) => ({ label: g.label, months: g.months.size, avgCents: Math.round(g.amounts.reduce((a, b) => a + b, 0) / g.amounts.length), day: median(g.days) }))
    .sort((a, b) => b.months - a.months || b.avgCents - a.avgCents)
    .slice(0, 8);
}
