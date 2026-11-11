'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { can, getOrgContext, getSupabase } from '@/lib/auth/context';
import { fail, failFrom, friendlyError, ok, type ActionState } from '@/lib/actions';
import { parseDollarsToCents } from '@/lib/money';

const READ_ONLY = 'Your account is read-only right now, so changes can’t be saved. Check the billing page.';
const uuidOrNull = z.string().uuid().or(z.literal('')).nullable().transform((v) => v || null);

/** Add or fix one month by hand (the POS month-end report's totals). */
export async function saveSalesMonth(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await getOrgContext();
    if (!can(ctx, 'sales.import')) return fail('You don’t have permission to do that.');
    if (!ctx.access.canWrite) return fail(READ_ONLY);
    const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Pick a month').safeParse(form.get('month'));
    if (!month.success) return fail('Pick a month.', { month: 'Pick a month' });
    const loc = uuidOrNull.parse(form.get('location_id') ?? '');
    const money: Record<string, number | null> = {};
    for (const f of ['sales', 'gross', 'tax', 'cash', 'card', 'store_card', 'points']) {
      const raw = String(form.get(f) ?? '').trim();
      money[f] = raw === '' ? null : parseDollarsToCents(raw);
      if (raw !== '' && money[f] === null) return fail('Amounts look like 1234.56.', { [f]: 'Enter an amount' });
    }
    if (money.sales === null) return fail('Enter the month’s sales.', { sales: 'Required' });
    const tx = String(form.get('transactions') ?? '').replace(/[,\s]/g, '');
    if (tx && !/^\d{1,9}$/.test(tx)) return fail('Transactions is a whole number.', { transactions: 'Whole number' });
    const { error } = await (await getSupabase()).rpc('save_sales_month', {
      p_org: ctx.org.id, p_location: loc, p_month: `${month.data}-01`, p_source: 'manual',
      p: { sales_cents: money.sales, gross_cents: money.gross, tax_cents: money.tax ?? 0, cash_cents: money.cash ?? 0, card_cents: money.card ?? 0,
        store_card_cents: money.store_card ?? 0, points_cents: money.points ?? 0, transactions: tx ? Number(tx) : null, note: String(form.get('note') ?? '').slice(0, 300) || null },
    });
    if (error) throw error;
    revalidatePath('/app/sales/history');
    return ok('Month saved.');
  } catch (e) {
    return failFrom(e);
  }
}

const monthRow = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), sales_cents: z.number().int().min(0), gross_cents: z.number().int().min(0).nullable(),
  tax_cents: z.number().int().min(0), cash_cents: z.number().int().min(0), card_cents: z.number().int().min(0),
  store_card_cents: z.number().int().min(0), points_cents: z.number().int().min(0), transactions: z.number().int().min(0).nullable(),
});
/** Monthly reports from a sheet (parsed in the browser). Each month is saved on its own. */
export async function importSalesMonths(input: { location: string | null; rows: unknown }): Promise<{ ok: boolean; saved: number; errors: string[] }> {
  const ctx = await getOrgContext();
  if (!can(ctx, 'sales.import')) return { ok: false, saved: 0, errors: ['You don’t have permission to do that.'] };
  if (!ctx.access.canWrite) return { ok: false, saved: 0, errors: [READ_ONLY] };
  const rows = z.array(monthRow).min(1).max(600).safeParse(input.rows);
  const loc = uuidOrNull.safeParse(input.location ?? '');
  if (!rows.success || !loc.success) return { ok: false, saved: 0, errors: ['The sheet isn’t in the expected shape.'] };
  const supabase = await getSupabase();
  let saved = 0;
  const errors: string[] = [];
  for (const r of rows.data) {
    const { month, ...p } = r;
    const { error } = await supabase.rpc('save_sales_month', { p_org: ctx.org.id, p_location: loc.data, p_month: `${month}-01`, p: p, p_source: 'csv' });
    if (error) errors.push(`${month}: ${friendlyError(error)}`); else saved++;
  }
  revalidatePath('/app/sales/history');
  return { ok: errors.length === 0, saved, errors };
}

/** A month's category report (parsed in the browser); replaces that store's month. */
export async function saveCategoryReport(input: { location: string | null; month: string; rows: unknown }): Promise<{ ok: boolean; message: string }> {
  try {
    const ctx = await getOrgContext();
    if (!can(ctx, 'sales.import')) return { ok: false, message: 'You don’t have permission to do that.' };
    if (!ctx.access.canWrite) return { ok: false, message: READ_ONLY };
    const p = z.object({
      location: uuidOrNull, month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
      rows: z.array(z.object({ category: z.string().trim().min(1).max(120), sales_cents: z.number().int(), quantity: z.number().nullable() })).min(1).max(2000),
    }).safeParse({ ...input, location: input.location ?? '' });
    if (!p.success) return { ok: false, message: 'The report isn’t in the expected shape.' };
    const { data, error } = await (await getSupabase()).rpc('save_category_month', { p_org: ctx.org.id, p_location: p.data.location, p_month: `${p.data.month}-01`, p_rows: p.data.rows });
    if (error) throw error;
    revalidatePath('/app/sales/categories');
    return { ok: true, message: `Saved ${data} categor${data === 1 ? 'y' : 'ies'}.` };
  } catch (e) {
    return { ok: false, message: friendlyError(e) };
  }
}
