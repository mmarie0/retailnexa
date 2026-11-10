'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { can, getOrgContext, getSupabase, type OrgContext } from '@/lib/auth/context';
import { fail, failFrom, ok, type ActionState } from '@/lib/actions';

async function guard(): Promise<OrgContext | ActionState> {
  const ctx = await getOrgContext();
  if (!can(ctx, 'accounting.post')) return fail('You don’t have permission to do that.');
  if (!ctx.access.canWrite) return fail('Your account is read-only right now. Check the billing page.');
  return ctx;
}
const isState = (v: unknown): v is ActionState => typeof v === 'object' && v !== null && 'ok' in v;
const uuid = z.string().uuid();
const done = (msg: string) => { revalidatePath('/app/bank'); return ok(msg); };

export async function importBankStatement(input: { filename: string; lines: unknown }): Promise<ActionState & { inserted?: number; duplicates?: number }> {
  try {
    const ctx = await guard();
    if (isState(ctx)) return ctx;
    const parsed = z.object({
      filename: z.string().max(200),
      lines: z.array(z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        description: z.string().trim().min(1).max(300),
        amountCents: z.number().int().refine((n) => n !== 0 && Math.abs(n) < 1e12),
        occurrence: z.number().int().min(1).max(1000),
      })).min(1, 'Nothing to import.').max(2000, 'Import at most 2,000 lines at a time.'),
    }).safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'The file could not be read.');
    const supabase = await getSupabase();
    const { data, error } = await supabase.rpc('import_bank_lines', {
      p_org: ctx.org.id, p_filename: parsed.data.filename,
      p_lines: parsed.data.lines.map((l) => ({ date: l.date, description: l.description, amount_cents: l.amountCents, occurrence: l.occurrence })),
    });
    if (error) throw error;
    const r = ((data ?? [])[0] ?? { inserted: 0, duplicates: 0 }) as { inserted: number; duplicates: number };
    revalidatePath('/app/bank');
    return { ...ok(`Imported ${r.inserted} line${r.inserted === 1 ? '' : 's'}${r.duplicates ? `; skipped ${r.duplicates} already imported` : ''}.`), inserted: r.inserted, duplicates: r.duplicates };
  } catch (e) {
    return failFrom(e);
  }
}

export async function matchBankLine(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await guard(); if (isState(ctx)) return ctx;
    const { error } = await (await getSupabase()).rpc('match_bank_line', { p_line: uuid.parse(form.get('line')), p_entry: uuid.parse(form.get('entry')) });
    if (error) throw error;
    return done('Matched.');
  } catch (e) { return failFrom(e); }
}

export async function categorizeBankLine(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await guard(); if (isState(ctx)) return ctx;
    const account = String(form.get('account') ?? '');
    if (!uuid.safeParse(account).success) return fail('Pick an account.');
    const memo = String(form.get('memo') ?? '').trim().slice(0, 300) || null;
    const { error } = await (await getSupabase()).rpc('categorize_bank_line', { p_line: uuid.parse(form.get('line')), p_account: account, p_memo: memo });
    if (error) throw error;
    return done('Posted to the books.');
  } catch (e) { return failFrom(e); }
}

export async function ignoreBankLine(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await guard(); if (isState(ctx)) return ctx;
    const reason = String(form.get('reason') ?? '').trim();
    if (reason.length < 3) return fail('Say why this line is ignored.');
    const { error } = await (await getSupabase()).rpc('ignore_bank_line', { p_line: uuid.parse(form.get('line')), p_reason: reason.slice(0, 300) });
    if (error) throw error;
    return done('Ignored.');
  } catch (e) { return failFrom(e); }
}

export async function unmatchBankLine(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await guard(); if (isState(ctx)) return ctx;
    const { error } = await (await getSupabase()).rpc('unmatch_bank_line', { p_line: uuid.parse(form.get('line')) });
    if (error) throw error;
    return done('Undone. The line is back in the to-do list.');
  } catch (e) { return failFrom(e); }
}
