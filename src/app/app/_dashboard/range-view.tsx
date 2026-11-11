import { getSupabase, type OrgContext } from '@/lib/auth/context';
import { Card, Notice } from '@/components/ui';
import { formatMoney } from '@/lib/billing/plans';
import { addDays, dailyAverage, daysBetween, lastYearOf, pct, salesByMonth, ymAdd, type Range, type Report, type Rollup } from '@/lib/dashboard/overview';
import { billTotals, monthReports, payrollPaid, salesRollups, scheduledPayroll } from './data';
import { DailySalesChart } from './daily-sales-chart';
import { TrendChart } from './trend-chart';
import { Pct, Stat } from './tiles';

const money0 = (c: number) => formatMoney(Math.round(c / 100) * 100).replace(/\.00$/, '');
const fmt = (d: string, year = true) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', ...(year ? { year: 'numeric' } : {}) });
const lastOf = (ym: string) => `${ym}-${new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).getUTCDate()}`;
/** Monthly reports count only for whole months inside the dates (a report has no days to split). */
const wholeMonths = (reps: Report[], from: string, to: string) => reps.filter((r) => r.month.slice(0, 10) >= from && lastOf(r.month.slice(0, 7)) <= to);

async function salesFor(sb: Awaited<ReturnType<typeof getSupabase>>, org: string, from: string, to: string) {
  const [rolls, reps] = await Promise.all([salesRollups(sb, org, from, to, 'month'), monthReports(sb, org, from, to)]);
  const use = wholeMonths(reps, from, to);
  const months = salesByMonth(rolls, use);
  let net = 0, tax = 0;
  for (const m of months.values()) { net += m.net; tax += m.tax; }
  // Daily average from daily entries only (stores whose whole month came from a report have no days).
  const covered = new Set(use.map((r) => `${r.location_id}|${r.month.slice(0, 7)}`));
  const avg = dailyAverage(rolls.filter((r: Rollup) => !covered.has(`${r.location_id}|${r.period.slice(0, 7)}`)));
  return { net, tax, any: rolls.length > 0 || use.length > 0, months, avg, reportMonths: use.length };
}

/** Overview for a date range, with last year's matching dates (#108). */
export async function RangeView({ ctx, range, perm }: { ctx: OrgContext; range: Range; perm: { sales: boolean; bills: boolean; payroll: boolean; profit: boolean } }) {
  const sb = await getSupabase();
  const org = ctx.org.id, ly = lastYearOf(range), days = daysBetween(range.from, range.to) + 1;
  const [cur, prev, daily, bills, lyBills, pay, lyPay] = await Promise.all([
    perm.sales ? salesFor(sb, org, range.from, range.to) : null,
    perm.sales ? salesFor(sb, org, ly.from, ly.to) : null,
    perm.sales && days <= 62 ? salesRollups(sb, org, range.from, range.to, 'day') : null,
    perm.bills ? billTotals(sb, org, range.from, range.to) : null,
    perm.profit ? billTotals(sb, org, ly.from, ly.to) : null,
    perm.payroll ? payrollPaid(sb, org, range.from, range.to) : null,
    perm.profit ? payrollPaid(sb, org, ly.from, ly.to) : null,
  ]);
  const payEst = pay && pay.runs === 0 ? await scheduledPayroll(ctx, range.from, range.to) : null;
  const payUse = pay ? (pay.runs ? pay.cents : payEst ?? 0) : null;
  const sum = (m: Map<string, { total: number; paid: number }> | null) => {
    let total = 0, paid = 0;
    for (const v of m?.values() ?? []) { total += v.total; paid += v.paid; }
    return { total, paid, left: total - paid };
  };
  const b = bills ? sum(bills) : null, lb = lyBills ? sum(lyBills) : null;
  const profit = perm.profit && cur?.any && b && payUse !== null ? cur.net + cur.tax - b.total - payUse : null;
  const lyProfit = perm.profit && prev?.any && lb && lyPay?.runs ? prev.net + prev.tax - lb.total - lyPay.cents : null;

  const chart = (() => {
    if (!cur) return null;
    if (daily) {
      const by = new Map<string, number>();
      for (const r of daily) by.set(r.period, (by.get(r.period) ?? 0) + Number(r.net_cents));
      const points = Array.from({ length: days }, (_, i) => { const d = addDays(range.from, i); return { date: d, netCents: by.get(d) ?? null }; });
      return <DailySalesChart points={points} title="Net sales by day" />;
    }
    const pts: { ym: string; cents: number | null; lastYearCents: number | null; projected: boolean }[] = [];
    for (let m = range.from.slice(0, 7), k = 0; m <= range.to.slice(0, 7) && k < 25; m = ymAdd(m, 1), k++) {
      pts.push({ ym: m, cents: cur.months.get(m)?.net ?? null, lastYearCents: prev?.months.get(ymAdd(m, -12))?.net ?? null, projected: false });
    }
    return <TrendChart points={pts} title="Net sales by month" />;
  })();

  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[20px] font-bold tracking-tight">{fmt(range.from)} – {fmt(range.to)}</h2>
        <span className="text-sm text-muted">vs {ly.sameWeekdays ? 'same weekdays' : 'same dates'} last year ({fmt(ly.from, false)} – {fmt(ly.to)})</span>
      </div>
      {!perm.sales && !perm.bills && <Notice tone="warning">You don’t have access to sales or bills.</Notice>}
      <div className="grid grid-cols-2 gap-3">
        {cur && <Stat block="blue" label="Net sales" value={money0(cur.net)}
          sub={prev?.any ? <>{money0(prev.net)} last year <Pct v={pct(cur.net, prev.net)} /></> : 'No sales last year for these dates'} />}
        {cur && <Stat label="Daily average" value={cur.avg.cents === null ? '—' : money0(cur.avg.cents)}
          sub={<>{cur.avg.days} day{cur.avg.days === 1 ? '' : 's'} with sales{cur.reportMonths ? ' (plus monthly reports)' : ''}{prev?.avg.cents ? <> · LY {money0(prev.avg.cents)} <Pct v={pct(cur.avg.cents, prev.avg.cents)} /></> : null}</>} />}
        {payUse !== null && <Stat block="indigo" label="Payroll" value={money0(payUse)} sub={pay!.runs ? `${pay!.runs} pay run${pay!.runs === 1 ? '' : 's'} paid` : 'Estimated from schedules'} />}
        {b && <Stat label="Bills due" value={money0(b.total)} sub={`${money0(b.paid)} paid · ${money0(b.left)} left`} />}
      </div>
      {perm.profit && (
        <Stat block={profit !== null && profit < 0 ? 'coral' : 'sunset'} label="Profit for these dates" value={profit === null ? '—' : money0(profit)}
          sub={profit === null ? 'No sales recorded for these dates' : <>Sales {money0(cur!.net)} + tax {money0(cur!.tax)} − bills {money0(b!.total)} − payroll {money0(payUse!)}{lyProfit !== null ? <> · last year {money0(lyProfit)} <Pct v={pct(profit, lyProfit)} /></> : null}</>} />
      )}
      {chart && <Card>{chart}</Card>}
    </>
  );
}
