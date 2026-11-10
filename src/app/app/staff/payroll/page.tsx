import type { Metadata } from 'next';
import Link from 'next/link';
import { can, getOrgContext } from '@/lib/auth/context';
import { ActionForm } from '@/components/action-form';
import { SubmitButton } from '@/components/submit-button';
import { Badge, Card, EmptyState, Eyebrow, Field, Input, Notice, Select, cx } from '@/components/ui';
import { formatMoney } from '@/lib/billing/plans';
import { PAY_METHOD_LABEL, WEEKDAYS, addDays, laborDay, monthRange, payPeriod, periodLines } from '@/lib/staff/payroll';
import { Stat } from '../../_dashboard/tiles';
import { ReadOnlyNotice } from '../../read-only-notice';
import { loadStaff } from '../_data';
import { addAdvance, createPayRun, saveRules, voidPayRun } from '../actions';

export const metadata: Metadata = { title: 'Payroll' };
type Run = { id: string; pay_date: string; period_start: string; period_end: string; note: string | null; voided_at: string | null };
type Line = { run_id: string; employee_id: string; hours: number; overtime_hours: number; regular_cents: number; overtime_cents: number; bonus_cents: number; gross_cents: number; advance_cents: number; net_cents: number; employer_tax_cents: number };
type Adv = { id: string; employee_id: string; advance_date: string; amount_cents: number; note: string | null; repaid_run_id: string | null };
const dl = (d: string, o: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', ...o });
const ymAdd = (ym: string, n: number) => new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 1 + n, 1)).toISOString().slice(0, 7);

/** #102 Payroll: rules, pay runs from the schedule, advances, month totals. */
export default async function PayrollPage({ searchParams }: PageProps<'/app/staff/payroll'>) {
  const ctx = await getOrgContext();
  if (!can(ctx, 'payroll.view')) return <Notice tone="warning">You don’t have access to payroll.</Notice>;
  const sp = await searchParams;
  const ymOf = (t: string) => (typeof sp.m === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.m) ? sp.m : t.slice(0, 7));
  // Shifts for the month and for the pay period being prepared (which can start in the month before).
  const s = await loadStaff(ctx, (t) => { const m = monthRange(`${ymOf(t)}-01`); return { from: addDays(m.from, -14), to: addDays(m.to, 14) }; });
  const ym = ymOf(s.today);
  const { from, to } = monthRange(`${ym}-01`);
  const periodStartParam = typeof sp.ps === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(sp.ps) ? sp.ps : null;
  const period = periodStartParam ? payPeriod(periodStartParam, s.rules) : payPeriod(addDays(s.today, -7 * s.rules.pay_every_weeks), s.rules);
  // The pay period may fall outside the loaded range when picked by hand.
  const { data: periodShifts } = await s.supabase.from('shifts').select('employee_id, work_date, off, start_time, end_time, lunch_min, actual_in, actual_out')
    .eq('organization_id', ctx.org.id).gte('work_date', period.start).lte('work_date', period.end).limit(5000);
  const pidx = new Map((periodShifts ?? []).map((x) => [`${x.employee_id}|${x.work_date}`, x]));
  const [{ data: runs }, { data: advances }] = await Promise.all([
    s.supabase.from('pay_runs').select('id, pay_date, period_start, period_end, note, voided_at').eq('organization_id', ctx.org.id)
      .gte('pay_date', from).lte('pay_date', to).order('pay_date', { ascending: false }),
    s.supabase.from('employee_advances').select('id, employee_id, advance_date, amount_cents, note, repaid_run_id').eq('organization_id', ctx.org.id).is('repaid_run_id', null).order('advance_date'),
  ]);
  const monthRuns = (runs ?? []) as Run[];
  const { data: lines } = monthRuns.length
    ? await s.supabase.from('pay_run_lines').select('run_id, employee_id, hours, overtime_hours, regular_cents, overtime_cents, bonus_cents, gross_cents, advance_cents, net_cents, employer_tax_cents')
      .eq('organization_id', ctx.org.id).in('run_id', monthRuns.map((r) => r.id))
    : { data: [] as Line[] };
  const liveIds = new Set(monthRuns.filter((r) => !r.voided_at).map((r) => r.id));
  const monthLines = ((lines ?? []) as Line[]).filter((l) => liveIds.has(l.run_id));
  const n = (v: unknown) => Number(v ?? 0);
  const paidCost = monthLines.reduce((a, l) => a + n(l.gross_cents) + n(l.employer_tax_cents), 0);
  const gross = monthLines.reduce((a, l) => a + n(l.gross_cents), 0);
  const hours = monthLines.reduce((a, l) => a + n(l.hours), 0);
  const dim = +to.slice(8);
  const estimate = Array.from({ length: dim }, (_, i) => laborDay(`${ym}-${String(i + 1).padStart(2, '0')}`, s.employees, s.pays, s.idx, s.rules).costCents).reduce((a, b) => a + b, 0);
  const suggested = periodLines(period.start, period.end, s.employees, s.pays, pidx as never, s.rules);
  const open = (advances ?? []) as Adv[];
  const name = new Map(s.employees.map((e) => [e.id, e.name]));
  const manage = can(ctx, 'payroll.manage') && ctx.access.canWrite;
  const money = (c: number) => (c / 100).toFixed(2);
  const runTotal = (id: string) => ((lines ?? []) as Line[]).filter((l) => l.run_id === id);

  return (
    <>
      <ReadOnlyNotice show={can(ctx, 'payroll.manage') && !ctx.access.canWrite} />
      <nav aria-label="Month" className="flex items-center justify-between gap-2">
        <Link href={`/app/staff/payroll?m=${ymAdd(ym, -1)}`} aria-label="Previous month" className="grid size-10 place-items-center rounded-full bg-card text-lg shadow-[var(--shadow-card)]">‹</Link>
        <h1 className="text-[22px] font-bold tracking-tight">{dl(`${ym}-01`, { month: 'long', year: 'numeric' })}</h1>
        <Link href={`/app/staff/payroll?m=${ymAdd(ym, 1)}`} aria-label="Next month" className="grid size-10 place-items-center rounded-full bg-card text-lg shadow-[var(--shadow-card)]">›</Link>
      </nav>
      <div className="grid grid-cols-3 gap-2.5">
        <Stat block="blue" label="Paid" value={formatMoney(paidCost)} sub="incl. employer taxes" />
        <Stat label="Gross wages" value={formatMoney(gross)} sub={hours ? `${hours.toLocaleString('en-US')} hours` : ' '} />
        <Stat label={ym < s.today.slice(0, 7) ? 'Estimate was' : 'Month estimate'} value={formatMoney(estimate)} sub="From the schedule" />
      </div>

      <Card className="flex flex-col gap-3">
        <Eyebrow>Payroll rules · everyone</Eyebrow>
        {manage ? (
          <ActionForm action={saveRules} className="grid gap-3 sm:grid-cols-2">
            <Field label="Lunch breaks" htmlFor="r-lunch"><Select id="r-lunch" name="paid_lunch" defaultValue={String(s.rules.paid_lunch)}><option value="true">Paid: lunch counts as hours</option><option value="false">Unpaid: lunch minutes come out</option></Select></Field>
            <Field label="Overtime" htmlFor="r-ot"><Select id="r-ot" name="overtime" defaultValue={String(s.rules.overtime)}><option value="false">Off: every hour at the regular rate</option><option value="true">On</option></Select></Field>
            <Field label="Overtime after (hours a week)" htmlFor="r-after"><Input id="r-after" name="overtime_after" type="number" step="0.5" min={1} max={168} defaultValue={s.rules.overtime_after_hours} /></Field>
            <Field label="Overtime pays (× rate)" htmlFor="r-x"><Input id="r-x" name="overtime_multiplier" type="number" step="0.05" min={1} max={3} defaultValue={s.rules.overtime_multiplier} /></Field>
            <Field label="Pay week starts" htmlFor="r-start"><Select id="r-start" name="pay_week_start" defaultValue={String(s.rules.pay_week_start)}>{WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</Select></Field>
            <Field label="Pay every" htmlFor="r-every"><Select id="r-every" name="pay_every_weeks" defaultValue={String(s.rules.pay_every_weeks)}><option value="1">Week</option><option value="2">2 weeks</option></Select></Field>
            <Field label="Labor % target" htmlFor="r-target" hint="Many beauty supply stores aim for about 8–15% of sales."><Input id="r-target" name="labor_target" type="number" step="0.5" min={0} max={100} defaultValue={s.rules.labor_target_pct} /></Field>
            <SubmitButton size="sm" variant="secondary" className="self-end justify-self-start" pendingText="Saving…">Save rules</SubmitButton>
          </ActionForm>
        ) : (
          <p className="text-sm text-muted">Lunch {s.rules.paid_lunch ? 'paid' : 'unpaid'} · overtime {s.rules.overtime ? `after ${s.rules.overtime_after_hours} hrs at ${s.rules.overtime_multiplier}×` : 'off'} · paid every {s.rules.pay_every_weeks === 1 ? 'week' : '2 weeks'} from {WEEKDAYS[s.rules.pay_week_start]}</p>
        )}
      </Card>

      {s.employees.length === 0 ? (
        <EmptyState title="Add employees first"><Link href="/app/staff" className="font-semibold text-accent-strong">Go to Employees</Link></EmptyState>
      ) : manage && (
        <Card id="new" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-bold">New pay run</h2>
            <span className="flex gap-3 text-sm">
              <Link href={`/app/staff/payroll?m=${ym}&ps=${addDays(period.start, -7 * s.rules.pay_every_weeks)}#new`} className="font-semibold text-accent-strong">‹ Earlier period</Link>
              <Link href={`/app/staff/payroll?m=${ym}&ps=${addDays(period.start, 7 * s.rules.pay_every_weeks)}#new`} className="font-semibold text-accent-strong">Later period ›</Link>
            </span>
          </div>
          <p className="text-sm text-muted">Pay period {dl(period.start)} – {dl(period.end, { month: 'short', day: 'numeric', year: 'numeric' })}. Hours come from the schedule (clock times when entered). Change anything before saving.</p>
          {suggested.length === 0 ? <p className="text-sm text-muted">Nobody with pay set up worked this period.</p> : (
            <ActionForm action={createPayRun} className="flex flex-col gap-3">
              <input type="hidden" name="period_start" value={period.start} />
              <input type="hidden" name="period_end" value={period.end} />
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] text-[14px]">
                  <thead className="text-left"><tr><th className="py-1">Pay</th><th>Employee</th><th>Hours</th><th>OT hrs</th><th>Regular</th><th>Overtime</th><th>Bonus</th><th>Employer tax</th><th>Take back advances</th><th>Paid by</th></tr></thead>
                  <tbody>
                    {suggested.map((l) => {
                      const advs = open.filter((a) => a.employee_id === l.employee_id);
                      const id = l.employee_id;
                      return (
                        <tr key={id} className="border-t border-line align-top">
                          <td className="py-2"><input type="hidden" name="employee_id" value={id} /><input type="checkbox" name={`inc-${id}`} defaultChecked aria-label={`Pay ${l.name}`} className="size-4 accent-[#3f63de]" /></td>
                          <td className="py-2 pr-2 font-semibold">{l.name}<input type="hidden" name={`name-${id}`} value={l.name} /><input type="hidden" name={`type-${id}`} value={l.pay_type} /><input type="hidden" name={`rate-${id}`} value={l.rate_cents} />
                            <span className="block text-xs font-normal text-muted">{l.pay_type === 'salary' ? 'Salary' : `${formatMoney(l.rate_cents)}/hr`}</span></td>
                          <td><input name={`hours-${id}`} inputMode="decimal" defaultValue={l.hours} aria-label={`${l.name} hours`} className="num w-16 rounded-lg bg-soft px-2 py-1" /></td>
                          <td><input name={`ot-${id}`} inputMode="decimal" defaultValue={l.overtime_hours} aria-label={`${l.name} overtime hours`} className="num w-14 rounded-lg bg-soft px-2 py-1" /></td>
                          <td><input name={`regular-${id}`} inputMode="decimal" defaultValue={money(l.regular_cents)} aria-label={`${l.name} regular pay`} className="num w-24 rounded-lg bg-soft px-2 py-1" /></td>
                          <td><input name={`overtime-${id}`} inputMode="decimal" defaultValue={money(l.overtime_cents)} aria-label={`${l.name} overtime pay`} className="num w-20 rounded-lg bg-soft px-2 py-1" /></td>
                          <td><input name={`bonus-${id}`} inputMode="decimal" defaultValue="0.00" aria-label={`${l.name} bonus`} className="num w-20 rounded-lg bg-soft px-2 py-1" /></td>
                          <td><input name={`tax-${id}`} inputMode="decimal" defaultValue={money(l.employer_tax_cents)} aria-label={`${l.name} employer tax`} className="num w-20 rounded-lg bg-soft px-2 py-1" /></td>
                          <td className="text-xs">{advs.length ? advs.map((a) => (
                            <label key={a.id} className="flex items-center gap-1.5"><input type="checkbox" name={`adv-${id}`} value={a.id} defaultChecked className="size-3.5 accent-[#3f63de]" />{formatMoney(Number(a.amount_cents))} · {dl(a.advance_date)}</label>
                          )) : <span className="text-muted">None</span>}</td>
                          <td><select name={`method-${id}`} defaultValue={l.pay_method ?? ''} aria-label={`${l.name} paid by`} className="rounded-lg bg-soft px-2 py-1"><option value="">—</option>{Object.entries(PAY_METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="grid gap-3 sm:grid-cols-[12rem_1fr_auto] sm:items-end">
                <Field label="Pay date" htmlFor="pay-date"><Input id="pay-date" name="pay_date" type="date" defaultValue={s.today} required /></Field>
                <Field label="Note (optional)" htmlFor="pay-note"><Input id="pay-note" name="note" maxLength={300} /></Field>
                <SubmitButton pendingText="Saving…">Save pay run</SubmitButton>
              </div>
              <p className="text-xs text-muted">Pay runs are your payroll record and paystubs. They are not posted to the books yet.</p>
            </ActionForm>
          )}
        </Card>
      )}

      <Card className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-2"><h2 className="text-lg font-bold">Advances</h2><span className="text-sm text-muted">{open.length} open · {formatMoney(open.reduce((a, x) => a + Number(x.amount_cents), 0))}</span></div>
        {open.length > 0 && <ul className="flex flex-col divide-y divide-line text-[14px]">{open.map((a) => <li key={a.id} className="flex justify-between gap-2 py-1.5"><span>{name.get(a.employee_id) ?? 'Employee'} · {dl(a.advance_date)}{a.note && <span className="text-muted"> · {a.note}</span>}</span><span className="num font-semibold">{formatMoney(Number(a.amount_cents))}</span></li>)}</ul>}
        {manage && (
          <ActionForm action={addAdvance} className="grid gap-2 sm:grid-cols-[1fr_9rem_8rem_1fr_auto] sm:items-end">
            <Field label="Employee" htmlFor="adv-emp"><Select id="adv-emp" name="employee_id" defaultValue=""><option value="">Choose…</option>{s.employees.filter((e) => e.is_active).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</Select></Field>
            <Field label="Date" htmlFor="adv-date"><Input id="adv-date" name="date" type="date" defaultValue={s.today} /></Field>
            <Field label="Amount" htmlFor="adv-amt"><Input id="adv-amt" name="amount" inputMode="decimal" className="num" placeholder="100.00" /></Field>
            <Field label="Note" htmlFor="adv-note"><Input id="adv-note" name="note" maxLength={200} /></Field>
            <SubmitButton size="sm" variant="secondary" pendingText="Saving…">Add advance</SubmitButton>
          </ActionForm>
        )}
      </Card>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-bold">Pay runs</h2>
        {monthRuns.length === 0 ? <p className="rounded-[14px] bg-card p-4 text-center text-sm text-muted">No pay runs this month.</p> : (
          <ul className="flex flex-col gap-2">
            {monthRuns.map((r) => {
              const ls = runTotal(r.id);
              return (
                <li key={r.id}>
                  <Card className={cx('flex flex-wrap items-center justify-between gap-3 py-3', r.voided_at && 'opacity-60')}>
                    <span className="flex flex-col">
                      <span className="font-semibold">Paid {dl(r.pay_date, { weekday: 'short', month: 'short', day: 'numeric' })} {r.voided_at && <Badge tone="warning">Voided</Badge>}</span>
                      <span className="text-[13px] text-muted">{dl(r.period_start)} – {dl(r.period_end)} · {ls.length} employee{ls.length === 1 ? '' : 's'}{r.note ? ` · ${r.note}` : ''}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="num font-semibold">{formatMoney(ls.reduce((a, l) => a + n(l.gross_cents) + n(l.employer_tax_cents), 0))}</span>
                      <Link href={`/app/staff/stubs/${r.id}`} className="rounded-full bg-soft px-3 py-1.5 text-sm font-semibold text-accent-strong">Paystubs</Link>
                      {manage && !r.voided_at && <ActionForm action={voidPayRun}><input type="hidden" name="id" value={r.id} /><SubmitButton size="sm" variant="ghost" pendingText="Voiding…">Void</SubmitButton></ActionForm>}
                    </span>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
