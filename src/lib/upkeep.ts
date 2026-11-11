/**
 * Upkeep (#115), copied from the owner's RetailNexa app: recurring maintenance
 * jobs, when each is next due, and what upkeep has cost. Pure; money in cents.
 */
export type Unit = 'days' | 'weeks' | 'months' | 'years';
export interface Task { id: string; name: string; area: string | null; every_n: number; every_unit: Unit; last_done: string | null; vendor: string | null; notes: string | null; is_active: boolean; location_id: string | null; created_at: string }
export interface LogRow { id: string; task_id: string; done_on: string; cost_cents: number; note: string | null }

/** The owner's starter list. */
export const TEMPLATES: { name: string; area: string; every_n: number; every_unit: Unit }[] = [
  { name: 'HVAC filter change', area: 'HVAC', every_n: 3, every_unit: 'months' },
  { name: 'HVAC service', area: 'HVAC', every_n: 6, every_unit: 'months' },
  { name: 'Cooler & freezer coil cleaning', area: 'Refrigeration', every_n: 3, every_unit: 'months' },
  { name: 'Fire extinguisher inspection', area: 'Fire safety', every_n: 1, every_unit: 'years' },
  { name: 'Fire extinguisher monthly check', area: 'Fire safety', every_n: 1, every_unit: 'months' },
  { name: 'Pest control', area: 'Building', every_n: 1, every_unit: 'months' },
  { name: 'Ice machine cleaning', area: 'Equipment', every_n: 6, every_unit: 'months' },
  { name: 'Floor strip & wax', area: 'Building', every_n: 3, every_unit: 'months' },
  { name: 'Security camera & DVR check', area: 'Security', every_n: 1, every_unit: 'months' },
  { name: 'Gutter & roof drain cleaning', area: 'Building', every_n: 6, every_unit: 'months' },
];

const ms = (d: string) => Date.parse(`${d}T00:00:00Z`);
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
export const daysBetween = (a: string, b: string) => Math.round((ms(b) - ms(a)) / 86_400_000);

/** Add an interval to a date; months and years keep the day, clamped to the month's end (Jan 31 + 1 month = Feb 28). */
export function addEvery(d: string, n: number, unit: Unit): string {
  if (unit === 'days' || unit === 'weeks') return iso(ms(d) + n * (unit === 'weeks' ? 7 : 1) * 86_400_000);
  const months = unit === 'years' ? n * 12 : n;
  const y = +d.slice(0, 4), m = +d.slice(5, 7) - 1 + months, day = +d.slice(8, 10);
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return iso(Date.UTC(y, m, Math.min(day, last)));
}

export const everyText = (t: Pick<Task, 'every_n' | 'every_unit'>) =>
  t.every_n === 1 ? `Every ${t.every_unit.replace(/s$/, '')}` : `Every ${t.every_n} ${t.every_unit}`;

export interface Due extends Task { lastDone: string | null; due: string; days: number; status: 'late' | 'soon' | 'ok'; history: LogRow[]; spentCents: number }

/** Each active task with its last-done date (log first, else the starting date), next due date and status. A never-done task is due now. */
export function schedule(tasks: Task[], log: LogRow[], today: string): { active: Due[]; paused: Due[] } {
  const by = new Map<string, LogRow[]>();
  for (const l of log) by.set(l.task_id, [...(by.get(l.task_id) ?? []), { ...l, cost_cents: Number(l.cost_cents) }]);
  const all = tasks.map((t) => {
    const history = (by.get(t.id) ?? []).sort((a, b) => b.done_on.localeCompare(a.done_on));
    const lastDone = [history[0]?.done_on, t.last_done].filter(Boolean).sort().pop() ?? null;
    const due = lastDone ? addEvery(lastDone, t.every_n, t.every_unit) : today;
    const days = daysBetween(today, due);
    return { ...t, lastDone, due, days, status: days < 0 ? 'late' : days <= 14 ? 'soon' : 'ok', history, spentCents: history.reduce((a, l) => a + l.cost_cents, 0) } as Due;
  });
  const order = (a: Due, b: Due) => a.days - b.days || a.name.localeCompare(b.name);
  return { active: all.filter((t) => t.is_active).sort(order), paused: all.filter((t) => !t.is_active).sort(order) };
}

/** Upkeep spending this month and this year, from the log. */
export function spent(log: LogRow[], today: string) {
  const ym = today.slice(0, 7), y = today.slice(0, 4);
  return { month: log.filter((l) => l.done_on.startsWith(ym)).reduce((a, l) => a + Number(l.cost_cents), 0), year: log.filter((l) => l.done_on.startsWith(y)).reduce((a, l) => a + Number(l.cost_cents), 0) };
}
