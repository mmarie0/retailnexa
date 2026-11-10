import type { Metadata } from 'next';
import Link from 'next/link';
import { can, getOrgContext, getSupabase } from '@/lib/auth/context';
import { Card, Input, Notice, PageHeader, buttonClass, cx } from '@/components/ui';
import { incomeStatement, type LedgerRow } from '@/lib/accounting/statements';
import { PERIODS, periodRange, type PeriodKey } from '@/lib/accounting/periods';
import { todayIn } from '@/lib/time';
import { AccountingTabs } from '../nav';
import { StatementSection, TotalRow } from '../statement-ui';

export const metadata: Metadata = { title: 'Profit & loss' };
const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });

export default async function ProfitLossPage({ searchParams }: PageProps<'/app/accounting/profit-loss'>) {
  const ctx = await getOrgContext();
  if (!can(ctx, 'accounting.view') && !can(ctx, 'profit.view')) return <Notice tone="warning">Only owners, admins and accountants can see financial statements.</Notice>;
  const sp = await searchParams;
  const supabase = await getSupabase();
  const { data: orgRow } = await supabase.from('organizations').select('timezone').eq('id', ctx.org.id).maybeSingle();
  const today = todayIn(orgRow?.timezone);
  const preset = PERIODS.find((p) => p.key === sp.period)?.key as PeriodKey | undefined;
  const custom = isDate(sp.from) && isDate(sp.to) && sp.from <= sp.to;
  const range = custom ? { from: sp.from as string, to: sp.to as string } : periodRange(preset ?? 'this_month', today);
  const active = custom ? null : (preset ?? 'this_month');

  const { data, error } = await supabase.rpc('account_activity_detail', { p_org: ctx.org.id, p_from: range.from, p_to: range.to });
  if (error) return <Notice tone="danger">The statement couldn’t be loaded. Check the dates and try again.</Notice>;
  const rows: LedgerRow[] = ((data ?? []) as { account_id: string; code: string; name: string; type: LedgerRow['type']; role: string | null; net_cents: number }[])
    .map((r) => ({ id: r.account_id, code: r.code, name: r.name, type: r.type, role: r.role, net: Number(r.net_cents) }));
  const p = incomeStatement(rows);
  const noCogs = p.cogs.total === 0 && p.revenue.total > 0;

  return (
    <>
      <PageHeader title="Profit & loss" description={`${fmt(range.from)} – ${fmt(range.to)} · accrual basis: sales when made, bills when approved.`} />
      {can(ctx, 'accounting.view') && <AccountingTabs active="/app/accounting/profit-loss" />}
      <div className="flex flex-wrap items-end gap-3">
        <nav aria-label="Period" className="flex flex-wrap gap-1 rounded-full bg-soft p-1">
          {PERIODS.map((x) => (
            <Link key={x.key} href={`/app/accounting/profit-loss?period=${x.key}`} aria-current={active === x.key ? 'page' : undefined}
              className={cx('rounded-full px-3 py-1.5 text-sm font-semibold', active === x.key ? 'bg-card text-ink shadow-[var(--shadow-card)]' : 'text-muted hover:text-ink')}>{x.label}</Link>
          ))}
        </nav>
        <form className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-sm font-semibold">From<Input type="date" name="from" defaultValue={range.from} className="w-auto" /></label>
          <label className="flex flex-col gap-1 text-sm font-semibold">To<Input type="date" name="to" defaultValue={range.to} className="w-auto" /></label>
          <button className={buttonClass('secondary')}>Show</button>
        </form>
      </div>
      {noCogs && <Notice tone="warning">Cost of goods sold is $0 because inventory isn’t tracked yet, so gross profit equals net sales. Treat margins as incomplete.</Notice>}
      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[420px] text-[15px]">
          <caption className="sr-only">Profit and loss statement</caption>
          <StatementSection section={p.revenue} totalLabel="Net sales" />
          <StatementSection section={p.cogs} />
          <TotalRow label="Gross profit" cents={p.grossProfit} />
          <StatementSection section={p.operatingExpenses} />
          <TotalRow label="Operating profit" cents={p.operatingProfit} />
          {p.otherIncome.lines.length > 0 && <StatementSection section={p.otherIncome} />}
          {p.otherExpenses.lines.length > 0 && <StatementSection section={p.otherExpenses} />}
          <TotalRow label="Net income" cents={p.netIncome} strong />
        </table>
      </Card>
    </>
  );
}
