'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { can, getOrgContext, getSupabase } from '@/lib/auth/context';
import { fail, failFrom, ok, type ActionState } from '@/lib/actions';
import { parseDollarsToCents } from '@/lib/money';
import { parseAmount } from '@/lib/sales/import';
import { METHODS, parseLines } from '@/lib/bills/balances';

const READ_ONLY = 'Your account is read-only right now, so changes can’t be saved. Check the billing page.';
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const done = () => { revalidatePath('/app/bills/balances'); revalidatePath('/app'); };

/** Add or change a location balance (#106). */
export async function saveBalance(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await getOrgContext();
    if (!can(ctx, 'bills.create')) return fail('You don’t have permission to do that.');
    if (!ctx.access.canWrite) return fail(READ_ONLY);
    const f = z.object({
      id: z.string().uuid().or(z.literal('')).transform((v) => v || null),
      direction: z.enum(['owed_to_me', 'i_owe']),
      location_id: z.string().uuid().or(z.literal('')).transform((v) => v || null),
      other_party: z.string().trim().min(1, 'Who is it with?').max(100),
      entry_date: date, due_date: date.or(z.literal('')), count_month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).or(z.literal('')),
      reference: z.string().max(100).default(''), note: z.string().max(500).default(''), lines: z.string().max(6000).default(''),
    }).safeParse(Object.fromEntries(form));
    if (!f.success) return fail('Check the highlighted fields.', Object.fromEntries(f.error.issues.map((i) => [String(i.path[0]), i.message])));
    const v = f.data;
    const parsed = parseLines(v.lines, parseAmount);
    if (parsed.error) return fail(parsed.error, { lines: parsed.error });
    const typed = String(form.get('amount') ?? '').trim();
    const amount = typed ? parseDollarsToCents(typed) : parsed.lines.reduce((a, l) => a + l.amount_cents, 0);
    if (!amount || amount <= 0) return fail('Enter the amount, or line items that add up to it.', { amount: 'Enter an amount' });
    if (parsed.lines.length && parsed.lines.reduce((a, l) => a + l.amount_cents, 0) !== amount) return fail('The line items don’t add up to the amount.', { lines: 'Must add up to the amount' });
    if (v.due_date && v.due_date < v.entry_date) return fail('The paid-by date can’t be before the date.', { due_date: 'After the date' });
    const { error, data } = await (await getSupabase()).rpc('save_location_balance', {
      p_org: ctx.org.id, p_id: v.id,
      p: { direction: v.direction, location_id: v.location_id, other_party: v.other_party, entry_date: v.entry_date, due_date: v.due_date || null,
        count_month: v.count_month ? `${v.count_month}-01` : null, amount_cents: amount, lines: parsed.lines, reference: v.reference, note: v.note },
    });
    if (error) throw error;
    done();
    return { ...ok(v.id ? 'Saved.' : 'Balance added.'), data: { id: String(data) } };
  } catch (e) {
    return failFrom(e);
  }
}

/** Record a payment. "Collected" / "Paid in full" sends the whole remainder. */
export async function payBalance(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await getOrgContext();
    if (!can(ctx, 'bills.pay')) return fail('You don’t have permission to do that.');
    if (!ctx.access.canWrite) return fail(READ_ONLY);
    const f = z.object({ balance_id: z.string().uuid(), paid_on: date, method: z.enum(Object.keys(METHODS) as [keyof typeof METHODS]), reference: z.string().max(100).default(''), amount: z.string() })
      .safeParse(Object.fromEntries(form));
    if (!f.success) return fail('Pick a date and how it was paid.');
    const cents = parseDollarsToCents(f.data.amount);
    if (!cents || cents <= 0) return fail('Enter an amount over zero.', { amount: 'Over zero' });
    const { error } = await (await getSupabase()).rpc('add_location_balance_payment', {
      p_org: ctx.org.id, p_balance: f.data.balance_id, p_paid_on: f.data.paid_on, p_amount_cents: cents, p_method: f.data.method, p_reference: f.data.reference || null,
    });
    if (error) throw error;
    done();
    return ok('Payment recorded.');
  } catch (e) {
    return failFrom(e);
  }
}

/** Remove a payment, or a balance with no payments. */
export async function removeBalanceItem(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await getOrgContext();
    if (!ctx.access.canWrite) return fail(READ_ONLY);
    const kind = form.get('kind'), id = z.string().uuid().safeParse(form.get('id'));
    if (!id.success) return fail('That item wasn’t found.');
    const supabase = await getSupabase();
    const { error } = kind === 'payment'
      ? await supabase.rpc('delete_location_balance_payment', { p_org: ctx.org.id, p_payment: id.data })
      : await supabase.rpc('delete_location_balance', { p_org: ctx.org.id, p_id: id.data });
    if (error) throw error;
    done();
    return ok('Removed.');
  } catch (e) {
    return failFrom(e);
  }
}
