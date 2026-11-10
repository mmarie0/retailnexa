'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { can, getOrgContext, getSupabase } from '@/lib/auth/context';
import { fail, failFrom, ok, type ActionState } from '@/lib/actions';

/** Reverse a manual or guided entry (#42). Sales, bills, payments and bank lines are undone from their own pages. */
export async function reverseJournalEntry(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await getOrgContext();
    if (!can(ctx, 'accounting.post')) return fail('You don’t have permission to do that.');
    if (!ctx.access.canWrite) return fail('Your account is read-only right now. Check the billing page.');
    const parsed = z.object({
      entry: z.string().uuid(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date'),
      reason: z.string().trim().min(3, 'Say why this entry is being reversed').max(480),
    }).safeParse(Object.fromEntries(form));
    if (!parsed.success) return fail(parsed.error.issues[0].message);
    const supabase = await getSupabase();
    const { error } = await supabase.rpc('reverse_journal_entry', { p_entry: parsed.data.entry, p_reversal_date: parsed.data.date, p_reason: parsed.data.reason });
    if (error) throw error;
    revalidatePath('/app/accounting/journal');
    revalidatePath('/app/deposits');
    return ok('Reversed. A mirror entry was posted.');
  } catch (e) {
    return failFrom(e);
  }
}
