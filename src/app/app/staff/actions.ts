'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { can, getOrgContext, getSupabase, type OrgContext } from '@/lib/auth/context';
import type { Permission } from '@/lib/auth/permissions';
import { fail, failFrom, ok, type ActionState } from '@/lib/actions';
import { parseDollarsToCents } from '@/lib/money';
import { payLineError } from '@/lib/staff/payroll';

const READ_ONLY = 'Your account is read-only right now, so changes can’t be saved. Check the billing page.';
async function guard(p: Permission): Promise<{ ctx: OrgContext; error?: undefined } | { error: ActionState }> {
  const ctx = await getOrgContext();
  if (!can(ctx, p)) return { error: fail('You don’t have permission to do that.') };
  if (!ctx.access.canWrite) return { error: fail(READ_ONLY) };
  return { ctx };
}
const time = /^([01]\d|2[0-3]):[0-5]\d$/;
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal('')).transform((v) => v || null);
const issues = (e: z.ZodError) => Object.fromEntries(e.issues.map((i) => [String(i.path[0]), i.message]));

/** 7 days from fields like reg-on-1, reg-in-1, reg-out-1, reg-lunch-1 (Sunday = 0). */
function weekFrom(form: FormData, prefix: string, offValue: 'null' | 'off') {
  const days: (null | { off: true } | { in: string; out: string; lunch: number })[] = [];
  for (let i = 0; i < 7; i++) {
    const on = form.get(`${prefix}-on-${i}`) === 'on';
    const inn = String(form.get(`${prefix}-in-${i}`) ?? ''), out = String(form.get(`${prefix}-out-${i}`) ?? '');
    const lunch = Number(form.get(`${prefix}-lunch-${i}`) ?? 0) || 0;
    if (!on) { days.push(offValue === 'off' ? { off: true } : null); continue; }
    if (!time.test(inn) || !time.test(out)) return { error: `Day ${i + 1}: enter start and end times.` };
    days.push({ in: inn, out, lunch: Math.min(240, Math.max(0, Math.round(lunch))) });
  }
  return { days };
}

export async function saveEmployee(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const g = await guard('employees.manage');
    if (g.error) return g.error;
    const p = z.object({
      id: z.string().uuid().or(z.literal('')).transform((v) => v || null),
      name: z.string().trim().min(1, 'Enter a name').max(100),
      role_title: z.string().trim().max(60),
      location_id: z.string().uuid().or(z.literal('')).transform((v) => v || null),
      start_date: date, end_date: date,
      active: z.enum(['true', 'false']).transform((v) => v === 'true'),
      notes: z.string().trim().max(1000),
    }).safeParse(Object.fromEntries(form));
    if (!p.success) return fail('Check the highlighted fields.', issues(p.error));
    const useRegular = form.get('use_regular') === 'on';
    const wk = useRegular ? weekFrom(form, 'reg', 'null') : { days: null };
    if ('error' in wk) return fail(wk.error ?? 'Check the schedule.');
    let pay: Record<string, unknown> | null = null;
    if (can(g.ctx, 'payroll.manage') && form.has('pay_type')) {
      const rate = parseDollarsToCents(String(form.get('rate') ?? '0') || '0') ?? null;
      if (rate === null) return fail('Enter a pay rate like 15.00.', { rate: 'Enter an amount' });
      const burden = Number(form.get('burden_pct') ?? 10), hours = String(form.get('weekly_hours') ?? '').trim();
      if (!(burden >= 0 && burden <= 100)) return fail('Employer taxes are 0 to 100 percent.', { burden_pct: '0 to 100' });
      pay = { pay_type: form.get('pay_type') === 'salary' ? 'salary' : 'hourly', rate_cents: rate, burden_pct: burden,
        weekly_hours: hours ? Math.min(168, Math.max(0, Number(hours))) : null,
        tax_type: ['w2', '1099'].includes(String(form.get('tax_type'))) ? form.get('tax_type') : null,
        pay_method: ['cash', 'check', 'ach'].includes(String(form.get('pay_method'))) ? form.get('pay_method') : null };
    }
    const d = p.data;
    const { error } = await (await getSupabase()).rpc('save_employee', {
      p_org: g.ctx.org.id, p_id: d.id, p_name: d.name, p_role_title: d.role_title || null, p_location: d.location_id,
      p_start: d.start_date, p_end: d.end_date, p_active: d.active, p_regular: wk.days, p_notes: d.notes || null, p_pay: pay,
    });
    if (error) throw error;
    revalidatePath('/app/staff', 'layout');
    return ok(d.id ? 'Saved.' : `Added ${d.name}.`);
  } catch (e) {
    return failFrom(e);
  }
}

export async function saveWeek(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const g = await guard('schedule.manage');
    if (g.error) return g.error;
    const employee = z.string().uuid().parse(form.get('employee_id'));
    const week = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(form.get('week'));
    if (form.get('reset') === 'true') {
      const { error } = await (await getSupabase()).rpc('set_week_shifts', { p_org: g.ctx.org.id, p_employee: employee, p_week: week, p_days: [null, null, null, null, null, null, null] });
      if (error) throw error;
      revalidatePath('/app/staff', 'layout');
      return ok('Back to the regular schedule for this week.');
    }
    const wk = weekFrom(form, 'wk', 'off');
    if ('error' in wk) return fail(wk.error ?? 'Check the times.');
    // Clock-in/out times, when entered.
    const days = wk.days!.map((d, i) => {
      if (!d || 'off' in d) return d;
      const ai = String(form.get(`wk-ai-${i}`) ?? ''), ao = String(form.get(`wk-ao-${i}`) ?? '');
      return time.test(ai) && time.test(ao) ? { ...d, act_in: ai, act_out: ao } : d;
    });
    const { error } = await (await getSupabase()).rpc('set_week_shifts', { p_org: g.ctx.org.id, p_employee: employee, p_week: week, p_days: days });
    if (error) throw error;
    revalidatePath('/app/staff', 'layout');
    return ok('Week saved.');
  } catch (e) {
    return failFrom(e);
  }
}

export async function copyWeek(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const g = await guard('schedule.manage');
    if (g.error) return g.error;
    const week = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(form.get('week'));
    const { data, error } = await (await getSupabase()).rpc('copy_week', { p_org: g.ctx.org.id, p_week: week });
    if (error) throw error;
    revalidatePath('/app/staff', 'layout');
    return ok(data ? `Copied ${data} shift${data === 1 ? '' : 's'} from last week.` : 'Last week had no changes from the regular schedule, so this week follows it too.');
  } catch (e) {
    return failFrom(e);
  }
}

export async function saveRules(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const g = await guard('payroll.manage');
    if (g.error) return g.error;
    const p = z.object({
      paid_lunch: z.enum(['true', 'false']).transform((v) => v === 'true'),
      overtime: z.enum(['true', 'false']).transform((v) => v === 'true'),
      overtime_after: z.coerce.number().min(1).max(168),
      overtime_multiplier: z.coerce.number().min(1).max(3),
      pay_week_start: z.coerce.number().int().min(0).max(6),
      pay_every_weeks: z.coerce.number().int().refine((n) => n === 1 || n === 2),
      labor_target: z.coerce.number().min(0).max(100),
    }).safeParse(Object.fromEntries(form));
    if (!p.success) return fail('Check the highlighted fields.', issues(p.error));
    const d = p.data;
    const { error } = await (await getSupabase()).rpc('save_staff_settings', {
      p_org: g.ctx.org.id, p_paid_lunch: d.paid_lunch, p_overtime: d.overtime, p_overtime_after: d.overtime_after,
      p_overtime_multiplier: d.overtime_multiplier, p_pay_week_start: d.pay_week_start, p_pay_every_weeks: d.pay_every_weeks, p_labor_target: d.labor_target,
    });
    if (error) throw error;
    revalidatePath('/app/staff', 'layout');
    return ok('Saved.');
  } catch (e) {
    return failFrom(e);
  }
}

export async function addAdvance(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const g = await guard('payroll.manage');
    if (g.error) return g.error;
    const employee = z.string().uuid().safeParse(form.get('employee_id'));
    if (!employee.success) return fail('Pick an employee.', { employee_id: 'Required' });
    const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).safeParse(form.get('date'));
    if (!day.success) return fail('Pick a date.', { date: 'Required' });
    const cents = parseDollarsToCents(String(form.get('amount') ?? ''));
    if (!cents) return fail('Enter an amount like 100.00.', { amount: 'Enter an amount' });
    const { error } = await (await getSupabase()).rpc('add_advance', {
      p_org: g.ctx.org.id, p_employee: employee.data, p_date: day.data, p_amount_cents: cents, p_note: String(form.get('note') ?? '').slice(0, 200) || null,
    });
    if (error) throw error;
    revalidatePath('/app/staff', 'layout');
    return ok('Advance recorded. It comes out of their next pay run.');
  } catch (e) {
    return failFrom(e);
  }
}

/** Lines arrive as line-<employee>-<field> inputs; the database recomputes gross and net. */
export async function createPayRun(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const g = await guard('payroll.manage');
    if (g.error) return g.error;
    const head = z.object({
      pay_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date'),
      period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      note: z.string().trim().max(300).optional(),
      idempotency_key: z.string().regex(/^[A-Za-z0-9-]{8,100}$/),
    }).safeParse(Object.fromEntries(form));
    if (!head.success) return fail('Check the highlighted fields.', issues(head.error));
    const ids = form.getAll('employee_id').map(String).filter((id) => z.string().uuid().safeParse(id).success);
    const lines = [];
    for (const id of ids) {
      if (form.get(`inc-${id}`) !== 'on') continue;
      // Only hours, overtime hours and a bonus come from the form; the database computes the pay (#156).
      const bonusRaw = String(form.get(`bonus-${id}`) ?? '').trim();
      const bonus = bonusRaw ? parseDollarsToCents(bonusRaw) : 0;
      const hours = Number(form.get(`hours-${id}`) ?? 0), ot = Number(form.get(`ot-${id}`) ?? 0);
      if (bonus === null || bonus > 1_000_000 || !(hours >= 0 && hours <= 400) || !(ot >= 0 && ot <= hours)) {
        return fail(payLineError(String(form.get(`name-${id}`) ?? 'an employee')));
      }
      lines.push({ employee_id: id, hours, overtime_hours: ot, bonus_cents: bonus, pay_method: String(form.get(`method-${id}`) ?? '') || null,
        advance_ids: form.getAll(`adv-${id}`).map(String).filter((a) => z.string().uuid().safeParse(a).success) });
    }
    if (!lines.length) return fail('Tick at least one employee.');
    const h = head.data;
    const { error } = await (await getSupabase()).rpc('create_pay_run', {
      p_org: g.ctx.org.id, p_pay_date: h.pay_date, p_period_start: h.period_start, p_period_end: h.period_end, p_lines: lines, p_note: h.note || null,
      p_idempotency_key: `${g.ctx.org.id.slice(0, 8)}-${h.idempotency_key}`,
    });
    if (error) throw error;
    revalidatePath('/app/staff', 'layout');
    return ok(`Pay run saved for ${lines.length} employee${lines.length === 1 ? '' : 's'}. Open Paystubs to print them.`);
  } catch (e) {
    return failFrom(e);
  }
}

export async function voidPayRun(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const g = await guard('payroll.manage');
    if (g.error) return g.error;
    const { error } = await (await getSupabase()).rpc('void_pay_run', { p_run: z.string().uuid().parse(form.get('id')) });
    if (error) throw error;
    revalidatePath('/app/staff', 'layout');
    return ok('Pay run voided. Its advances are open again.');
  } catch (e) {
    return failFrom(e);
  }
}
