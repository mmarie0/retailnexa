import type { Metadata } from 'next';
import Link from 'next/link';
import { can, getOrgContext } from '@/lib/auth/context';
import { Block, Card, EmptyState, Eyebrow, Notice, cx } from '@/components/ui';
import { formatMoney } from '@/lib/billing/plans';
import { WEEKDAYS, laborMonth, monthRange } from '@/lib/staff/payroll';
import { loadStaff } from '../_data';

export const metadata: Metadata = { title: 'Labor %' };
const pct = (v: number | null) => (v === null ? '—' : `${v.toFixed(1)}%`);
const dl = (d: string, o: Intl.DateTimeFormatOptions) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', ...o });
const ymAdd = (ym: string, n: number) => new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 1 + n, 1)).toISOString().slice(0, 7);

/** #102 Labor % of gross sales against the target: by weekday and every day. */
export default async function LaborPage({ searchParams }: PageProps<'/app/staff/labor'>) {
  const ctx = await getOrgContext();
  if (!can(ctx, 'payroll.view')) return <Notice tone="warning">You don’t have access to payroll.</Notice>;
  const sp = await searchParams;
  const ymOf = (t: string) => (typeof sp.m === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.m) ? sp.m : t.slice(0, 7));
  const s = await loadStaff(ctx, (t) => monthRange(`${ymOf(t)}-01`));
  const ym = ymOf(s.today);
  const { from, to } = monthRange(`${ym}-01`);
  const T = s.rules.labor_target_pct;
  const nav = (
    <nav aria-label="Month" className="flex items-center justify-between gap-2">
      <Link href={`/app/staff/labor?m=${ymAdd(ym, -1)}`} aria-label="Previous month" className="grid size-10 place-items-center rounded-full bg-card text-lg shadow-[var(--shadow-card)]">‹</Link>
      <h1 className="text-[22px] font-bold tracking-tight">{dl(`${ym}-01`, { month: 'long', year: 'numeric' })}</h1>
      <Link href={`/app/staff/labor?m=${ymAdd(ym, 1)}`} aria-label="Next month" className="grid size-10 place-items-center rounded-full bg-card text-lg shadow-[var(--shadow-card)]">›</Link>
    </nav>
  );
  if (!s.employees.length) return <>{nav}<EmptyState title="Add employees first">Labor % uses each person’s schedule and pay rate. <Link href="/app/staff" className="font-semibold text-accent-strong">Go to Employees</Link></EmptyState></>;
  if (!can(ctx, 'sales.view')) return <>{nav}<Notice tone="info">Labor % compares labor with daily sales, and you don’t have access to sales.</Notice></>;
  const { data } = await s.supabase.from('sales_days').select('business_date, gross_sales_cents').eq('organization_id', ctx.org.id).is('voided_at', null)
    .gte('business_date', from).lte('business_date', to).limit(5000);
  const sales = new Map<string, number>();
  for (const r of data ?? []) sales.set(r.business_date, (sales.get(r.business_date) ?? 0) + Number(r.gross_sales_cents));
  const L = laborMonth(ym, s.today, sales, s.employees, s.pays, s.idx, s.rules);
  if (!L.n) return <>{nav}<EmptyState title={`No daily sales yet for ${dl(`${ym}-01`, { month: 'long' })}`}>Labor % compares each day’s scheduled labor cost with that day’s gross sales. Add daily reports to see it.</EmptyState></>;
  const ranked = L.weekdays.filter((w) => w.n && w.pct !== null).sort((a, b) => a.pct! - b.pct!);
  const best = ranked[0], worst = ranked[ranked.length - 1];
  const maxPct = Math.max(T, ...L.weekdays.map((w) => w.pct ?? 0)) || 1;

  return (
    <>
      {nav}
      <Block tone={L.pct !== null && L.pct > T ? 'coral' : 'blue'} className="flex flex-col gap-1.5 p-[18px]">
        <span className="text-[11px] font-bold uppercase tracking-[.08em]">Labor % of gross sales</span>
        <span className="num text-[36px] font-medium leading-none">{pct(L.pct)}</span>
        <span className="text-sm opacity-90">{formatMoney(L.costCents)} labor on {formatMoney(L.salesCents)} sales · {L.n} day{L.n === 1 ? '' : 's'} · target {pct(T)}{can(ctx, 'payroll.manage') && <> · <Link href="/app/staff/payroll" className="underline">change</Link></>}</span>
      </Block>
      <Card className="flex flex-col gap-3">
        <Eyebrow>Average by weekday</Eyebrow>
        <ul className="grid grid-cols-[3rem_1fr_3.5rem] items-center gap-x-3 gap-y-2">
          {L.weekdays.filter((w) => w.n).map((w) => (
            <li key={w.dow} className="contents">
              <span className="text-sm font-semibold">{WEEKDAYS[w.dow].slice(0, 3)}</span>
              <span className="relative h-3 rounded bg-soft" role="img" aria-label={`${WEEKDAYS[w.dow]} ${pct(w.pct)}`}>
                <span className={cx('absolute inset-y-0 start-0 rounded', w.pct !== null && w.pct > T ? 'bg-late' : 'bg-paid')} style={{ width: `${((w.pct ?? 0) / maxPct) * 100}%` }} />
                <b className="absolute inset-y-[-3px] w-0.5 bg-ink" style={{ left: `calc(${(T / maxPct) * 100}% - 1px)` }} />
              </span>
              <span className={cx('num text-end text-sm font-semibold', w.pct !== null && w.pct > T ? 'text-late' : 'text-paid')}>{pct(w.pct)}</span>
            </li>
          ))}
        </ul>
        {best && worst && best !== worst && (
          <p className="text-sm text-muted">Leanest day: <b className="text-ink">{WEEKDAYS[best.dow]}</b> ({pct(best.pct)}). Heaviest: <b className={cx(worst.pct! > T ? 'text-late' : 'text-ink')}>{WEEKDAYS[worst.dow]}</b> ({pct(worst.pct)})
            {worst.pct! > T && worst.costCents !== null && worst.salesCents !== null && <> — about {formatMoney(Math.round(worst.costCents - (worst.salesCents * T) / 100))} over target per {WEEKDAYS[worst.dow]}</>}.</p>
        )}
      </Card>
      <Card className="overflow-x-auto p-0">
        <h2 className="px-4 pt-4 text-lg font-bold">Weekday breakdown</h2>
        <table className="w-full min-w-[520px] text-[14px]">
          <thead className="text-start"><tr><th className="px-4 py-2">Day</th><th className="px-2 text-end">Avg sales</th><th className="px-2 text-end">Avg hours</th><th className="px-2 text-end">Avg labor</th><th className="px-4 text-end">Labor %</th></tr></thead>
          <tbody>{L.weekdays.filter((w) => w.n).map((w) => (
            <tr key={w.dow} className="border-t border-line"><td className="px-4 py-2">{WEEKDAYS[w.dow]} <span className="text-xs text-muted">{w.n}×</span></td>
              <td className="num px-2 text-end">{formatMoney(Math.round(w.salesCents ?? 0))}</td><td className="num px-2 text-end">{(w.hours ?? 0).toFixed(1)}</td>
              <td className="num px-2 text-end">{formatMoney(Math.round(w.costCents ?? 0))}</td><td className={cx('num px-4 text-end font-bold', w.pct !== null && w.pct > T ? 'text-late' : 'text-paid')}>{pct(w.pct)}</td></tr>
          ))}</tbody>
        </table>
        <p className="px-4 py-3 text-sm text-muted">Sales per labor hour: <b className="text-ink">{L.salesPerHourCents ? formatMoney(Math.round(L.salesPerHourCents)) : '—'}</b></p>
      </Card>
      <Card className="overflow-x-auto p-0">
        <h2 className="px-4 pt-4 text-lg font-bold">Every day</h2>
        <table className="w-full min-w-[520px] text-[14px]">
          <thead className="text-start"><tr><th className="px-4 py-2">Date</th><th className="px-2 text-end">Sales</th><th className="px-2 text-end">Hours</th><th className="px-2 text-end">Labor</th><th className="px-4 text-end">%</th></tr></thead>
          <tbody>{[...L.days].reverse().filter((d) => d.salesCents !== null || d.date === s.today).map((d) => (
            <tr key={d.date} className="border-t border-line"><td className="px-4 py-2">{dl(d.date, { weekday: 'short', day: 'numeric' })}</td>
              <td className="num px-2 text-end">{d.salesCents !== null ? formatMoney(d.salesCents) : <span className="text-muted">no report</span>}</td>
              <td className="num px-2 text-end">{d.hours.toFixed(1)}</td><td className="num px-2 text-end">{formatMoney(d.costCents)}</td>
              <td className={cx('num px-4 text-end font-semibold', d.pct !== null && d.pct > T ? 'text-late' : 'text-paid')}>{pct(d.pct)}</td></tr>
          ))}</tbody>
        </table>
        <p className="px-4 py-3 text-xs text-muted">Labor cost = hours on the schedule (clock times when entered) × pay rate × employer taxes. Salaried staff count 1/365 of salary per day. Sales are gross from daily reports.</p>
      </Card>
    </>
  );
}
