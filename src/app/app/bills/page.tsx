import type { Metadata } from 'next';
import { can, getOrgContext, getSupabase } from '@/lib/auth/context';
import { Notice } from '@/components/ui';
import { todayIn } from '@/lib/time';
import { daysInMonth, isYm, ymAdd, type BillRow, type Budget, type Kind, type TemplateRow } from '@/lib/bills/due';
import { ReadOnlyNotice } from '../read-only-notice';
import { DueView } from './due-view';

export const metadata: Metadata = { title: 'Due' };

export default async function DuePage({ searchParams }: PageProps<'/app/bills'>) {
  const ctx = await getOrgContext();
  if (!can(ctx, 'bills.view')) return <Notice tone="warning">You don’t have access to bills.</Notice>;
  const sp = await searchParams;
  const supabase = await getSupabase();
  const { data: orgRow } = await supabase.from('organizations').select('timezone').eq('id', ctx.org.id).maybeSingle();
  const today = todayIn(orgRow?.timezone);
  const curYm = today.slice(0, 7);
  const ym = isYm(sp.m) ? sp.m : curYm;
  const K = (sp.k === 'order' || sp.k === 'bill' ? sp.k : 'all') as Kind | 'all';
  const F = (sp.f === 'unpaid' || sp.f === 'paid' ? sp.f : 'all') as 'all' | 'unpaid' | 'paid';
  const lastYm = ymAdd(ym, 5);
  const [{ data: billRows }, { data: tplRows }, { data: vendors }, { data: budgetRows }] = await Promise.all([
    supabase.from('bills').select('id, vendor_id, bill_number, bill_date, due_date, status, total_cents, paid_cents, recurring_bill_id')
      .eq('organization_id', ctx.org.id).neq('status', 'void')
      .gte('due_date', `${ym}-01`).lte('due_date', `${lastYm}-${daysInMonth(lastYm)}`).order('due_date').limit(3000),
    supabase.from('recurring_bills').select('id, vendor_id, name, frequency, day_of_month, next_date, end_date, due_days, is_active, lines')
      .eq('organization_id', ctx.org.id).eq('is_active', true),
    supabase.from('vendors').select('id, name').eq('organization_id', ctx.org.id),
    supabase.from('bill_budgets').select('month, amount_cents').eq('organization_id', ctx.org.id),
  ]);
  const bills = (billRows ?? []) as BillRow[];
  const templates: TemplateRow[] = ((tplRows ?? []) as (Omit<TemplateRow, 'amount_cents'> & { lines: { amount_cents: number }[] })[])
    .map(({ lines, ...t }) => ({ ...t, amount_cents: lines.reduce((a, l) => a + Number(l.amount_cents), 0) }));
  const vendorName = new Map((vendors ?? []).map((v) => [v.id, v.name]));
  const budgets = (budgetRows ?? []) as Budget[];

  return (
    <>
      <ReadOnlyNotice show={can(ctx, 'bills.create') && !ctx.access.canWrite} />
      <DueView ym={ym} curYm={curYm} today={today} K={K} F={F} bills={bills} templates={templates} vendorName={vendorName} budgets={budgets}
        canCreate={can(ctx, 'bills.create') && ctx.access.canWrite} canPay={can(ctx, 'bills.pay') && ctx.access.canWrite} canBudget={can(ctx, 'bills.approve') && ctx.access.canWrite} />
    </>
  );
}
