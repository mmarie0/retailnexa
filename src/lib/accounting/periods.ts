/** Preset reporting periods relative to a business-local "today" (YYYY-MM-DD). */
export type PeriodKey = 'this_month' | 'last_month' | 'this_quarter' | 'ytd' | 'last_year';
export const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: 'this_month', label: 'This month' },
  { key: 'last_month', label: 'Last month' },
  { key: 'this_quarter', label: 'This quarter' },
  { key: 'ytd', label: 'Year to date' },
  { key: 'last_year', label: 'Last year' },
];
const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);

export function periodRange(key: PeriodKey, today: string): { from: string; to: string } {
  const y = +today.slice(0, 4), m = +today.slice(5, 7) - 1;
  switch (key) {
    case 'this_month': return { from: iso(y, m, 1), to: today };
    case 'last_month': return { from: iso(y, m - 1, 1), to: iso(y, m, 0) };
    case 'this_quarter': return { from: iso(y, m - (m % 3), 1), to: today };
    case 'ytd': return { from: iso(y, 0, 1), to: today };
    case 'last_year': return { from: iso(y - 1, 0, 1), to: iso(y - 1, 11, 31) };
  }
}
