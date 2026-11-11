import 'server-only';
import { getSupabase, type OrgContext } from '@/lib/auth/context';
import { addDays } from '@/lib/dashboard/overview';
import type { Report, Rollup } from '@/lib/dashboard/overview';
import { laborDay } from '@/lib/staff/payroll';
import { loadStaff } from '../staff/_data';

type Sb = Awaited<ReturnType<typeof getSupabase>>;

/** Daily sales rolled up per store and day or month; RLS decides which stores count. */
export async function salesRollups(sb: Sb, org: string, from: string, to: string, by: 'day' | 'month'): Promise<Rollup[]> {
  const { data, error } = await sb.rpc('sales_rollup', { p_org: org, p_from: from, p_to: to, p_by: by });
  if (error) throw error;
  return ((data ?? []) as Rollup[]).map((r) => ({ ...r, net_cents: Number(r.net_cents), tax_cents: Number(r.tax_cents), days: Number(r.days) }));
}

/** Uploaded monthly reports whose month starts within [from, to]. */
export async function monthReports(sb: Sb, org: string, from: string, to: string): Promise<Report[]> {
  const { data, error } = await sb.from('sales_months').select('location_id, month, sales_cents, tax_cents')
    .eq('organization_id', org).gte('month', from).lte('month', to);
  if (error) throw error;
  return ((data ?? []) as Report[]).map((r) => ({ ...r, sales_cents: Number(r.sales_cents), tax_cents: Number(r.tax_cents) }));
}

/** Bills (not void) by due month: { 'YYYY-MM': { total, paid } }. */
export async function billTotals(sb: Sb, org: string, from: string, to: string) {
  const { data, error } = await sb.rpc('bill_month_totals', { p_org: org, p_from: from, p_to: to });
  if (error) throw error;
  return new Map(((data ?? []) as { month: string; total_cents: number; paid_cents: number }[])
    .map((r) => [String(r.month).slice(0, 7), { total: Number(r.total_cents), paid: Number(r.paid_cents) }]));
}

/** What pay runs (not void) paid between the dates: gross pay plus employer taxes, summed in the database (#168). */
export async function payrollPaid(sb: Sb, org: string, from: string, to: string): Promise<{ cents: number; runs: number }> {
  const { data, error } = await sb.rpc('payroll_paid', { p_org: org, p_from: from, p_to: to });
  if (error) throw error;
  const row = ((data ?? []) as { cents: number; runs: number }[])[0];
  return { cents: Number(row?.cents ?? 0), runs: Number(row?.runs ?? 0) };
}

/** Payroll the schedule says the dates will cost (hourly from shifts or regular weeks, salary per day, with burden). */
export async function scheduledPayroll(ctx: OrgContext, from: string, to: string): Promise<number> {
  const s = await loadStaff(ctx, () => ({ from, to }));
  let cents = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) cents += laborDay(d, s.employees, s.pays, s.idx, s.rules).costCents;
  return cents;
}
