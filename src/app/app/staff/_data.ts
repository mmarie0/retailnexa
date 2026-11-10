import 'server-only';
import { can, getSupabase, type OrgContext } from '@/lib/auth/context';
import { todayIn } from '@/lib/time';
import { DEFAULT_RULES, indexShifts, type Employee, type Pay, type Rules, type Shift } from '@/lib/staff/payroll';

/** Everything the staff pages share: employees, pay (payroll.view only), rules, shifts in a range. */
export async function loadStaff(ctx: OrgContext, rangeFor?: (today: string) => { from: string; to: string }) {
  const supabase = await getSupabase();
  const { data: tzRow } = await supabase.from('organizations').select('timezone, name').eq('id', ctx.org.id).maybeSingle();
  const today = todayIn(tzRow?.timezone);
  const range = rangeFor?.(today);
  const seePay = can(ctx, 'payroll.view');
  const [{ data: emps }, { data: pays }, { data: rules }, { data: shifts }, { data: locs }] = await Promise.all([
    supabase.from('employees').select('id, name, role_title, location_id, start_date, end_date, is_active, regular, notes').eq('organization_id', ctx.org.id).order('name'),
    seePay ? supabase.from('employee_pay').select('employee_id, pay_type, rate_cents, weekly_hours, burden_pct, tax_type, pay_method').eq('organization_id', ctx.org.id)
      : Promise.resolve({ data: [] as Pay[] }),
    supabase.from('staff_settings').select('paid_lunch, overtime, overtime_after_hours, overtime_multiplier, pay_week_start, pay_every_weeks, labor_target_pct')
      .eq('organization_id', ctx.org.id).maybeSingle(),
    range ? supabase.from('shifts').select('employee_id, work_date, off, start_time, end_time, lunch_min, actual_in, actual_out')
      .eq('organization_id', ctx.org.id).gte('work_date', range.from).lte('work_date', range.to).limit(20000)
      : Promise.resolve({ data: [] as Shift[] }),
    supabase.rpc('my_locations', { p_org: ctx.org.id }),
  ]);
  const r = rules as Partial<Rules> | null;
  const num = (v: unknown, d: number) => (v === null || v === undefined ? d : Number(v));
  return {
    supabase,
    today,
    orgName: (tzRow?.name as string | undefined) ?? ctx.org.name,
    employees: (emps ?? []) as Employee[],
    pays: new Map(((pays ?? []) as Pay[]).map((p) => [p.employee_id, { ...p, rate_cents: Number(p.rate_cents), burden_pct: Number(p.burden_pct), weekly_hours: p.weekly_hours === null ? null : Number(p.weekly_hours) }])),
    rules: {
      ...DEFAULT_RULES, ...(r ?? {}),
      overtime_after_hours: num(r?.overtime_after_hours, 40), overtime_multiplier: num(r?.overtime_multiplier, 1.5),
      labor_target_pct: num(r?.labor_target_pct, 12), pay_week_start: num(r?.pay_week_start, 0), pay_every_weeks: num(r?.pay_every_weeks, 1),
    } as Rules,
    shifts: (shifts ?? []) as Shift[],
    idx: indexShifts((shifts ?? []) as Shift[]),
    stores: (locs ?? []) as { id: string; name: string }[],
    seePay,
  };
}
