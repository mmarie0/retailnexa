import type { Metadata } from 'next';
import Link from 'next/link';
import { can, getOrgContext, getSupabase } from '@/lib/auth/context';
import { Card, Input, Notice, PageHeader, buttonClass, cx } from '@/components/ui';
import { formatMoney } from '@/lib/billing/plans';
import { PERIODS, periodRange, type PeriodKey } from '@/lib/accounting/periods';
import { cashFlow, type BalanceRow, type FlowLine } from '@/lib/accounting/cash-flow';
import { todayIn } from '@/lib/time';
import { AccountingTabs } from '../nav';

export const metadata: Metadata = { title: 'Cash flow' };
const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });
const dayBefore = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

function Section({ title, lines, total }: { title: string; lines: FlowLine[]; total: number }) {
  return (
    <tbody>
      <tr><th colSpan={2} scope="colgroup" className="px-5 pb-1 pt-4 text-start text-sm font-bold uppercase tracking-wide text-muted">{title}</th></tr>
      {lines.length === 0 && <tr><td colSpan={2} className="px-5 py-1.5 text-muted">Nothing in this period</td></tr>}
      {lines.map((l) => (
        <tr key={l.id}><td className="px-5 py-1.5">{l.label}</td><td className={cx('num px-5 text-end', l.amount < 0 && 'text-late')}>{formatMoney(l.amount)}</td></tr>
      ))}
      <tr className="border-t border-line font-semibold"><td className="px-5 py-2">Net cash from {title.toLowerCase()}</td><td className="num px-5 text-end">{formatMoney(total)}</td></tr>
    </tbody>
  );
}

export default async function CashFlowPage({ searchParams }: PageProps<'/app/accounting/cash-flow'>) {
  const ctx = await getOrgContext();
  if (!can(ctx, 'accounting.view')) return <Notice tone="warning">Only owners, admins and accountants can see the books.</Notice>;
  const sp = await searchParams;
  const supabase = await getSupabase();
  const { data: orgRow } = await supabase.from('organizations').select('timezone').eq('id', ctx.org.id).maybeSingle();
  const today = todayIn(orgRow?.timezone);
  const preset = (PERIODS.find((p) => p.key === sp.period)?.key ?? 'this_month') as PeriodKey;
  const custom = isDate(sp.from) && isDate(sp.to) && sp.from <= sp.to;
  const range = custom ? { from: sp.from as string, to: sp.to as string } : periodRange(preset, today);

  const [startTb, endTb, accounts] = await Promise.all([
    supabase.rpc('trial_balance', { p_org: ctx.org.id, p_as_of: dayBefore(range.from) }),
    supabase.rpc('trial_balance', { p_org: ctx.org.id, p_as_of: range.to }),
    supabase.from('accounts').select('id, role').eq('organization_id', ctx.org.id),
  ]);
  if (startTb.error || endTb.error || accounts.error) return <Notice tone="danger">The cash flow statement couldn’t be loaded. Try again.</Notice>;
  const roles = new Map((accounts.data ?? []).map((a) => [a.id, a.role as string | null]));
  const rows = (d: unknown): BalanceRow[] => ((d ?? []) as { account_id: string; code: string; name: string; type: BalanceRow['type']; balance_cents: number }[])
    .map((r) => ({ id: r.account_id, code: r.code, name: r.name, type: r.type, role: roles.get(r.account_id) ?? null, balance: Number(r.balance_cents) }));
  const cf = cashFlow(rows(startTb.data), rows(endTb.data));

  return (
    <>
      <PageHeader title="Cash flow" description={`${fmt(range.from)} – ${fmt(range.to)} · where cash came from and went, starting from net income (indirect method).`} />
      <AccountingTabs active="/app/accounting/cash-flow" />
      <div className="flex flex-wrap items-end gap-3">
        <nav aria-label="Period" className="flex flex-wrap gap-1 rounded-full bg-soft p-1">
          {PERIODS.map((x) => (
            <Link key={x.key} href={`/app/accounting/cash-flow?period=${x.key}`} aria-current={!custom && preset === x.key ? 'page' : undefined}
              className={cx('rounded-full px-3 py-1.5 text-sm font-semibold', !custom && preset === x.key ? 'bg-card text-ink shadow-[var(--shadow-card)]' : 'text-muted hover:text-ink')}>{x.label}</Link>
          ))}
        </nav>
        <form className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-sm font-semibold">From<Input type="date" name="from" defaultValue={range.from} className="w-auto" /></label>
          <label className="flex flex-col gap-1 text-sm font-semibold">To<Input type="date" name="to" defaultValue={range.to} className="w-auto" /></label>
          <button className={buttonClass('secondary')}>Show</button>
        </form>
      </div>
      {!cf.ties && <Notice tone="danger">The sections add up to {formatMoney(cf.netChange)} but cash changed by {formatMoney(cf.cashEnd - cf.cashStart)}. This should never happen — contact support.</Notice>}
      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[420px] text-[15px]">
          <caption className="sr-only">Cash flow statement</caption>
          <Section title="Operating activities" lines={cf.operating} total={cf.operatingTotal} />
          <Section title="Investing activities" lines={cf.investing} total={cf.investingTotal} />
          <Section title="Financing activities" lines={cf.financing} total={cf.financingTotal} />
          <tbody>
            <tr className="border-t-2 border-ink/20 font-bold"><td className="px-5 py-3">Net change in cash</td><td className={cx('num px-5 text-end', cf.netChange < 0 && 'text-late')}>{formatMoney(cf.netChange)}</td></tr>
            <tr><td className="px-5 py-1.5 text-muted">Cash and bank at start</td><td className="num px-5 text-end text-muted">{formatMoney(cf.cashStart)}</td></tr>
            <tr className="font-semibold"><td className="px-5 py-1.5">Cash and bank at end</td><td className="num px-5 text-end">{formatMoney(cf.cashEnd)}</td></tr>
          </tbody>
        </table>
      </Card>
      <p className="text-sm text-muted">“Cash” means cash on hand plus the bank account. Card sales count once the processor’s deposit is recorded.</p>
    </>
  );
}
