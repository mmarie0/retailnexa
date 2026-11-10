'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { can, getOrgContext, getSupabase, type OrgContext } from '@/lib/auth/context';
import type { Permission } from '@/lib/auth/permissions';
import { fail, failFrom, friendlyError, ok, type ActionState } from '@/lib/actions';
import { parseDollarsToCents } from '@/lib/money';

const READ_ONLY = 'Your account is read-only right now, so changes can’t be saved. Check the billing page.';
const isState = (v: unknown): v is ActionState => typeof v === 'object' && v !== null && 'ok' in v;
async function guard(permission: Permission): Promise<OrgContext | ActionState> {
  const ctx = await getOrgContext();
  if (!can(ctx, permission)) return fail('You don’t have permission to do that.');
  if (!ctx.access.canWrite) return fail(READ_ONLY);
  return ctx;
}

const cents = z.number().int().min(0).max(1e12);
const dayRow = z.object({
  line: z.number().int(),
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  register: z.string().trim().min(1).max(60),
  grossCents: cents, discountsCents: cents, taxCents: cents, cashCents: cents, cardCents: cents, creditCents: cents,
  transactions: z.number().int().min(0).nullable(),
});

export type ImportResult = { ok: boolean; message: string; recorded: number; failed: { line: number; message: string }[] };

/** Records already-parsed rows (parsing + preview happen in the browser; everything is re-validated here and in SQL). */
export async function importSalesDays(input: { locationId: string; source: 'csv' | 'vela'; filename: string; rows: unknown }): Promise<ImportResult> {
  const none = (message: string): ImportResult => ({ ok: false, message, recorded: 0, failed: [] });
  try {
    const ctx = await guard('sales.import');
    if (isState(ctx)) return none(ctx.message ?? 'Not allowed.');
    const parsed = z.object({
      locationId: z.string().uuid(),
      source: z.enum(['csv', 'vela']),
      filename: z.string().max(200),
      rows: z.array(dayRow).min(1, 'Nothing to import.').max(400, 'Import at most 400 days at a time.'),
    }).safeParse(input);
    if (!parsed.success) return none(parsed.error.issues[0]?.message ?? 'The file could not be read.');
    const supabase = await getSupabase();
    const { data: batch, error: bErr } = await supabase.rpc('create_sales_import_batch', {
      p_org: ctx.org.id, p_source: parsed.data.source, p_filename: parsed.data.filename,
    });
    if (bErr) throw bErr;
    let recorded = 0;
    const failed: ImportResult['failed'] = [];
    // One RPC per day: each day posts its own journal entry, so a bad row doesn't block the rest.
    for (const r of parsed.data.rows) {
      const { error } = await supabase.rpc('record_sales_day', {
        p_org: ctx.org.id, p_location_id: parsed.data.locationId, p_business_date: r.businessDate,
        p_gross_sales_cents: r.grossCents, p_discounts_cents: r.discountsCents, p_sales_tax_cents: r.taxCents,
        p_cash_cents: r.cashCents, p_card_cents: r.cardCents, p_customer_credit_cents: r.creditCents,
        p_register: r.register, p_transaction_count: r.transactions, p_source: parsed.data.source,
        p_import_batch_id: batch as string,
      });
      if (error) failed.push({ line: r.line, message: error.code === '23505' ? 'already recorded — void that day first to replace it' : friendlyError(error) });
      else recorded++;
    }
    revalidatePath('/app/sales');
    const message = failed.length
      ? `Recorded ${recorded} day${recorded === 1 ? '' : 's'}; ${failed.length} skipped.`
      : `Recorded ${recorded} day${recorded === 1 ? '' : 's'} and posted them to the books.`;
    return { ok: recorded > 0, message, recorded, failed };
  } catch (e) {
    const s = failFrom(e);
    return none(s.message ?? 'Something went wrong.');
  }
}

export async function recordSalesDayManually(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await guard('sales.import');
    if (isState(ctx)) return ctx;
    const head = z.object({
      location_id: z.string().uuid('Pick a location'),
      business_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date'),
      register: z.string().trim().max(60).transform((v) => v || 'All registers'),
    }).safeParse(Object.fromEntries(form));
    if (!head.success) return fail('Check the highlighted fields.', Object.fromEntries(head.error.issues.map((i) => [String(i.path[0]), i.message])));
    const amt: Record<string, number> = {};
    for (const f of ['gross', 'discounts', 'tax', 'cash', 'card', 'credit']) {
      const raw = String(form.get(f) ?? '').trim();
      const c = raw === '' ? 0 : parseDollarsToCents(raw);
      if (c === null) return fail('Check the highlighted fields.', { [f]: 'Enter an amount like 125.00' });
      amt[f] = c;
    }
    if (!amt.gross) return fail('Check the highlighted fields.', { gross: 'Enter gross sales' });
    const expected = amt.gross - amt.discounts + amt.tax;
    const paid = amt.cash + amt.card + amt.credit;
    if (paid !== expected) {
      return fail(`Payments ($${(paid / 100).toFixed(2)}) must equal sales − discounts + tax ($${(expected / 100).toFixed(2)}).`);
    }
    const supabase = await getSupabase();
    const { error } = await supabase.rpc('record_sales_day', {
      p_org: ctx.org.id, p_location_id: head.data.location_id, p_business_date: head.data.business_date,
      p_gross_sales_cents: amt.gross, p_discounts_cents: amt.discounts, p_sales_tax_cents: amt.tax,
      p_cash_cents: amt.cash, p_card_cents: amt.card, p_customer_credit_cents: amt.credit,
      p_register: head.data.register, p_source: 'manual',
    });
    if (error) {
      if (error.code === '23505') return fail('That register already has sales recorded for this date. Void it first to replace it.');
      throw error;
    }
    revalidatePath('/app/sales');
    return ok('Recorded and posted to the books.');
  } catch (e) {
    return failFrom(e);
  }
}

export async function voidSalesDay(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await guard('sales.edit');
    if (isState(ctx)) return ctx;
    const id = z.string().uuid().parse(form.get('id'));
    const reason = String(form.get('reason') ?? '').trim();
    if (reason.length < 3) return fail('Say why this day is being voided.', { reason: 'Required' });
    const supabase = await getSupabase();
    const { error } = await supabase.rpc('void_sales_day', { p_sales_day: id, p_reason: reason.slice(0, 500) });
    if (error) throw error;
    revalidatePath('/app/sales');
    return ok('Voided. You can record this day again.');
  } catch (e) {
    return failFrom(e);
  }
}
