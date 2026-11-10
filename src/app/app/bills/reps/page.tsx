import type { Metadata } from 'next';
import Link from 'next/link';
import { can, getOrgContext, getSupabase } from '@/lib/auth/context';
import { Badge, Card, EmptyState, LinkButton, Notice, PageHeader, cx } from '@/components/ui';
import { repSchedule, type BillRow } from '@/lib/bills/due';
import { todayIn } from '@/lib/time';
import { fmtDate } from '../format';

export const metadata: Metadata = { title: 'Rep schedule' };

const WD = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ORDER = [1, 2, 3, 4, 5, 6, 0];
const short = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });

/** #114: which days each vendor's rep usually comes, worked out from invoice dates (as in the live app). */
export default async function RepSchedulePage() {
  const ctx = await getOrgContext();
  if (!can(ctx, 'bills.view')) return <Notice tone="warning">You don’t have access to bills.</Notice>;
  const supabase = await getSupabase();
  const [{ data: bills }, { data: vendors }, { data: orgRow }] = await Promise.all([
    supabase.from('bills').select('vendor_id, bill_date, status, recurring_bill_id')
      .eq('organization_id', ctx.org.id).neq('status', 'void').order('bill_date', { ascending: false }).limit(10000),
    supabase.from('vendors').select('id, name').eq('organization_id', ctx.org.id),
    supabase.from('organizations').select('timezone').eq('id', ctx.org.id).maybeSingle(),
  ]);
  const today = todayIn(orgRow?.timezone);
  const reps = repSchedule((bills ?? []) as Pick<BillRow, 'vendor_id' | 'bill_date' | 'status' | 'recurring_bill_id'>[], new Map((vendors ?? []).map((v) => [v.id, v.name])), today);
  const todayDow = new Date(`${today}T00:00:00Z`).getUTCDay();

  return (
    <>
      <PageHeader title="Rep schedule" description="Worked out from the dates on each vendor’s bills: the days their rep usually comes and how often. Recurring bills like rent are left out." />
      {reps.length === 0 ? (
        <EmptyState title="Not enough bills yet" action={can(ctx, 'bills.create') ? <LinkButton href="/app/bills/new">Enter a bill</LinkButton> : undefined}>
          Each vendor needs at least 2 bills on different dates. Enter past invoices and this fills in.
        </EmptyState>
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {ORDER.map((d) => {
              const who = reps.filter((r) => r.days.includes(d));
              return (
                <li key={d}>
                  <Card className={cx('flex flex-col gap-2 py-3', d === todayDow && 'ring-2 ring-accent')}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold">{WD[d]} {d === todayDow && <Badge tone="info">Today</Badge>}</span>
                      <span className="text-sm text-muted">{who.length || ''}</span>
                    </div>
                    {who.length ? (
                      <div className="flex flex-wrap gap-1.5">
                        {who.map((r) => (
                          <Link key={r.vendorId} href={`/app/vendors?q=${encodeURIComponent(r.name)}`} className="rounded-full bg-soft px-3 py-1 text-sm font-semibold">
                            {r.name}{r.freq !== 'Weekly' && <span className="font-normal text-muted"> · {r.freq.toLowerCase()}</span>}
                          </Link>
                        ))}
                      </div>
                    ) : <span className="text-sm text-muted">No regular visits</span>}
                  </Card>
                </li>
              );
            })}
          </ul>
          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-bold">By vendor</h2>
            <ul className="flex flex-col gap-2">
              {reps.map((r) => {
                const max = Math.max(...r.counts);
                return (
                  <li key={r.vendorId}>
                    <Card className="flex flex-col gap-1.5 py-3">
                      <div className="flex items-baseline justify-between gap-2"><span className="font-bold">{r.name}</span><span className="text-sm text-muted">{r.freq}</span></div>
                      <p className="flex flex-wrap gap-x-2 text-[13px] text-muted">
                        <span>{r.days.length ? `Usually ${r.days.map((d) => WD[d].slice(0, 3)).join(' & ')}` : 'No set day'}</span>
                        <span>· last invoice {fmtDate(r.last)}</span>
                        {r.next && <span>· next likely <b className="text-ink">{short(r.next)}</b></span>}
                      </p>
                      <div className="flex gap-1" aria-label={ORDER.map((d) => `${WD[d]}: ${r.counts[d]}`).join(', ')} role="img">
                        {ORDER.map((d) => (
                          <i key={d} className="grid h-6 flex-1 place-items-center rounded bg-accent text-[11px] font-semibold not-italic text-white"
                            style={{ opacity: r.counts[d] ? Math.max(0.25, r.counts[d] / max) : 0.08 }}>{WD[d][0]}</i>
                        ))}
                      </div>
                    </Card>
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      )}
    </>
  );
}
