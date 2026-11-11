import type { Metadata } from 'next';
import Link from 'next/link';
import { pageAll } from '@/lib/page-all';
import { can, getOrgContext } from '@/lib/auth/context';
import { ActionForm } from '@/components/action-form';
import { SubmitButton } from '@/components/submit-button';
import { Badge, Card, EmptyState, Field, Input, Notice, PageHeader, Select, Textarea, cx } from '@/components/ui';
import { formatMoney } from '@/lib/billing/plans';
import { PAY_METHOD_LABEL, TAX_TYPE_LABEL, activeOn, laborMonth, monthRange, shiftHours, t12, weeklyCost, type Employee, type Pay } from '@/lib/staff/payroll';
import { Stat } from '../_dashboard/tiles';
import { ReadOnlyNotice } from '../read-only-notice';
import { loadStaff } from './_data';
import { saveEmployee } from './actions';
import { WeekFields } from './week-fields';

export const metadata: Metadata = { title: 'Employees' };

function EmployeeFields({ e, pay, stores, payEdit }: { e?: Employee; pay?: Pay; stores: { id: string; name: string }[]; payEdit: boolean }) {
  const p = e?.id ?? 'new';
  return (
    <div className="flex flex-col gap-3">
      <input type="hidden" name="id" value={e?.id ?? ''} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" htmlFor={`${p}-name`}><Input id={`${p}-name`} name="name" defaultValue={e?.name} required maxLength={100} autoComplete="off" /></Field>
        <Field label="Role" htmlFor={`${p}-role`}><Input id={`${p}-role`} name="role_title" defaultValue={e?.role_title ?? ''} maxLength={60} placeholder="Cashier, Manager…" /></Field>
        {stores.length > 1 && (
          <Field label="Store" htmlFor={`${p}-loc`}>
            <Select id={`${p}-loc`} name="location_id" defaultValue={e?.location_id ?? ''}><option value="">Whole business</option>{stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
          </Field>
        )}
        <Field label="Start date" htmlFor={`${p}-start`}><Input id={`${p}-start`} name="start_date" type="date" defaultValue={e?.start_date ?? ''} /></Field>
        <Field label="End date" htmlFor={`${p}-end`} hint="Fill this in when someone leaves; their history stays."><Input id={`${p}-end`} name="end_date" type="date" defaultValue={e?.end_date ?? ''} /></Field>
      </div>
      {payEdit && (
        <fieldset className="grid gap-3 rounded-xl bg-soft p-3 sm:grid-cols-3">
          <legend className="px-1 text-sm font-semibold">Pay</legend>
          <Field label="Pay type" htmlFor={`${p}-type`}><Select id={`${p}-type`} name="pay_type" defaultValue={pay?.pay_type ?? 'hourly'}><option value="hourly">Hourly</option><option value="salary">Salary (per year)</option></Select></Field>
          <Field label="Rate" htmlFor={`${p}-rate`} hint="Per hour, or per year for salary."><Input id={`${p}-rate`} name="rate" inputMode="decimal" className="num" defaultValue={pay ? (pay.rate_cents / 100).toFixed(2) : ''} placeholder="15.00" /></Field>
          <Field label="Employer taxes & benefits %" htmlFor={`${p}-burden`}><Input id={`${p}-burden`} name="burden_pct" type="number" step="0.1" min={0} max={100} defaultValue={pay?.burden_pct ?? 10} /></Field>
          <Field label="Usual hours per week" htmlFor={`${p}-hours`} hint="Only used when there’s no weekly schedule."><Input id={`${p}-hours`} name="weekly_hours" type="number" step="0.5" min={0} max={168} defaultValue={pay?.weekly_hours ?? ''} /></Field>
          <Field label="Tax type" htmlFor={`${p}-tax`}><Select id={`${p}-tax`} name="tax_type" defaultValue={pay?.tax_type ?? ''}><option value="">Not set</option>{Object.entries(TAX_TYPE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
          <Field label="Paid by" htmlFor={`${p}-method`}><Select id={`${p}-method`} name="pay_method" defaultValue={pay?.pay_method ?? ''}><option value="">Not set</option>{Object.entries(PAY_METHOD_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
        </fieldset>
      )}
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-semibold">Regular weekly schedule</legend>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="use_regular" defaultChecked={!!e?.regular || !e} className="size-4 accent-[#3f63de]" /> Works the same days every week (repeats until you change a single week in Schedule)</label>
        <WeekFields prefix="reg" days={e?.regular ?? [null, { in: '09:00', out: '17:00', lunch: 30 }, { in: '09:00', out: '17:00', lunch: 30 }, { in: '09:00', out: '17:00', lunch: 30 }, { in: '09:00', out: '17:00', lunch: 30 }, { in: '09:00', out: '17:00', lunch: 30 }, null]} />
      </fieldset>
      <Field label="Notes" htmlFor={`${p}-notes`}><Textarea id={`${p}-notes`} name="notes" defaultValue={e?.notes ?? ''} maxLength={1000} className="min-h-16" /></Field>
      {e && (
        <label className="flex items-center gap-2 text-[15px]">
          <input type="hidden" name="active" value="false" />
          <input type="checkbox" name="active" value="true" defaultChecked={e.is_active} className="size-4 accent-[#3f63de]" /> Current employee
        </label>
      )}
      {!e && <input type="hidden" name="active" value="true" />}
    </div>
  );
}

/** #102 Employees, as in the RetailNexa app: payroll tiles, current and former employees. */
export default async function EmployeesPage() {
  const ctx = await getOrgContext();
  if (!(['employees.view', 'schedule.view', 'payroll.view'] as const).some((p) => can(ctx, p))) return <Notice tone="warning">Staff pages are for owners and managers.</Notice>;
  const s = await loadStaff(ctx, monthRange);
  const cur = s.today.slice(0, 7);
  const editable = can(ctx, 'employees.manage') && ctx.access.canWrite;
  const payEdit = can(ctx, 'payroll.manage') && ctx.access.canWrite;
  const current = s.employees.filter((e) => e.is_active && (!e.end_date || e.end_date >= s.today));
  const former = s.employees.filter((e) => !current.includes(e));
  const weekly = current.reduce((a, e) => a + weeklyCost(e, s.pays.get(e.id), s.rules), 0);
  let labor: ReturnType<typeof laborMonth> | null = null;
  if (s.seePay && can(ctx, 'sales.view')) {
    const data = await pageAll<{ business_date: string; gross_sales_cents: number }>((a, b) => s.supabase.from('sales_days').select('business_date, gross_sales_cents').eq('organization_id', ctx.org.id).is('voided_at', null)
      .gte('business_date', `${cur}-01`).lte('business_date', s.today).order('business_date').order('id').range(a, b));
    const sales = new Map<string, number>();
    for (const r of data ?? []) sales.set(r.business_date, (sales.get(r.business_date) ?? 0) + Number(r.gross_sales_cents));
    labor = laborMonth(cur, s.today, sales, s.employees, s.pays, s.idx, s.rules);
  }
  const daysInMonth = new Date(Date.UTC(+cur.slice(0, 4), +cur.slice(5, 7), 0)).getUTCDate();
  const monthly = current.reduce((a, e) => a + Math.round((weeklyCost(e, s.pays.get(e.id), s.rules) / 7) * daysInMonth), 0);
  const storeName = new Map(s.stores.map((x) => [x.id, x.name]));

  const row = (e: Employee) => {
    const pay = s.pays.get(e.id);
    const days = (e.regular ?? []).map((r, i) => (r ? `${['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'][i]} ${t12(r.in)}–${t12(r.out)}` : null)).filter(Boolean);
    const hours = e.regular ? e.regular.reduce((a, r) => a + shiftHours(r, s.rules.paid_lunch), 0) : pay?.weekly_hours ?? null;
    return (
      <li key={e.id}>
        <Card className="py-3">
          <details>
            <summary className="flex cursor-pointer list-none flex-col gap-1">
              <span className="flex items-baseline justify-between gap-3">
                <span className="font-bold">{e.name}{e.role_title && <span className="font-normal text-muted"> · {e.role_title}</span>}</span>
                {s.seePay && pay ? <span className="num font-semibold">{formatMoney(weeklyCost(e, pay, s.rules))}<span className="text-sm font-normal text-muted">/wk</span></span> : !activeOn(e, s.today) && <Badge>Former</Badge>}
              </span>
              <span className="flex flex-wrap gap-x-2 text-[13px] text-muted">
                {s.seePay && pay && <span>{pay.pay_type === 'salary' ? `Salary ${formatMoney(pay.rate_cents)}/yr` : `${formatMoney(pay.rate_cents)}/hr`}</span>}
                {hours !== null && <span>· {Number(hours).toFixed(1)} hrs/wk</span>}
                {s.seePay && pay?.pay_method && <span>· {PAY_METHOD_LABEL[pay.pay_method]}</span>}
                {s.stores.length > 1 && <span>· {e.location_id ? storeName.get(e.location_id) ?? 'Store' : 'Whole business'}</span>}
                {days.length > 0 && <span>· {days.join(', ')}</span>}
              </span>
            </summary>
            {editable ? (
              <ActionForm action={saveEmployee} className="mt-4 flex flex-col gap-3">
                <EmployeeFields e={e} pay={pay} stores={s.stores} payEdit={payEdit} />
                <SubmitButton className="self-start" variant="secondary" pendingText="Saving…">Save</SubmitButton>
              </ActionForm>
            ) : <p className="mt-3 text-sm text-muted">{e.notes ?? 'No notes.'}</p>}
          </details>
        </Card>
      </li>
    );
  };

  return (
    <>
      <PageHeader title="Employees" description="Everyone who works for you, their pay and their usual week. Labor cost uses each person’s schedule, pay rate and employer taxes." />
      <ReadOnlyNotice show={can(ctx, 'employees.manage') && !ctx.access.canWrite} />
      {s.seePay && current.length > 0 && (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          <Stat block="blue" label="Weekly payroll" value={formatMoney(weekly)} sub="All employees, incl. taxes" />
          <Stat block="indigo" label="Monthly payroll" value={formatMoney(monthly)} sub="Estimated for this month" />
          {labor && <Stat label="Labor % of sales" value={labor.pct === null ? '—' : `${labor.pct.toFixed(1)}%`} tone={labor.pct !== null && labor.pct > s.rules.labor_target_pct ? 'late' : undefined}
            sub={<Link href="/app/staff/labor" className="font-semibold text-accent-strong">Target {s.rules.labor_target_pct}% ›</Link>} />}
        </div>
      )}
      {s.employees.length === 0 ? (
        <EmptyState title="Add your team">Enter each employee’s pay rate and usual week. RetailNexa estimates labor cost and compares it with your sales.</EmptyState>
      ) : (
        <>
          <ul className="flex flex-col gap-2">{current.map(row)}</ul>
          {s.seePay && current.length > 0 && (
            <p className={cx('flex justify-between rounded-[14px] bg-card px-4 py-3 text-[15px] font-semibold shadow-[var(--shadow-card)]')}>
              <span>Total · {current.length} employee{current.length === 1 ? '' : 's'}</span><span className="num">{formatMoney(weekly)}/wk · {formatMoney(monthly)}/mo</span>
            </p>
          )}
          {former.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="text-[15px] font-bold text-muted">Former employees</h2>
              <ul className="flex flex-col gap-2">{former.map(row)}</ul>
            </section>
          )}
        </>
      )}
      {editable && (
        <Card id="add">
          <h2 className="mb-4 text-lg font-bold">Add an employee</h2>
          <ActionForm action={saveEmployee} className="flex flex-col gap-4">
            <EmployeeFields stores={s.stores} payEdit={payEdit} />
            <SubmitButton className="self-start" pendingText="Adding…">Add employee</SubmitButton>
          </ActionForm>
        </Card>
      )}
    </>
  );
}
