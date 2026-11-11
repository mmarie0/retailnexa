'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { can, getOrgContext, getSupabase } from '@/lib/auth/context';
import { fail, failFrom, ok, type ActionState } from '@/lib/actions';
import { parseAmount } from '@/lib/sales/import';
import { parseCsv } from '@/lib/sales/csv';
import { todayIn } from '@/lib/time';
import { parseProfitSheet } from '@/lib/profit/partners';
import { parseDollarsToCents } from '@/lib/money';

const READ_ONLY = 'Your account is read-only right now, so changes can’t be saved. Check the billing page.';
/** Partners, distributions and manual profit: owners and admins (org.manage + profit.view). The database checks again. */
async function guard() {
  const ctx = await getOrgContext();
  if (!can(ctx, 'org.manage') || !can(ctx, 'profit.view')) return { error: fail('Only owners and admins can change this.') } as const;
  if (!ctx.access.canWrite) return { error: fail(READ_ONLY) } as const;
  return { ctx } as const;
}
const done = () => { revalidatePath('/app/profit', 'layout'); revalidatePath('/app'); };

/** Set or clear one month's manual profit (blank profit = use the formula again). */
export async function saveProfitMonth(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const g = await guard(); if ('error' in g) return g.error!;
    const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).safeParse(form.get('month'));
    if (!month.success) return fail('Pick a month.', { month: 'Pick a month' });
    const raw = String(form.get('profit') ?? '').trim();
    const cents = raw === '' ? null : parseAmount(raw);
    if (raw !== '' && cents === null) return fail('Profit looks like 1234.56 or -500.', { profit: 'Enter an amount' });
    const { error } = await (await getSupabase()).rpc('save_profit_months', { p_org: g.ctx.org.id, p: [{ month: `${month.data}-01`, profit_cents: cents, note: String(form.get('note') ?? '').slice(0, 300) }] });
    if (error) throw error;
    done();
    return ok(cents === null ? 'Back to the formula for that month.' : 'Saved.');
  } catch (e) { return failFrom(e); }
}

/** Bulk profit import: paste or upload a sheet with Month and Profit columns. */
export async function importProfit(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const g = await guard(); if ('error' in g) return g.error!;
    const file = form.get('file');
    const text = file instanceof File && file.size ? (file.size > 1_000_000 ? null : await file.text()) : String(form.get('text') ?? '');
    if (text === null) return fail('That file is over 1 MB.');
    if (!text.trim()) return fail('Paste the sheet or choose a CSV file.');
    const supabase = await getSupabase();
    const { data: tz } = await supabase.from('organizations').select('timezone').eq('id', g.ctx.org.id).maybeSingle();
    const { rows, errors } = parseProfitSheet(parseCsv(text), todayIn(tz?.timezone));
    if (errors.length) return fail(`Nothing saved. ${errors.slice(0, 3).map((e) => `Line ${e.line}: ${e.message}`).join(' ')}${errors.length > 3 ? ` (+${errors.length - 3} more)` : ''}`);
    if (!rows.length) return fail('No months found.');
    if (rows.length > 120) return fail('Up to 120 months at a time.');
    const { error } = await supabase.rpc('save_profit_months', { p_org: g.ctx.org.id, p: rows });
    if (error) throw error;
    done();
    return ok(`Saved ${rows.length} month${rows.length === 1 ? '' : 's'}.`);
  } catch (e) { return failFrom(e); }
}

/** Replace the partner list. Rows come as name-N / pct-N / active-N / id-N. */
export async function savePartners(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const g = await guard(); if ('error' in g) return g.error!;
    const rows: { id: string | null; name: string; pct: number; active: boolean }[] = [];
    for (let i = 0; i < 30; i++) {
      const name = String(form.get(`name-${i}`) ?? '').trim();
      if (!name) continue;
      const pct = Number(String(form.get(`pct-${i}`) ?? '').replace('%', '').trim());
      if (!Number.isFinite(pct) || pct < 0 || pct > 100 || Math.round(pct * 100) !== pct * 100) return fail(`${name}: share is 0 to 100 percent, two decimals at most.`);
      const id = String(form.get(`id-${i}`) ?? '');
      rows.push({ id: z.string().uuid().safeParse(id).success ? id : null, name: name.slice(0, 80), pct, active: form.get(`active-${i}`) === 'on' });
    }
    const total = rows.filter((r) => r.active).reduce((a, r) => a + Math.round(r.pct * 100), 0);
    if (rows.some((r) => r.active) && total !== 10000) return fail(`Active partners add up to ${(total / 100).toFixed(2)}%. They need to add up to 100%.`);
    const { error } = await (await getSupabase()).rpc('save_partners', { p_org: g.ctx.org.id, p: rows });
    if (error) throw error;
    done();
    return ok('Partners saved.');
  } catch (e) { return failFrom(e); }
}

export async function addDistribution(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const g = await guard(); if ('error' in g) return g.error!;
    const f = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), dist_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), total: z.string(), note: z.string().max(300).default('') }).safeParse(Object.fromEntries(form));
    if (!f.success) return fail('Pick the month and date.');
    const cents = parseDollarsToCents(f.data.total);
    if (!cents || cents <= 0) return fail('Enter the amount to distribute.', { total: 'Over zero' });
    const { error } = await (await getSupabase()).rpc('create_distribution', { p_org: g.ctx.org.id, p_month: `${f.data.month}-01`, p_dist_date: f.data.dist_date, p_total_cents: cents, p_note: f.data.note || null });
    if (error) throw error;
    done();
    return ok('Distribution recorded and split.');
  } catch (e) { return failFrom(e); }
}

export async function payShare(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const g = await guard(); if ('error' in g) return g.error!;
    const f = z.object({ share_id: z.string().uuid(), paid_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), method: z.enum(['check', 'ach', 'cash', 'zelle', 'other']), reference: z.string().max(100).default(''), amount: z.string() })
      .safeParse(Object.fromEntries(form));
    if (!f.success) return fail('Pick a date and how it was paid.');
    const cents = parseDollarsToCents(f.data.amount);
    if (!cents || cents <= 0) return fail('Enter an amount over zero.');
    const { error } = await (await getSupabase()).rpc('add_distribution_payment', { p_org: g.ctx.org.id, p_share: f.data.share_id, p_paid_on: f.data.paid_on, p_amount_cents: cents, p_method: f.data.method, p_reference: f.data.reference || null });
    if (error) throw error;
    done();
    return ok('Payment recorded.');
  } catch (e) { return failFrom(e); }
}

export async function removeDistributionItem(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const g = await guard(); if ('error' in g) return g.error!;
    const id = z.string().uuid().safeParse(form.get('id'));
    if (!id.success) return fail('That item wasn’t found.');
    const supabase = await getSupabase();
    const { error } = form.get('kind') === 'payment'
      ? await supabase.rpc('delete_distribution_payment', { p_org: g.ctx.org.id, p_payment: id.data })
      : await supabase.rpc('delete_distribution', { p_org: g.ctx.org.id, p_id: id.data });
    if (error) throw error;
    done();
    return ok('Removed.');
  } catch (e) { return failFrom(e); }
}
