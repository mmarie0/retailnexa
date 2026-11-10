import { averageTicketCents, comparableDate, pctChange } from '@/lib/finance/metrics';

/** One recorded (non-void) register-day. */
export interface SalesDayLite {
  date: string; // YYYY-MM-DD
  netCents: number; // gross − discounts, excl. tax
  transactions: number | null;
}

const DAY = 86_400_000;
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const inRange = (d: string, from: string, to: string) => d >= from && d <= to;

function total(days: SalesDayLite[], from: string, to: string) {
  let net = 0, tx = 0, reported = 0;
  const dates = new Set<string>();
  for (const d of days) {
    if (!inRange(d.date, from, to)) continue;
    net += d.netCents;
    if (d.transactions != null) { tx += d.transactions; reported++; }
    dates.add(d.date);
  }
  return { net, tx, hasTx: reported > 0, daysWithSales: dates.size };
}

export interface SalesSummary {
  today: { date: string; netCents: number | null };
  yesterday: { date: string; netCents: number | null };
  last7: { netCents: number; changePct: number | null };
  monthToDate: { from: string; to: string; netCents: number; lastYearCents: number | null; changePct: number | null; avgTicketCents: number | null };
  /** Last 14 days oldest → newest; null = no report recorded that day. */
  daily: { date: string; netCents: number | null }[];
}

/**
 * Builds the sales tiles and 14-day series. `days` must cover from
 * min(monthStart, today − 13) through today, plus last year's comparable
 * month-to-date window (364 days earlier, same weekdays) if available.
 */
export function summarizeSales(days: SalesDayLite[], today: string): SalesSummary {
  const byDate = new Map<string, number>();
  for (const d of days) byDate.set(d.date, (byDate.get(d.date) ?? 0) + d.netCents);
  const yesterday = addDays(today, -1);
  const last7 = total(days, addDays(today, -6), today);
  const prior7 = total(days, addDays(today, -13), addDays(today, -7));
  const monthStart = `${today.slice(0, 8)}01`;
  const mtd = total(days, monthStart, today);
  const lyFrom = comparableDate(monthStart);
  const lyTo = comparableDate(today);
  const ly = total(days, lyFrom, lyTo);
  return {
    today: { date: today, netCents: byDate.get(today) ?? null },
    yesterday: { date: yesterday, netCents: byDate.get(yesterday) ?? null },
    last7: { netCents: last7.net, changePct: prior7.daysWithSales ? pctChange(last7.net, prior7.net) : null },
    monthToDate: {
      from: monthStart, to: today, netCents: mtd.net,
      lastYearCents: ly.daysWithSales ? ly.net : null,
      changePct: ly.daysWithSales ? pctChange(mtd.net, ly.net) : null,
      avgTicketCents: mtd.hasTx ? averageTicketCents(mtd.net, mtd.tx) : null,
    },
    daily: Array.from({ length: 14 }, (_, i) => {
      const date = addDays(today, i - 13);
      return { date, netCents: byDate.get(date) ?? null };
    }),
  };
}

/** Date windows the caller needs to fetch for summarizeSales. */
export function salesWindows(today: string) {
  const monthStart = `${today.slice(0, 8)}01`;
  const recentFrom = [monthStart, addDays(today, -13)].sort()[0];
  return { recent: { from: recentFrom, to: today }, lastYear: { from: comparableDate(monthStart), to: comparableDate(today) } };
}

export interface BillLite { status: string; dueDate: string; openCents: number }
export function summarizeBills(bills: BillLite[], today: string) {
  const soon = addDays(today, 7);
  let unpaid = 0, overdue = 0, dueSoon = 0, overdueCount = 0, drafts = 0;
  for (const b of bills) {
    if (b.status === 'draft') { drafts++; continue; }
    if (b.status !== 'approved') continue;
    unpaid += b.openCents;
    if (b.dueDate < today) { overdue += b.openCents; overdueCount++; }
    else if (b.dueDate <= soon) dueSoon += b.openCents;
  }
  return { unpaidCents: unpaid, overdueCents: overdue, overdueCount, dueNext7Cents: dueSoon, drafts };
}
