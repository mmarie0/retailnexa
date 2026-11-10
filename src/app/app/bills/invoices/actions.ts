'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { can, getOrgContext, getSupabase } from '@/lib/auth/context';
import { fail, failFrom, friendlyError, ok, type ActionState } from '@/lib/actions';
import { parseDollarsToCents } from '@/lib/money';

import { INVOICE_TYPES } from '@/lib/invoices/types';
const READ_ONLY = 'Your account is read-only right now, so changes can’t be saved. Check the billing page.';

/** Step 1 of an upload: the database makes the row and says exactly where the file may go. */
export async function beginInvoiceUpload(input: { fileName: string; mime: string; size: number; location: string | null }):
  Promise<{ ok: true; id: string; path: string } | { ok: false; message: string }> {
  try {
    const ctx = await getOrgContext();
    if (!can(ctx, 'invoices.upload')) return { ok: false, message: 'You don’t have permission to upload invoices.' };
    if (!ctx.access.canWrite) return { ok: false, message: READ_ONLY };
    const p = z.object({
      fileName: z.string().trim().min(1).max(200), mime: z.enum(INVOICE_TYPES),
      size: z.number().int().min(1).max(10 * 1024 * 1024), location: z.string().uuid().nullable(),
    }).safeParse(input);
    if (!p.success) return { ok: false, message: 'Upload a photo (JPEG, PNG, WebP, HEIC) or a PDF up to 10 MB.' };
    const supabase = await getSupabase();
    const { data, error } = await supabase.rpc('begin_invoice_upload', {
      p_org: ctx.org.id, p_file_name: p.data.fileName, p_mime: p.data.mime, p_size: p.data.size, p_location: p.data.location,
    });
    if (error) throw error;
    const row = (data as { id: string; storage_path: string }[])[0];
    return { ok: true, id: row.id, path: row.storage_path };
  } catch (e) {
    return { ok: false, message: friendlyError(e) };
  }
}

/** Step 3: the file is in storage; the invoice moves to "Needs review". */
export async function finishInvoiceUpload(id: string): Promise<{ ok: boolean; message?: string }> {
  try {
    await getOrgContext();
    const supabase = await getSupabase();
    const { error } = await supabase.rpc('finish_invoice_upload', { p_id: z.string().uuid().parse(id) });
    if (error) throw error;
    revalidatePath('/app/bills/invoices');
    return { ok: true };
  } catch (e) {
    return { ok: false, message: friendlyError(e) };
  }
}

const opt = (max: number) => z.string().trim().max(max).transform((v) => v || null);

export async function reviewInvoice(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await getOrgContext();
    if (!can(ctx, 'invoices.upload')) return fail('You don’t have permission to do that.');
    if (!ctx.access.canWrite) return fail(READ_ONLY);
    const p = z.object({
      id: z.string().uuid(),
      vendor_id: z.string().uuid().or(z.literal('')).transform((v) => v || null),
      bill_id: z.string().uuid().or(z.literal('')).transform((v) => v || null),
      invoice_number: opt(60),
      invoice_date: z.string().regex(/^(20\d{2}|2100)-\d{2}-\d{2}$/, 'Pick a date').or(z.literal('')).transform((v) => v || null),
      note: opt(500),
      reviewed: z.enum(['true', 'false']).transform((v) => v === 'true'),
    }).safeParse(Object.fromEntries(form));
    if (!p.success) return fail('Check the highlighted fields.', Object.fromEntries(p.error.issues.map((i) => [String(i.path[0]), i.message])));
    const raw = String(form.get('amount') ?? '').trim();
    const cents = raw ? parseDollarsToCents(raw) : null;
    if (raw && !cents) return fail('Enter an amount like 125.00.', { amount: 'Enter an amount' });
    const supabase = await getSupabase();
    const { error } = await supabase.rpc('review_invoice', {
      p_id: p.data.id, p_vendor: p.data.vendor_id, p_invoice_number: p.data.invoice_number, p_invoice_date: p.data.invoice_date,
      p_amount_cents: cents, p_bill: p.data.bill_id, p_note: p.data.note, p_reviewed: p.data.reviewed,
    });
    if (error) throw error;
    revalidatePath('/app/bills/invoices');
    return ok(p.data.reviewed ? 'Saved and marked reviewed.' : 'Saved.');
  } catch (e) {
    return failFrom(e);
  }
}

export async function discardInvoice(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await getOrgContext();
    if (!can(ctx, 'invoices.upload')) return fail('You don’t have permission to do that.');
    if (!ctx.access.canWrite) return fail(READ_ONLY);
    const supabase = await getSupabase();
    const { error } = await supabase.rpc('discard_invoice', { p_id: z.string().uuid().parse(form.get('id')) });
    if (error) throw error;
    revalidatePath('/app/bills/invoices');
    return ok('Removed from the list.');
  } catch (e) {
    return failFrom(e);
  }
}
