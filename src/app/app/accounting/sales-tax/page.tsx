import type { Metadata } from 'next';
import Link from 'next/link';
import { can, getOrgContext, getSupabase } from '@/lib/auth/context';
import { Card, Input, LinkButton, Notice, PageHeader, buttonClass, cx } from '@/components/ui';
import { formatMoney } from '@/lib/billing/plans';
import { PERIODS, periodRange, type PeriodKey } from '@/lib/accounting/periods';
import { todayIn } from '@/lib/time';
import { AccountingTabs } from '../nav';

export const metadata: Metadata = { title: 'Sales tax' };
const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });

export default async function SalesTaxPage({ searchParams }: PageProps<'/app/accounting/sales-tax'>) {
  const ctx = await getOrgContext();
  if (!can(ctx, 'accounting.view')) return <Notice tone="warning">Only owners, admins and accountants can see the books.</Notice>;
  const sp = await searchParams;
  const supabase = await getSupabase();
  const { data: orgRow } = await supabase.from('organizations').select('timezone').eq('id', ctx.org.id).maybeSingle();
  const today = todayIn(orgRow?.timezone);
  const preset = (PERIODS.find((p) => p.key === sp.period)?.key ?? 'last_month') as PeriodKey;
  const custom = isDate(sp.from) && isDate(sp.to) && sp.from <= sp.to;
  const range = custom ? { from: sp.from as string, to: sp.to as string } : periodRange(preset, today);
  const { data, error } = await supabase.rpc('sales_tax_summary', { p_org: ctx.org.id, p_from: range.from, p_to: range.to });
  if (error) return <Notice tone="danger">The sales tax summary couldn’t be loaded. Try again.</Notice>;
  const s = ((data ?? [])[0] ?? { opening_cents: 0, collected_cents: 0, paid_cents: 0, closing_cents: 0 }) as Record<string, number>;
  const row = (label: string, cents: number, strong = false) => (
    <tr className={cx('border-t border-line', strong && 'font-bold')}><td className="px-5 py-2.5">{label}</td><td className="num px-5 text-end">{formatMoney(Number(cents))}</td></tr>
  );

  return (
    <>
      <PageHeader title="Sales tax" description={`${fmt(range.from)} – ${fmt(range.to)}. Tax collected on recorded sales and payments made to the state.`}
        actions={can(ctx, 'accounting.post') && ctx.access.canWrite ? <LinkButton href="/app/deposits" variant="secondary">Record a payment</LinkButton> : undefined} />
      <AccountingTabs active="/app/accounting/sales-tax" />
      <div className="flex flex-wrap items-end gap-3">
        <nav aria-label="Period" className="flex flex-wrap gap-1 rounded-full bg-soft p-1">
          {PERIODS.map((x) => (
            <Link key={x.key} href={`/app/accounting/sales-tax?period=${x.key}`} aria-current={!custom && preset === x.key ? 'page' : undefined}
              className={cx('rounded-full px-3 py-1.5 text-sm font-semibold', !custom && preset === x.key ? 'bg-card text-ink shadow-[var(--shadow-card)]' : 'text-muted hover:text-ink')}>{x.label}</Link>
          ))}
        </nav>
        <form className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-sm font-semibold">From<Input type="date" name="from" defaultValue={range.from} className="w-auto" /></label>
          <label className="flex flex-col gap-1 text-sm font-semibold">To<Input type="date" name="to" defaultValue={range.to} className="w-auto" /></label>
          <button className={buttonClass('secondary')}>Show</button>
        </form>
      </div>
      <Card className="max-w-xl p-0">
        <table className="w-full text-[15px]">
          <caption className="sr-only">Sales tax summary</caption>
          <tbody>
            {row(`Owed on ${fmt(range.from)}`, s.opening_cents)}
            {row('+ Collected on sales', s.collected_cents)}
            {row('− Paid to the state', s.paid_cents)}
            {row(`Owed on ${fmt(range.to)}`, s.closing_cents, true)}
          </tbody>
        </table>
      </Card>
      {Number(s.closing_cents) < 0 && <Notice tone="warning">Payments are more than the tax collected. Check for a payment entered twice or sales not yet recorded.</Notice>}
      <p className="text-sm text-muted">Based on sales recorded in RetailNexa (accrual). Check the amounts against your state return before filing; RetailNexa doesn’t file for you.</p>
    </>
  );
}
