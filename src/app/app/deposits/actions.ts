'use server';
import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { can, getOrgContext, getSupabase } from '@/lib/auth/context';
import { fail, failFrom, ok, type ActionState } from '@/lib/actions';
import { parseDollarsToCents } from '@/lib/money';

const MOVEMENT_KINDS = ['card_deposit', 'cash_deposit', 'sales_tax_payment', 'owner_draw', 'owner_contribution'] as const;

export async function recordMoneyMovement(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await getOrgContext();
    const parsed = z.object({
      kind: z.enum(MOVEMENT_KINDS),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date'),
      account: z.enum(['bank', 'cash_on_hand']).default('bank'),
      memo: z.string().trim().max(500).transform((v) => v || null),
      idempotency_key: z.string().regex(/^[A-Za-z0-9-]{8,100}$/),
    }).safeParse({
      kind: form.get('kind'), date: form.get('date'), account: form.get('account') ?? undefined,
      memo: form.get('memo') ?? '', idempotency_key: form.get('idempotency_key'),
    });
    if (!parsed.success) return fail('Check the highlighted fields.', Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
    const { kind } = parsed.data;
    const allowed = can(ctx, 'accounting.post') || (kind === 'cash_deposit' && can(ctx, 'cash.create'));
    if (!allowed) return fail('You don’t have permission to do that.');
    if (!ctx.access.canWrite) return fail('Your account is read-only right now. Check the billing page.');
    const amount = parseDollarsToCents(String(form.get('amount') ?? ''));
    if (!amount) return fail('Check the highlighted fields.', { amount: 'Enter an amount like 125.00' });
    const feesRaw = String(form.get('fees') ?? '').trim();
    const fees = kind === 'card_deposit' && feesRaw ? parseDollarsToCents(feesRaw) : 0;
    if (fees === null) return fail('Check the highlighted fields.', { fees: 'Enter an amount like 12.50' });
    const supabase = await getSupabase();
    const { error } = await supabase.rpc('record_money_movement', {
      p_org: ctx.org.id, p_kind: kind, p_date: parsed.data.date, p_amount_cents: amount,
      p_idempotency_key: `${ctx.org.id.slice(0, 8)}-${parsed.data.idempotency_key}`, p_fees_cents: fees,
      p_account: kind === 'owner_draw' || kind === 'owner_contribution' ? parsed.data.account : 'bank', p_memo: parsed.data.memo,
    });
    if (error) throw error;
    revalidatePath('/app/deposits');
    revalidatePath('/app');
    // A fresh key for the next entry; a failed submit keeps its key so a retry can't double-post.
    return { ...ok('Recorded and posted to the books.'), data: { nextKey: randomUUID() } };
  } catch (e) {
    return failFrom(e);
  }
}
