import type { Metadata } from 'next';
import { can, getOrgContext, getSupabase } from '@/lib/auth/context';
import { Card, Field, Input, Notice } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';
import { formatMoney } from '@/lib/billing/plans';
import { parseDollarsToCents } from '@/lib/money';
import { todayIn } from '@/lib/time';
import { daysIn, ymAdd } from '@/lib/dashboard/overview';
import { monthItems, totals, type BillRow, type TemplateRow } from '@/lib/bills/due';
import { openTotals } from '@/lib/bills/balances';
import { cashYouCanTake } from '@/lib/profit/partners';
import { Stat } from '../../_dashboard/tiles';
import { payrollPaid, scheduledPayroll } from '../../_dashboard/data';
import { loadBalances } from '../../bills/balances/_load';
import { ProfitTabs } from '../tabs';

export const metadata: Metadata = { title: 'Profit calculator' };
const cents = (v: unknown, d: number) => (typeof v === 'string' && v.trim() ? parseDollarsToCents(v) ?? d : d);

/** #104 Profit calculator: "cash you can take" (the owner's formula). Nothing is saved; the numbers live in the address bar. */
export default async function CalculatorPage({ searchParams }: PageProps<'/app/profit/calculator'>) {
  const ctx = await getOrgContext();
  if (!can(ctx, 'profit.view') || !can(ctx, 'bills.view') || !can(ctx, 'payroll.view')) {
    return <><ProfitTabs active="/app/profit/calculator" /><Notice tone="warning">The calculator needs access to profit, bills and payroll.</Notice></>;
  }
  const sp = await searchParams;
  const supabase = await getSupabase();
  const { data: tz } = await supabase.from('organizations').select('timezone').eq('id', ctx.org.id).maybeSingle();
  const today = todayIn(tz?.timezone), ym = today.slice(0, 7), next = ymAdd(ym, 1);
  const [bills, tpls, vendors, sched, paid, bal] = await Promise.all([
    supabase.from('bills').select('id, vendor_id, bill_number, bill_date, due_date, status, total_cents, paid_cents, recurring_bill_id')
      .eq('organization_id', ctx.org.id).neq('status', 'void').gte('due_date', `${ym}-01`).lte('due_date', `${next}-15`).limit(3000),
    supabase.from('recurring_bills').select('id, vendor_id, name, frequency, day_of_month, next_date, end_date, due_days, is_active, lines').eq('organization_id', ctx.org.id).eq('is_active', true),
    supabase.from('vendors').select('id, name').eq('organization_id', ctx.org.id),
    scheduledPayroll(ctx, `${ym}-01`, `${ym}-${daysIn(ym)}`),
    payrollPaid(supabase, ctx.org.id, `${ym}-01`, `${ym}-${daysIn(ym)}`),
    loadBalances(ctx),
  ]);
  const templates = ((tpls.data ?? []) as (Omit<TemplateRow, 'amount_cents'> & { lines: { amount_cents: number }[] })[])
    .map(({ lines, ...t }) => ({ ...t, amount_cents: lines.reduce((a, l) => a + Number(l.amount_cents), 0) }));
  const names = new Map((vendors.data ?? []).map((v) => [v.id as string, v.name as string]));
  const rows = (bills.data ?? []) as BillRow[];
  const unpaidThisMonth = totals(monthItems(ym, rows, templates, names, today)).left;
  const nextMonthEarlyBills = monthItems(next, rows, templates, names, today).filter((i) => i.dueDate <= `${next}-15`).reduce((a, i) => a + i.leftCents, 0);
  const unrunPayroll = Math.max(0, sched - paid.cents);
  const owedToStores = openTotals(bal.balances).iOwe;
  const input = { safe: cents(sp.safe, 0), bank: cents(sp.bank, 0), reserve: cents(sp.reserve, 0) };
  const r = cashYouCanTake({ ...input, nextMonthEarlyBills, unpaidThisMonth, unrunPayroll, owedToStores });
  const $ = (c: number) => (c / 100).toFixed(2);
  const line = (label: string, v: number, sign = '−') => (
    <div className="flex justify-between gap-3 border-t border-line py-1.5"><dt>{label}</dt><dd className="num">{sign} {formatMoney(v)}</dd></div>
  );

  return (
    <>
      <h1 className="text-[26px] font-extrabold tracking-[-.02em]">Profit calculator</h1>
      <ProfitTabs active="/app/profit/calculator" />
      <form action="/app/profit/calculator" className="grid gap-3 sm:grid-cols-4">
        <Field label="Cash in the safe" htmlFor="c-safe"><Input id="c-safe" name="safe" inputMode="decimal" className="num" defaultValue={$(input.safe)} /></Field>
        <Field label="Bank balance" htmlFor="c-bank"><Input id="c-bank" name="bank" inputMode="decimal" className="num" defaultValue={$(input.bank)} /></Field>
        <Field label="Keep at least" htmlFor="c-res" hint="Your own cushion; leave 0 if none"><Input id="c-res" name="reserve" inputMode="decimal" className="num" defaultValue={$(input.reserve)} /></Field>
        <div className="self-end"><SubmitButton>Work it out</SubmitButton></div>
      </form>
      <Stat hero block={r.short ? 'coral' : 'sunset'} label="Cash you can take" value={formatMoney(r.take)} sub={r.short ? `You’re ${formatMoney(r.short)} short of what’s set aside.` : 'After everything below is covered.'} />
      <Card>
        <dl className="text-[15px]">
          <div className="flex justify-between gap-3 py-1.5 font-semibold"><dt>Safe + bank</dt><dd className="num">{formatMoney(r.cash)}</dd></div>
          {line(`Keep: the larger of your reserve and bills due ${next.slice(5)}/1–15 (${formatMoney(nextMonthEarlyBills)})`, r.hold)}
          {line('Still unpaid on this month’s bills', unpaidThisMonth)}
          {line(`Payroll not run yet this month (scheduled ${formatMoney(sched)}, paid ${formatMoney(paid.cents)})`, unrunPayroll)}
          {line('What you owe other stores', owedToStores)}
        </dl>
      </Card>
      <p className="text-sm text-muted">Nothing here is saved. Bills include recurring bills not created yet. A guide, not tax or accounting advice.</p>
    </>
  );
}
