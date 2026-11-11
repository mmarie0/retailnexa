'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { can, getOrgContext, getSupabase } from '@/lib/auth/context';
import { fail, failFrom, friendlyError, ok, type ActionState } from '@/lib/actions';
import { parseCsv } from '@/lib/sales/csv';
import { parseStatementSheet } from '@/lib/bills/statements';

const READ_ONLY = 'Your account is read-only right now, so changes can’t be saved. Check the billing page.';
async function guard() {
  const ctx = await getOrgContext();
  if (!can(ctx, 'bills.create')) return { error: fail('You don’t have permission to do that.') } as const;
  if (!ctx.access.canWrite) return { error: fail(READ_ONLY) } as const;
  return { ctx } as const;
}

/** New statement from a CSV file or pasted rows (#110). Nothing is saved if any line has a problem. */
export async function createStatement(_p: ActionState, form: FormData): Promise<ActionState> {
  let id: string;
  try {
    const g = await guard(); if ('error' in g) return g.error!;
    const f = z.object({ vendor_id: z.string().uuid(), statement_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), note: z.string().max(300).default('') }).safeParse(Object.fromEntries(form));
    if (!f.success) return fail('Pick the vendor and statement date.');
    const file = form.get('file');
    const text = file instanceof File && file.size ? (file.size > 2_000_000 ? null : await file.text()) : String(form.get('text') ?? '');
    if (text === null) return fail('That file is over 2 MB.');
    if (!text.trim()) return fail('Choose the statement CSV or paste its rows.');
    const { lines, errors } = parseStatementSheet(parseCsv(text));
    if (errors.length) return fail(`Nothing saved. ${errors.slice(0, 3).map((e) => `Line ${e.line}: ${e.message}`).join(' ')}${errors.length > 3 ? ` (+${errors.length - 3} more)` : ''}`);
    if (!lines.length) return fail('No lines with amounts were found.');
    const { data, error } = await (await getSupabase()).rpc('create_vendor_statement', { p_org: g.ctx.org.id, p_vendor: f.data.vendor_id, p_date: f.data.statement_date, p_lines: lines, p_note: f.data.note || null });
    if (error) throw error;
    id = String(data);
  } catch (e) { return failFrom(e); }
  revalidatePath('/app/bills/statements');
  redirect(`/app/bills/statements/${id}`);
}

/** Link a line to a bill, clear the link, or set the line aside. */
export async function setLine(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const g = await guard(); if ('error' in g) return g.error!;
    const line = z.string().uuid().safeParse(form.get('line_id'));
    if (!line.success) return fail('That line wasn’t found.');
    const bill = String(form.get('bill_id') ?? '');
    const { error } = await (await getSupabase()).rpc('set_statement_line', {
      p_org: g.ctx.org.id, p_line: line.data, p_bill: z.string().uuid().safeParse(bill).success ? bill : null, p_dismissed: form.get('dismissed') === 'true',
    });
    if (error) throw error;
    revalidatePath(`/app/bills/statements/${String(form.get('statement_id') ?? '')}`);
    return ok('Saved.');
  } catch (e) { return failFrom(e); }
}

/** Add bills for missing lines (one, or every missing line), coded to one account, then link them. */
export async function addMissingBills(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const g = await guard(); if ('error' in g) return g.error!;
    const f = z.object({ statement_id: z.string().uuid(), account_id: z.string().uuid({ message: 'Pick an account' }) }).safeParse(Object.fromEntries(form));
    if (!f.success) return fail('Pick the account these bills go to.', { account_id: 'Pick an account' });
    const lineIds = form.getAll('line_id').map(String).filter((x) => z.string().uuid().safeParse(x).success);
    if (!lineIds.length || lineIds.length > 200) return fail('No lines to add.');
    const supabase = await getSupabase();
    const { data: stmt } = await supabase.from('vendor_statements').select('vendor_id, statement_date').eq('organization_id', g.ctx.org.id).eq('id', f.data.statement_id).maybeSingle();
    if (!stmt) return fail('That statement wasn’t found.');
    const { data: lines } = await supabase.from('vendor_statement_lines').select('id, line_date, reference, description, amount_cents, bill_id, dismissed')
      .eq('organization_id', g.ctx.org.id).eq('statement_id', f.data.statement_id).in('id', lineIds);
    let added = 0;
    for (const l of lines ?? []) {
      if (l.bill_id || l.dismissed || Number(l.amount_cents) <= 0) continue;
      const date = (l.line_date as string | null) ?? (stmt.statement_date as string);
      const number = (l.reference as string | null) ?? `STMT-${date}-${String(l.id).slice(0, 6)}`;
      const { data: billId, error } = await supabase.rpc('create_bill', {
        p_org: g.ctx.org.id, p_vendor: stmt.vendor_id as string, p_bill_number: number, p_bill_date: date, p_due_date: null,
        p_lines: [{ account_id: f.data.account_id, amount_cents: Number(l.amount_cents), description: (l.description as string | null) ?? 'From vendor statement' }],
        p_memo: 'Added from a vendor statement', p_location_id: null,
      });
      if (error) { if (added) revalidatePath(`/app/bills/statements/${f.data.statement_id}`); return fail(`Added ${added}. Stopped at ${number}: ${friendlyError(error)}`); }
      const { error: e2 } = await supabase.rpc('set_statement_line', { p_org: g.ctx.org.id, p_line: l.id as string, p_bill: String(billId), p_dismissed: false });
      if (e2) throw e2;
      added++;
    }
    revalidatePath(`/app/bills/statements/${f.data.statement_id}`); revalidatePath('/app/bills');
    return ok(added ? `Added ${added} bill${added === 1 ? '' : 's'} as drafts to approve.` : 'Nothing to add.');
  } catch (e) { return failFrom(e); }
}

export async function deleteStatement(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const g = await guard(); if ('error' in g) return g.error!;
    const id = z.string().uuid().safeParse(form.get('id'));
    if (!id.success) return fail('That statement wasn’t found.');
    const { error } = await (await getSupabase()).rpc('delete_vendor_statement', { p_org: g.ctx.org.id, p_id: id.data });
    if (error) throw error;
  } catch (e) { return failFrom(e); }
  revalidatePath('/app/bills/statements');
  redirect('/app/bills/statements');
}
