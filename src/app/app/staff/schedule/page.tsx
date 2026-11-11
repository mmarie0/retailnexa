import type { Metadata } from 'next';
import Link from 'next/link';
import { can, getOrgContext } from '@/lib/auth/context';
import { ActionForm } from '@/components/action-form';
import { PrintButton } from '@/components/print-button';
import { SubmitButton } from '@/components/submit-button';
import { Card, EmptyState, Notice, cx } from '@/components/ui';
import { formatMoney } from '@/lib/billing/plans';
import { WEEKDAYS, activeOn, addDays, dayHours, dayPlan, t12, weekStart } from '@/lib/staff/payroll';
import { Stat } from '../../_dashboard/tiles';
import { ReadOnlyNotice } from '../../read-only-notice';
import { loadStaff } from '../_data';
import { copyWeek, saveWeek } from '../actions';
import { WeekFields } from '../week-fields';

export const metadata: Metadata = { title: 'Schedule' };
const label = (d: string, o: Intl.DateTimeFormatOptions) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', ...o });

/** #102 Weekly schedule: who works when, copy last week, print, schedule cost. */
export default async function SchedulePage({ searchParams }: PageProps<'/app/staff/schedule'>) {
  const ctx = await getOrgContext();
  if (!can(ctx, 'schedule.view')) return <Notice tone="warning">You don’t have access to the schedule.</Notice>;
  const sp = await searchParams;
  const pick = (t: string) => weekStart(typeof sp.w === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(sp.w) ? sp.w : t, 0);
  const s = await loadStaff(ctx, (t) => ({ from: pick(t), to: addDays(pick(t), 6) }));
  const wk = pick(s.today);
  const days = Array.from({ length: 7 }, (_, i) => addDays(wk, i));
  const emps = s.employees.filter((e) => days.some((d) => activeOn(e, d)));
  const editable = can(ctx, 'schedule.manage') && ctx.access.canWrite;
  const hoursOf = (eId: string) => days.reduce((a, d) => a + dayHours(s.employees.find((e) => e.id === eId)!, s.pays.get(eId), d, s.idx, s.rules), 0);
  const costOf = (eId: string) => {
    const p = s.pays.get(eId);
    if (!p) return 0;
    const e = s.employees.find((x) => x.id === eId)!;
    if (p.pay_type === 'salary') return Math.round((p.rate_cents / 365) * days.filter((d) => activeOn(e, d)).length * (1 + p.burden_pct / 100));
    return Math.round(hoursOf(eId) * p.rate_cents * (1 + p.burden_pct / 100));
  };
  const totalHours = emps.reduce((a, e) => a + hoursOf(e.id), 0);
  const totalCost = emps.reduce((a, e) => a + costOf(e.id), 0);
  const perDay = days.map((d) => emps.filter((e) => dayPlan(e, d, s.idx) && activeOn(e, d)).length);

  return (
    <>
      <ReadOnlyNotice show={can(ctx, 'schedule.manage') && !ctx.access.canWrite} />
      <nav aria-label="Week" className="flex items-center justify-between gap-2">
        <Link href={`/app/staff/schedule?w=${addDays(wk, -7)}`} aria-label="Previous week" className="no-print grid size-10 place-items-center rounded-full bg-card text-lg shadow-[var(--shadow-card)]">‹</Link>
        <div className="text-center">
          <h1 className="text-[22px] font-bold tracking-tight">{label(wk, { month: 'short', day: 'numeric' })} – {label(addDays(wk, 6), { month: 'short', day: 'numeric', year: 'numeric' })}</h1>
          {wk !== weekStart(s.today, 0) && <Link href="/app/staff/schedule" className="no-print text-sm font-semibold text-accent-strong">This week</Link>}
        </div>
        <Link href={`/app/staff/schedule?w=${addDays(wk, 7)}`} aria-label="Next week" className="no-print grid size-10 place-items-center rounded-full bg-card text-lg shadow-[var(--shadow-card)]">›</Link>
      </nav>
      <div className="grid grid-cols-2 gap-2.5">
        <Stat block="blue" label="Scheduled hours" value={totalHours.toFixed(1)} sub={`${emps.length} people`} />
        {s.seePay ? <Stat block="indigo" label="Schedule cost" value={formatMoney(totalCost)} sub="Incl. employer taxes" /> : <Stat label="Busiest day" value={perDay.some(Boolean) ? WEEKDAYS[perDay.indexOf(Math.max(...perDay))] : '—'} />}
      </div>
      <div className="no-print flex flex-wrap gap-2">
        {editable && <ActionForm action={copyWeek} className="flex flex-col gap-1"><input type="hidden" name="week" value={wk} /><SubmitButton size="sm" variant="secondary" pendingText="Copying…">Copy last week</SubmitButton></ActionForm>}
        <PrintButton label="Print this week" />
      </div>
      {emps.length === 0 ? (
        <EmptyState title="No one to schedule yet">{can(ctx, 'employees.manage') ? <>Add employees on the <Link href="/app/staff" className="font-semibold text-accent-strong">Employees</Link> page.</> : null}</EmptyState>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[720px] text-[14px]">
            <thead className="text-start"><tr><th className="px-4 py-3">Employee</th>{days.map((d, i) => <th key={d} className={cx('px-2 py-3', d === s.today && 'text-accent-strong')}>{WEEKDAYS[i].slice(0, 3)} {+d.slice(8)}</th>)}<th className="px-4 text-end">Hours</th></tr></thead>
            <tbody>
              {emps.map((e) => (
                <tr key={e.id} className="border-t border-line align-top">
                  <td className="px-4 py-2.5 font-semibold">{e.name}{e.role_title && <span className="block text-xs font-normal text-muted">{e.role_title}</span>}</td>
                  {days.map((d) => {
                    const p = activeOn(e, d) ? dayPlan(e, d, s.idx) : null;
                    const weekOff = s.idx.get(`${e.id}|${d}`)?.off;
                    return (
                      <td key={d} className={cx('px-2 py-2.5', p?.fromWeek && 'font-semibold text-accent-strong')}>
                        {p ? <>{t12(p.in)}–{t12(p.out)}{p.actIn && p.actOut && <span className="block text-xs text-muted">in {t12(p.actIn)}–{t12(p.actOut)}</span>}</> : <span className="text-muted">{weekOff ? 'Off' : '—'}</span>}
                      </td>
                    );
                  })}
                  <td className="num px-4 py-2.5 text-end">{hoursOf(e.id).toFixed(1)}{s.seePay && <span className="block text-xs text-muted">{formatMoney(costOf(e.id))}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="no-print px-4 pb-3 text-xs text-muted">Blue times are changed for this week only; the rest follow each person’s regular schedule.</p>
        </Card>
      )}
      {editable && emps.length > 0 && (
        <section className="no-print flex flex-col gap-2">
          <h2 className="text-lg font-bold">Change this week</h2>
          <ul className="flex flex-col gap-2">
            {emps.map((e) => (
              <li key={e.id}>
                <Card className="py-3">
                  <details>
                    <summary className="cursor-pointer font-semibold">{e.name}</summary>
                    <ActionForm action={saveWeek} className="mt-3 flex flex-col gap-3">
                      <input type="hidden" name="employee_id" value={e.id} />
                      <input type="hidden" name="week" value={wk} />
                      <WeekFields prefix="wk" clock days={days.map((d) => { const p = dayPlan(e, d, s.idx); return p ? { in: p.in, out: p.out, lunch: p.lunch ?? 0, actIn: p.actIn, actOut: p.actOut } : null; })} />
                      <div className="flex flex-wrap gap-2">
                        <SubmitButton size="sm" pendingText="Saving…">Save this week</SubmitButton>
                        <SubmitButton size="sm" variant="ghost" name="reset" value="true" pendingText="Resetting…">Back to regular schedule</SubmitButton>
                      </div>
                    </ActionForm>
                  </details>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
