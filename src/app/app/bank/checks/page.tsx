import type { Metadata } from 'next';
import Link from 'next/link';
import { can, getOrgContext, getSupabase } from '@/lib/auth/context';
import { Badge, Card, EmptyState, Notice, PageHeader, cx } from '@/components/ui';
import { formatMoney } from '@/lib/billing/plans';
import { todayIn } from '@/lib/time';
import { calendarMonth, checkRegister, type PaymentIn } from '@/lib/bank/checks';
import { fmtDate } from '../../bills/format';
import { Stat } from '../../_dashboard/tiles';
import { BankTabs } from '../tabs';
import { bankLines, pageAll } from '../_load';

export const metadata: Metadata = { title: 'Check register' };
const ymAdd = (ym: string, n: number) => new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 1 + n, 1)).toISOString().slice(0, 7);
const label = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' });
const lastDay = (ym: string) => `${ym}-${new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).getUTCDate()}`;

/** #109 Check register: bank payments with check numbers, cleared or outstanding, and a calendar of checks and withdrawals. */
export default async function ChecksPage({ searchParams }: PageProps<'/app/bank/checks'>) {
  const ctx = await getOrgContext();
  if (!can(ctx, 'bank.view') || !can(ctx, 'bills.view')) return <Notice tone="warning">The check register needs access to the bank and bills.</Notice>;
  const sp = await searchParams;
  const sb = await getSupabase();
  const { data: tz } = await sb.from('organizations').select('timezone').eq('id', ctx.org.id).maybeSingle();
  const today = todayIn(tz?.timezone);
  const ym = typeof sp.m === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.m) && sp.m <= today.slice(0, 7) ? sp.m : today.slice(0, 7);
  const all = sp.all === '1';
  const from = `${ymAdd(ym, -12)}-01`, to = lastDay(ym);
  const [pays, voids, lines, vendors] = await Promise.all([
    pageAll<{ id: string; bill_id: string; paid_on: string; amount_cents: number; reference: string | null; journal_entry_id: string }>((a, b) =>
      sb.from('bill_payments').select('id, bill_id, paid_on, amount_cents, reference, journal_entry_id').eq('organization_id', ctx.org.id).eq('source', 'bank')
        .gte('paid_on', from).lte('paid_on', to).order('paid_on').order('id').range(a, b)),
    pageAll<{ payment_id: string }>((a, b) => sb.from('bill_payment_voids').select('payment_id').eq('organization_id', ctx.org.id).order('payment_id').range(a, b)),
    bankLines(sb, ctx, from, today),
    pageAll<{ id: string; name: string }>((a, b) => sb.from('vendors').select('id, name').eq('organization_id', ctx.org.id).order('id').range(a, b)),
  ]);
  const billIds = [...new Set(pays.map((p) => p.bill_id))];
  const billVendor = new Map<string, string>();
  for (let i = 0; i < billIds.length; i += 200) {
    const { data } = await sb.from('bills').select('id, vendor_id').eq('organization_id', ctx.org.id).in('id', billIds.slice(i, i + 200));
    for (const b of data ?? []) billVendor.set(b.id as string, b.vendor_id as string);
  }
  const vName = new Map(vendors.map((v) => [v.id, v.name]));
  const payments: PaymentIn[] = pays.map((p) => ({ ...p, amount_cents: Number(p.amount_cents), payee: vName.get(billVendor.get(p.bill_id) ?? '') ?? 'Vendor' }));
  const register = checkRegister(payments, new Set(voids.map((v) => v.payment_id)), lines, today, !all);
  const inMonth = register.filter((c) => c.date.startsWith(ym));
  const outstanding = register.filter((c) => !c.clearedOn);
  const cal = calendarMonth(ym, register, lines.filter((l) => l.posted_on.startsWith(ym)));
  const qs = (o: Record<string, string>) => `/app/bank/checks?${new URLSearchParams({ m: ym, ...(all ? { all: '1' } : {}), ...o })}`;

  return (
    <>
      <PageHeader title="Bank" description="Checks you wrote, whether they’ve cleared the bank, and what left the account each day." />
      <BankTabs active="/app/bank/checks" />
      <div className="grid grid-cols-2 gap-3">
        <Stat block="indigo" label="Outstanding" value={formatMoney(outstanding.reduce((a, c) => a + c.amountCents, 0))} sub={`${outstanding.length} not cleared yet`} />
        <Stat label="Over 14 days" value={String(outstanding.filter((c) => c.stale).length)} tone={outstanding.some((c) => c.stale) ? 'late' : undefined} sub="Check with the payee or the bank" />
      </div>
      <nav aria-label="Month" className="flex items-center justify-between gap-2">
        <Link href={qs({ m: ymAdd(ym, -1) })} aria-label="Previous month" className="grid size-10 place-items-center rounded-full bg-card text-lg shadow-[var(--shadow-card)]">‹</Link>
        <h2 className="text-[20px] font-bold tracking-tight">{label(ym)}</h2>
        {ym < today.slice(0, 7) ? <Link href={qs({ m: ymAdd(ym, 1) })} aria-label="Next month" className="grid size-10 place-items-center rounded-full bg-card text-lg shadow-[var(--shadow-card)]">›</Link> : <span className="size-10" />}
      </nav>

      <Card className="p-3">
        <div role="grid" aria-label={`Checks and withdrawals, ${label(ym)}`} className="grid grid-cols-7 gap-1 text-xs">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div key={d} role="columnheader" className="pb-1 text-center font-semibold text-muted">{d}</div>)}
          {Array.from({ length: cal.lead }, (_, i) => <div key={`l${i}`} />)}
          {cal.days.map((d) => (
            <div key={d.date} role="gridcell" aria-label={`${fmtDate(d.date)}: checks ${formatMoney(d.checkCents)}, withdrawals ${formatMoney(d.outCents)}`}
              className={cx('flex min-h-14 flex-col gap-0.5 rounded-lg p-1', d.date === today ? 'bg-accent/10 ring-1 ring-accent' : 'bg-soft')}>
              <span className="font-semibold">{+d.date.slice(8)}</span>
              {d.checkCents > 0 && <span className="num truncate rounded bg-[#3f63de] px-1 text-white" title={d.checks.map((c) => `#${c.number ?? '—'} ${c.payee}`).join(', ')}>✎ {formatMoney(d.checkCents)}</span>}
              {d.outCents > 0 && <span className="num truncate rounded bg-card px-1" title={d.withdrawals.map((w) => w.description).join(', ')}>↓ {formatMoney(d.outCents)}</span>}
            </div>
          ))}
        </div>
        <p className="mt-2 flex flex-wrap gap-3 text-xs text-muted"><span><span className="rounded bg-[#3f63de] px-1 text-white">✎</span> checks written</span><span><span className="rounded bg-card px-1">↓</span> withdrawals on your statement</span></p>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold">Register</h2>
        <nav aria-label="Which payments" className="flex gap-1 rounded-full bg-soft p-1 text-sm">
          <Link href={`/app/bank/checks?m=${ym}`} aria-current={!all ? 'page' : undefined} className={cx('rounded-full px-3 py-1 font-semibold', !all ? 'bg-card shadow-[var(--shadow-card)]' : 'text-muted')}>Checks</Link>
          <Link href={qs({ all: '1' })} aria-current={all ? 'page' : undefined} className={cx('rounded-full px-3 py-1 font-semibold', all ? 'bg-card shadow-[var(--shadow-card)]' : 'text-muted')}>All bank payments</Link>
        </nav>
      </div>
      {inMonth.length === 0 && outstanding.length === 0 ? (
        <EmptyState title={all ? 'No bank payments this month' : 'No checks this month'}>Record a bill payment from the bank with the check number as its reference.</EmptyState>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[560px] text-[14.5px]">
            <thead className="text-left text-xs uppercase tracking-[.06em] text-muted"><tr><th className="px-4 py-2.5">Date</th><th className="px-2">Check #</th><th className="px-2">Payee</th><th className="px-2 text-right">Amount</th><th className="px-4">Status</th></tr></thead>
            <tbody>
              {[...inMonth, ...outstanding.filter((c) => !c.date.startsWith(ym))].map((c) => (
                <tr key={c.id} className="border-t border-line">
                  <td className="px-4 py-2">{fmtDate(c.date)}</td>
                  <td className="num px-2">{c.number ?? '—'}</td>
                  <td className="px-2">{c.payee}</td>
                  <td className="num px-2 text-right">{formatMoney(c.amountCents)}</td>
                  <td className="px-4">{c.clearedOn ? <Badge tone="good">Cleared {fmtDate(c.clearedOn)}</Badge> : <Badge tone={c.stale ? 'danger' : 'warning'}>Outstanding {c.days} day{c.days === 1 ? '' : 's'}</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <p className="text-sm text-muted">A payment clears when its bank line is matched on the Statement tab. Older outstanding checks are listed under this month too.</p>
    </>
  );
}
