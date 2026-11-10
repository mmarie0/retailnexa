'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { can, getOrgContext, getSupabase, type OrgContext } from '@/lib/auth/context';
import type { Permission } from '@/lib/auth/permissions';
import { fail, failFrom, ok, type ActionState } from '@/lib/actions';
import { parseDollarsToCents } from '@/lib/money';

const READ_ONLY = 'Your account is read-only right now, so changes can’t be saved. Check the billing page.';
const isState = (v: unknown): v is ActionState => typeof v === 'object' && v !== null && 'ok' in v;

async function guard(permission: Permission): Promise<OrgContext | ActionState> {
  const ctx = await getOrgContext();
  if (!can(ctx, permission)) return fail('You don’t have permission to do that.');
  if (!ctx.access.canWrite) return fail(READ_ONLY);
  return ctx;
}

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date');
const opt = (max: number) => z.string().trim().max(max).transform((v) => v || null);

// ---------------------------------------------------------------------------
// Vendors (direct table writes, guarded by RLS: vendors.manage)
// ---------------------------------------------------------------------------
const vendorSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name').max(120),
  contact_name: opt(120),
  email: z.string().trim().max(254).email('Enter a valid email').or(z.literal('')).transform((v) => v || null),
  phone: opt(40),
  payment_terms_days: z.coerce.number().int().min(0, '0–365 days').max(365, '0–365 days'),
  notes: opt(2000),
});

function fieldErrors(issues: z.core.$ZodIssue[]) {
  const out: Record<string, string> = {};
  for (const i of issues) out[String(i.path[0])] ??= i.message;
  return out;
}

export async function createVendor(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await guard('vendors.manage');
    if (isState(ctx)) return ctx;
    const parsed = vendorSchema.safeParse(Object.fromEntries(form));
    if (!parsed.success) return fail('Check the highlighted fields.', fieldErrors(parsed.error.issues));
    const supabase = await getSupabase();
    const { error } = await supabase.from('vendors').insert({ ...parsed.data, organization_id: ctx.org.id });
    if (error) {
      if (error.code === '23505') return fail('You already have a vendor with that name.', { name: 'Already in use' });
      throw error;
    }
    revalidatePath('/app/vendors');
    return ok(`Added ${parsed.data.name}.`);
  } catch (e) {
    return failFrom(e);
  }
}

export async function updateVendor(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await guard('vendors.manage');
    if (isState(ctx)) return ctx;
    const parsed = vendorSchema.extend({ id: uuid, is_active: z.enum(['true', 'false']).transform((v) => v === 'true') })
      .safeParse(Object.fromEntries(form));
    if (!parsed.success) return fail('Check the highlighted fields.', fieldErrors(parsed.error.issues));
    const { id, ...values } = parsed.data;
    const supabase = await getSupabase();
    const { error, count } = await supabase.from('vendors').update(values, { count: 'exact' })
      .eq('id', id).eq('organization_id', ctx.org.id);
    if (error) {
      if (error.code === '23505') return fail('You already have a vendor with that name.', { name: 'Already in use' });
      throw error;
    }
    if (!count) return fail('You don’t have permission to do that.');
    revalidatePath('/app/vendors');
    return ok('Saved.');
  } catch (e) {
    return failFrom(e);
  }
}

// ---------------------------------------------------------------------------
// Bills (RPC only)
// ---------------------------------------------------------------------------
export async function createBill(_p: ActionState, form: FormData): Promise<ActionState> {
  let id: string;
  try {
    const ctx = await guard('bills.create');
    if (isState(ctx)) return ctx;
    const head = z.object({
      vendor_id: uuid.or(z.literal('')).refine((v) => v !== '', 'Pick a vendor'),
      bill_number: z.string().trim().min(1, 'Enter the invoice number').max(60),
      bill_date: isoDate,
      due_date: isoDate.or(z.literal('')).transform((v) => v || null),
      memo: opt(500),
      location_id: uuid.or(z.literal('')).transform((v) => v || null),
    }).safeParse({
      vendor_id: form.get('vendor_id') ?? '', bill_number: form.get('bill_number') ?? '', bill_date: form.get('bill_date') ?? '',
      due_date: form.get('due_date') ?? '', memo: form.get('memo') ?? '', location_id: form.get('location_id') ?? '',
    });
    if (!head.success) return fail('Check the highlighted fields.', fieldErrors(head.error.issues));

    const accounts = form.getAll('line_account').map(String);
    const amounts = form.getAll('line_amount').map(String);
    const descriptions = form.getAll('line_description').map(String);
    const lines: { account_id: string; amount_cents: number; description: string | null }[] = [];
    for (let i = 0; i < accounts.length; i++) {
      const blank = !accounts[i] && !(amounts[i] ?? '').trim() && !(descriptions[i] ?? '').trim();
      if (blank) continue;
      const cents = parseDollarsToCents(amounts[i]);
      if (!uuid.safeParse(accounts[i]).success) return fail(`Line ${i + 1}: pick an account.`);
      if (!cents) return fail(`Line ${i + 1}: enter an amount like 125.00.`);
      lines.push({ account_id: accounts[i], amount_cents: cents, description: (descriptions[i] ?? '').trim().slice(0, 300) || null });
    }
    if (!lines.length) return fail('Add at least one line.');

    const supabase = await getSupabase();
    const { data, error } = await supabase.rpc('create_bill', {
      p_org: ctx.org.id, p_vendor: head.data.vendor_id, p_bill_number: head.data.bill_number,
      p_bill_date: head.data.bill_date, p_due_date: head.data.due_date, p_lines: lines,
      p_memo: head.data.memo, p_location_id: head.data.location_id,
    });
    if (error) {
      if (error.code === '23505') return fail('This vendor already has a bill with that number.', { bill_number: 'Already entered' });
      throw error;
    }
    id = data as string;
    revalidatePath('/app/bills');
  } catch (e) {
    return failFrom(e);
  }
  redirect(`/app/bills/${id}`);
}

export async function approveBill(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await guard('bills.approve');
    if (isState(ctx)) return ctx;
    const id = uuid.parse(form.get('id'));
    const supabase = await getSupabase();
    const { error } = await supabase.rpc('approve_bill', { p_bill: id });
    if (error) throw error;
    revalidatePath(`/app/bills/${id}`);
    revalidatePath('/app/bills');
    return ok('Approved and posted to the books.');
  } catch (e) {
    return failFrom(e);
  }
}

export async function recordBillPayment(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await guard('bills.pay');
    if (isState(ctx)) return ctx;
    const parsed = z.object({
      id: uuid,
      paid_on: isoDate,
      source: z.enum(['bank', 'cash_on_hand']),
      reference: opt(100),
      // Generated when the form renders, so a double-submit records one payment.
      idempotency_key: z.string().regex(/^[A-Za-z0-9-]{8,100}$/),
    }).safeParse(Object.fromEntries(form));
    if (!parsed.success) return fail('Check the highlighted fields.', fieldErrors(parsed.error.issues));
    const cents = parseDollarsToCents(String(form.get('amount') ?? ''));
    if (!cents) return fail('Enter an amount like 125.00.', { amount: 'Enter an amount' });
    const supabase = await getSupabase();
    const { error } = await supabase.rpc('record_bill_payment', {
      p_bill: parsed.data.id, p_paid_on: parsed.data.paid_on, p_amount_cents: cents, p_source: parsed.data.source,
      p_idempotency_key: `${ctx.org.id.slice(0, 8)}-${parsed.data.idempotency_key}`, p_reference: parsed.data.reference,
    });
    if (error) throw error;
    revalidatePath(`/app/bills/${parsed.data.id}`);
    revalidatePath('/app/bills');
    return ok('Payment recorded.');
  } catch (e) {
    return failFrom(e);
  }
}

export async function voidBill(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await guard('bills.approve');
    if (isState(ctx)) return ctx;
    const id = uuid.parse(form.get('id'));
    const reason = String(form.get('reason') ?? '').trim();
    if (reason.length < 3) return fail('Say why this bill is being voided.', { reason: 'Required' });
    const supabase = await getSupabase();
    const { error } = await supabase.rpc('void_bill', { p_bill: id, p_reason: reason.slice(0, 500) });
    if (error) throw error;
    revalidatePath(`/app/bills/${id}`);
    revalidatePath('/app/bills');
    return ok('Bill voided.');
  } catch (e) {
    return failFrom(e);
  }
}

export async function voidBillPayment(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await guard('bills.pay');
    if (isState(ctx)) return ctx;
    const payment = uuid.parse(form.get('payment'));
    const bill = uuid.parse(form.get('bill'));
    const reason = String(form.get('reason') ?? '').trim();
    if (reason.length < 3) return fail('Say why this payment is being voided.', { reason: 'Required' });
    const supabase = await getSupabase();
    const { error } = await supabase.rpc('void_bill_payment', { p_payment: payment, p_reason: reason.slice(0, 500) });
    if (error) throw error;
    revalidatePath(`/app/bills/${bill}`);
    revalidatePath('/app/bills');
    return ok('Payment voided. The bill is open again for that amount.');
  } catch (e) {
    return failFrom(e);
  }
}
