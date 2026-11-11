import 'server-only';
import { can, getSupabase, type OrgContext } from '@/lib/auth/context';
import { todayIn } from '@/lib/time';
import { daysIn, projectMonth, salesByMonth, ymAdd } from '@/lib/dashboard/overview';
import { byMonth } from '@/lib/bills/balances';
import { monthProfit, type MonthProfit } from '@/lib/profit/partners';
import { billTotals, monthReports, payrollPaid, salesRollups, scheduledPayroll } from '../_dashboard/data';
import { loadBalances } from '../bills/balances/_load';

/**
 * Profit by month for a year (#104), the owner's formula: sales + tax + what
 * other stores owe − bills due − what you owe other stores − payroll. This
 * month uses sales on pace and payroll as the larger of scheduled and paid.
 * A manual profit for a month wins.
 */
export async function loadProfitYear(ctx: OrgContext, year: number) {
  const supabase = await getSupabase();
  const { data: tz } = await supabase.from('organizations').select('timezone').eq('id', ctx.org.id).maybeSingle();
  const today = todayIn(tz?.timezone), ym = today.slice(0, 7);
  const from = `${year}-01-01`, to = `${year}-12-31` < today ? `${year}-12-31` : today;
  const canBills = can(ctx, 'bills.view'), canPay = can(ctx, 'payroll.view');
  const empty = from > to;
  const [rolls, reps, bills, pay, manual, bal, schedNow, paidNow] = await Promise.all([
    empty ? [] : salesRollups(supabase, ctx.org.id, from, to, 'month'),
    empty ? [] : monthReports(supabase, ctx.org.id, from, to),
    canBills && !empty ? billTotals(supabase, ctx.org.id, from, `${year}-12-31` < `${ym}-${daysIn(ym)}` ? `${year}-12-31` : `${ym}-${daysIn(ym)}`) : new Map<string, { total: number; paid: number }>(),
    canPay && !empty ? supabase.rpc('payroll_by_month', { p_org: ctx.org.id, p_from: from, p_to: to }) : Promise.resolve({ data: [] as { month: string; cents: number }[], error: null }),
    supabase.from('profit_months').select('month, profit_cents, note').eq('organization_id', ctx.org.id).gte('month', from).lte('month', `${year}-12-01`),
    canBills ? loadBalances(ctx) : null,
    canPay && ym.startsWith(String(year)) ? scheduledPayroll(ctx, `${ym}-01`, `${ym}-${daysIn(ym)}`) : null,
    canPay && ym.startsWith(String(year)) ? payrollPaid(supabase, ctx.org.id, `${ym}-01`, `${ym}-${daysIn(ym)}`) : null,
  ]);
  if (pay.error) throw pay.error;
  const sales = salesByMonth(rolls, reps), projected = projectMonth(ym, rolls, reps);
  const payBy = new Map(((pay.data ?? []) as { month: string; cents: number }[]).map((r) => [String(r.month).slice(0, 7), Number(r.cents)]));
  const manualBy = new Map((manual.data ?? []).map((r) => [String(r.month).slice(0, 7), { profit_cents: Number(r.profit_cents), note: r.note as string | null }]));
  const balBy = bal ? byMonth(bal.balances) : new Map<string, { in: number; out: number }>();
  const months: (MonthProfit & { projected: boolean })[] = [];
  for (let m = `${year}-01`; m <= `${year}-12` && m <= ym; m = ymAdd(m, 1)) {
    const cur = m === ym;
    const s = cur && projected ? projected : sales.get(m) ?? null;
    const payroll = cur && schedNow !== null ? Math.max(schedNow, paidNow?.cents ?? 0) : payBy.get(m) ?? 0;
    months.push({ ...monthProfit(m, { sales: s?.net ?? null, tax: s?.tax ?? 0, bills: bills.get(m)?.total ?? 0, payroll, balancesIn: balBy.get(m)?.in ?? 0, balancesOut: balBy.get(m)?.out ?? 0 }, manualBy.get(m)), projected: cur && !manualBy.has(m) });
  }
  return { today, months, canBills, canPay };
}
