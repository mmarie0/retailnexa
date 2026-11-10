'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { can, getOrgContext, getSupabase } from '@/lib/auth/context';
import { fail, failFrom, ok, type ActionState } from '@/lib/actions';
import { parseDollarsToCents } from '@/lib/money';

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date');

export async function saveRecurringBill(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await getOrgContext();
    if (!can(ctx, 'bills.create')) return fail('You don’t have permission to do that.');
    if (!ctx.access.canWrite) return fail('Your account is read-only right now. Check the billing page.');
    const parsed = z.object({
      id: uuid.or(z.literal('')).transform((v) => v || null),
      vendor_id: uuid.or(z.literal('')).refine((v) => v !== '', 'Pick a vendor'),
      name: z.string().trim().min(1, 'Name it, e.g. Rent').max(80),
      frequency: z.enum(['weekly', 'monthly', 'quarterly', 'yearly']),
      next_date: date,
      due_days: z.coerce.number().int().min(0).max(365),
      end_date: date.or(z.literal('')).transform((v) => v || null),
      account_id: uuid.or(z.literal('')).refine((v) => v !== '', 'Pick an account'),
      description: z.string().trim().max(300).transform((v) => v || null),
      location_id: uuid.or(z.literal('')).transform((v) => v || null),
      is_active: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
    }).safeParse(Object.fromEntries(form));
    if (!parsed.success) return fail('Check the highlighted fields.', Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
    const cents = parseDollarsToCents(String(form.get('amount') ?? ''));
    if (!cents) return fail('Check the highlighted fields.', { amount: 'Enter an amount like 3500.00' });
    const d = parsed.data;
    const { error } = await (await getSupabase()).rpc('save_recurring_bill', {
      p_org: ctx.org.id, p_id: d.id, p_vendor: d.vendor_id, p_name: d.name,
      p_lines: [{ account_id: d.account_id, amount_cents: cents, description: d.description }],
      p_frequency: d.frequency, p_next_date: d.next_date, p_day_of_month: null, p_due_days: d.due_days,
      p_end_date: d.end_date, p_location_id: d.location_id, p_is_active: d.is_active,
    });
    if (error) throw error;
    revalidatePath('/app/bills/recurring');
    return ok(d.id ? 'Saved.' : `Added ${d.name}. Use “Create due bills” to make the bills that are due.`);
  } catch (e) {
    return failFrom(e);
  }
}

export async function createDueRecurringBills(): Promise<ActionState> {
  try {
    const ctx = await getOrgContext();
    if (!can(ctx, 'bills.create')) return fail('You don’t have permission to do that.');
    if (!ctx.access.canWrite) return fail('Your account is read-only right now. Check the billing page.');
    const { data, error } = await (await getSupabase()).rpc('create_due_recurring_bills', { p_org: ctx.org.id });
    if (error) throw error;
    const { made = 0, failed = 0 } = (data ?? {}) as { made?: number; failed?: number };
    revalidatePath('/app/bills/recurring');
    revalidatePath('/app/bills');
    const created = made ? `Created ${made} draft bill${made === 1 ? '' : 's'}. Approve them on the Bills page.` : 'Nothing new was created.';
    if (failed) return fail(`${made ? created + ' ' : ''}${failed} recurring bill${failed === 1 ? '' : 's'} couldn’t be created. Open the one marked “Needs attention” to see why.`);
    return ok(made ? created : 'Nothing is due yet.');
  } catch (e) {
    return failFrom(e);
  }
}
