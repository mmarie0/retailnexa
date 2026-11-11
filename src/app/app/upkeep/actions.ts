'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { can, getOrgContext, getSupabase } from '@/lib/auth/context';
import { fail, failFrom, ok, type ActionState } from '@/lib/actions';
import { parseDollarsToCents } from '@/lib/money';
import { TEMPLATES } from '@/lib/upkeep';

const READ_ONLY = 'Your account is read-only right now, so changes can’t be saved. Check the billing page.';
const done = () => revalidatePath('/app/upkeep');

/** Add or change a maintenance task (#115). A template index adds that suggested task. */
export async function saveTask(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await getOrgContext();
    if (!can(ctx, 'tasks.manage')) return fail('You don’t have permission to do that.');
    if (!ctx.access.canWrite) return fail(READ_ONLY);
    const tpl = form.get('template');
    if (tpl !== null) {
      const t = TEMPLATES[Number(tpl)];
      if (!t) return fail('That suggestion wasn’t found.');
      const { error } = await (await getSupabase()).rpc('save_maintenance_task', { p_org: ctx.org.id, p_id: null, p: { ...t, location_id: String(form.get('location_id') ?? '') || null } });
      if (error) throw error;
      done();
      return ok(`Added ${t.name}.`);
    }
    const f = z.object({
      id: z.string().uuid().or(z.literal('')).transform((v) => v || null),
      name: z.string().trim().min(1, 'Name the task').max(80),
      area: z.string().max(40).default(''), every_n: z.coerce.number().int().min(1).max(120),
      every_unit: z.enum(['days', 'weeks', 'months', 'years']), last_done: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal('')),
      vendor: z.string().max(80).default(''), notes: z.string().max(500).default(''), location_id: z.string().uuid().or(z.literal('')).default(''),
    }).safeParse(Object.fromEntries(form));
    if (!f.success) return fail('Check the highlighted fields.', Object.fromEntries(f.error.issues.map((i) => [String(i.path[0]), i.message])));
    const v = f.data;
    const { error } = await (await getSupabase()).rpc('save_maintenance_task', {
      p_org: ctx.org.id, p_id: v.id,
      p: { name: v.name, area: v.area, every_n: v.every_n, every_unit: v.every_unit, last_done: v.last_done || null, vendor: v.vendor, notes: v.notes, location_id: v.location_id || null, active: form.get('active') !== 'false' },
    });
    if (error) throw error;
    done();
    return ok(v.id ? 'Saved.' : 'Task added.');
  } catch (e) { return failFrom(e); }
}

/** Mark a task done on a day, with what it cost. */
export async function markDone(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await getOrgContext();
    if (!can(ctx, 'maintenance.complete')) return fail('You don’t have permission to do that.');
    if (!ctx.access.canWrite) return fail(READ_ONLY);
    const f = z.object({ task_id: z.string().uuid(), done_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), cost: z.string().default(''), note: z.string().max(300).default('') }).safeParse(Object.fromEntries(form));
    if (!f.success) return fail('Pick the day it was done.');
    const cost = f.data.cost.trim() ? parseDollarsToCents(f.data.cost) : 0;
    if (cost === null || cost < 0) return fail('Cost looks like 45.00.', { cost: 'Enter an amount' });
    const { error } = await (await getSupabase()).rpc('log_maintenance', { p_org: ctx.org.id, p_task: f.data.task_id, p_done_on: f.data.done_on, p_cost_cents: cost, p_note: f.data.note || null });
    if (error) throw error;
    done();
    return ok('Marked done.');
  } catch (e) { return failFrom(e); }
}

export async function removeUpkeepItem(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await getOrgContext();
    if (!can(ctx, 'tasks.manage')) return fail('You don’t have permission to do that.');
    if (!ctx.access.canWrite) return fail(READ_ONLY);
    const id = z.string().uuid().safeParse(form.get('id'));
    if (!id.success) return fail('That item wasn’t found.');
    const sb = await getSupabase();
    const { error } = form.get('kind') === 'log'
      ? await sb.rpc('delete_maintenance_log', { p_org: ctx.org.id, p_id: id.data })
      : await sb.rpc('delete_maintenance_task', { p_org: ctx.org.id, p_id: id.data });
    if (error) throw error;
    done();
    return ok('Removed.');
  } catch (e) { return failFrom(e); }
}
