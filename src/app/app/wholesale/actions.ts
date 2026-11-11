'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { can, getOrgContext, getSupabase, type OrgContext } from '@/lib/auth/context';
import type { Permission } from '@/lib/auth/permissions';
import { fail, failFrom, ok, type ActionState } from '@/lib/actions';
import { parseDollarsToCents } from '@/lib/money';
import { ADJUST_REASONS } from '@/lib/wholesale/ledger';

const READ_ONLY = 'Your account is read-only right now, so changes can’t be saved. Check the billing page.';
const NOT_WS = 'Wholesale features are for Wholesale accounts.';
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const optDate = date.or(z.literal('')).default('').transform((v) => v || null);
const uuid = z.string().uuid();
const optUuid = uuid.or(z.literal('')).default('').transform((v) => v || null);
const text = (max: number) => z.string().max(max).default('');
const done = () => { revalidatePath('/app/wholesale', 'layout'); revalidatePath('/app'); };

type Ctx = OrgContext;
async function guard(perm: Permission): Promise<Ctx | ActionState> {
  const ctx = await getOrgContext();
  if (ctx.org.businessType === 'retail') return fail(NOT_WS);
  if (!can(ctx, perm)) return fail('You don’t have permission to do that.');
  if (!ctx.access.canWrite) return fail(READ_ONLY);
  return ctx;
}
const isState = (x: Ctx | ActionState): x is ActionState => 'ok' in x;

/** Optional money field: '' → null, bad → undefined (an error). */
function money(v: FormDataEntryValue | null): number | null | undefined {
  const s = String(v ?? '').trim();
  if (!s) return null;
  return parseDollarsToCents(s) ?? undefined;
}
const fields = (form: FormData) => Object.fromEntries([...form.keys()].map((k) => [k, form.getAll(k).at(-1)]));

// ---------------------------------------------------------------- settings
export async function saveSettings(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await guard('wholesale.catalog.manage'); if (isState(ctx)) return ctx;
    const f = z.object({
      default_terms: z.coerce.number().int().min(0).max(365), tax_rate: z.coerce.number().min(0).max(30), markup: z.coerce.number().min(0).max(1000),
      inv_prefix: text(10), next_inv: z.coerce.number().int().min(1).max(999999999), so_prefix: text(10), next_so: z.coerce.number().int().min(1).max(999999999),
      pay_instructions: text(500),
    }).safeParse(fields(form));
    if (!f.success) return fail('Check the highlighted fields.', Object.fromEntries(f.error.issues.map((i) => [String(i.path[0]), 'Check this value'])));
    const { error } = await (await getSupabase()).rpc('save_wholesale_settings', { p_org: ctx.org.id, p: f.data });
    if (error) throw error;
    done();
    return ok('Saved.');
  } catch (e) { return failFrom(e); }
}

export async function saveTiers(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await guard('wholesale.catalog.manage'); if (isState(ctx)) return ctx;
    const ids = form.getAll('tier_id').map(String), names = form.getAll('tier_name').map(String), pcts = form.getAll('tier_pct').map(String);
    const tiers = names.map((n, i) => ({ id: ids[i] || null, name: n.trim(), pct: Number(pcts[i] || 0) })).filter((t) => t.name);
    if (!tiers.length) return fail('Keep at least one price tier.');
    if (tiers.some((t) => !Number.isFinite(t.pct) || t.pct < 0 || t.pct > 90)) return fail('Each discount is 0 to 90 percent.');
    const { error } = await (await getSupabase()).rpc('save_price_tiers', { p_org: ctx.org.id, p: tiers });
    if (error) throw error;
    done();
    return ok('Price tiers saved.');
  } catch (e) { return failFrom(e); }
}

// ---------------------------------------------------------------- customers
export async function saveCustomer(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await guard('wholesale.customers.manage'); if (isState(ctx)) return ctx;
    const f = z.object({
      id: optUuid, name: z.string().trim().min(1, 'Enter the business name').max(120), contact: text(80), email: z.string().trim().max(200).email('Check the email').or(z.literal('')).default(''),
      phone: text(40), address: text(300), ship_address: text(300), terms: z.coerce.number().int().min(0).max(365), tier_id: optUuid,
      resale_cert: text(60), cert_expiry: optDate, notes: text(1000),
    }).safeParse(fields(form));
    if (!f.success) return fail('Check the highlighted fields.', Object.fromEntries(f.error.issues.map((i) => [String(i.path[0]), i.message])));
    const limit = money(form.get('credit_limit'));
    if (limit === undefined) return fail('Credit limit looks like 5000.00.', { credit_limit: 'Enter an amount' });
    const { id, ...v } = f.data;
    const flag = (k: string) => form.getAll(k).includes('true');
    const { data, error } = await (await getSupabase()).rpc('save_customer', {
      p_org: ctx.org.id, p_id: id,
      p: { ...v, credit_limit_cents: limit, tax_exempt: flag('tax_exempt'), auto_email: flag('auto_email'), on_hold: flag('on_hold'), active: form.get('active') === null ? true : flag('active') },
    });
    if (error) throw error;
    done();
    if (!id && form.get('then') === 'open') redirect(`/app/wholesale/customers/${data as string}`);
    return ok(id ? 'Saved.' : `Added ${v.name}.`);
  } catch (e) { return failFrom(e); }
}

export async function deleteCustomer(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await guard('wholesale.customers.manage'); if (isState(ctx)) return ctx;
    const id = uuid.safeParse(form.get('id'));
    if (!id.success) return fail('That customer wasn’t found.');
    const { data, error } = await (await getSupabase()).rpc('delete_customer', { p_org: ctx.org.id, p_id: id.data });
    if (error) throw error;
    done();
    if (data === 'deleted') redirect('/app/wholesale/customers');
    return ok('This customer has orders or invoices, so they were made inactive instead.');
  } catch (e) { return failFrom(e); }
}

// ---------------------------------------------------------------- items
export async function saveItem(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await guard('wholesale.catalog.manage'); if (isState(ctx)) return ctx;
    const f = z.object({
      id: optUuid, name: z.string().trim().min(1, 'Enter the item name').max(160), sku: text(60), upc: text(40), brand: text(60), category: text(60),
      vendor: text(120), bin: text(30), unit: text(20),
      case_pack: z.coerce.number().int().min(1).max(100000).or(z.literal('')).default(''),
      reorder_at: z.coerce.number().min(0).max(100000000).or(z.literal('')).default(''),
      reorder_qty: z.coerce.number().min(0).max(100000000).or(z.literal('')).default(''),
      qty: z.coerce.number().min(0).max(100000000).or(z.literal('')).default(''),
    }).safeParse(fields(form));
    if (!f.success) return fail('Check the highlighted fields.', Object.fromEntries(f.error.issues.map((i) => [String(i.path[0]), i.message])));
    const cost = money(form.get('cost')), price = money(form.get('price'));
    if (cost === undefined) return fail('Cost looks like 2.50.', { cost: 'Enter an amount' });
    if (price === undefined) return fail('Price looks like 4.50.', { price: 'Enter an amount' });
    const { id, ...v } = f.data;
    const blank = (x: number | '') => (x === '' ? null : x);
    const { error } = await (await getSupabase()).rpc('save_item', {
      p_org: ctx.org.id, p_id: id,
      p: { ...v, case_pack: blank(v.case_pack), reorder_at: blank(v.reorder_at), reorder_qty: blank(v.reorder_qty), qty: blank(v.qty), cost_cents: cost ?? 0, price_cents: price ?? 0,
           active: form.get('active') === null ? true : form.getAll('active').includes('true') },
    });
    if (error) throw error;
    done();
    return ok(id ? 'Saved.' : `Added ${v.name}.`);
  } catch (e) { return failFrom(e); }
}

export async function adjustStock(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await guard('inventory.manage'); if (isState(ctx)) return ctx;
    const f = z.object({ item_id: uuid, qty: z.coerce.number().refine((n) => n !== 0 && Math.abs(n) <= 100000000, 'Enter how many'), reason: z.enum(ADJUST_REASONS) }).safeParse(fields(form));
    if (!f.success) return fail('Enter how many to add (use a minus to remove) and pick a reason.');
    const { data, error } = await (await getSupabase()).rpc('adjust_stock', { p_org: ctx.org.id, p_item: f.data.item_id, p_qty: f.data.qty, p_reason: f.data.reason });
    if (error) throw error;
    done();
    return ok(`Updated. On hand is now ${Number(data)}.`);
  } catch (e) { return failFrom(e); }
}

export async function deleteItem(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await guard('wholesale.catalog.manage'); if (isState(ctx)) return ctx;
    const id = uuid.safeParse(form.get('id'));
    if (!id.success) return fail('That item wasn’t found.');
    const { data, error } = await (await getSupabase()).rpc('delete_item', { p_org: ctx.org.id, p_id: id.data });
    if (error) throw error;
    done();
    return ok(data === 'deleted' ? 'Deleted.' : 'This item is on orders or invoices, so it was made inactive instead.');
  } catch (e) { return failFrom(e); }
}

// ---------------------------------------------------------------- orders
const lineSchema = z.object({
  item_id: uuid.nullable().optional(), name: z.string().max(160).optional(), sku: z.string().max(60).optional(),
  qty: z.number().positive().max(100000000), price_cents: z.number().int().min(0).max(10000000000), cost_cents: z.number().int().min(0).max(10000000000).optional(),
});
const linesFrom = (raw: FormDataEntryValue | null) => {
  try { return z.array(lineSchema).min(1).max(300).safeParse(JSON.parse(String(raw ?? '[]'))); } catch { return { success: false as const }; }
};

/** Save a quote or sales order from the order screen (lines come as JSON from the cart). */
export async function saveOrder(_p: ActionState, form: FormData): Promise<ActionState> {
  let id: string | null = null;
  try {
    const ctx = await guard('wholesale.orders.create'); if (isState(ctx)) return ctx;
    const f = z.object({
      id: optUuid, kind: z.enum(['quote', 'order']).default('order'), customer_id: uuid, order_date: optDate, need_by: optDate, valid_until: optDate,
      customer_po: text(60), notes: text(1000), tax_rate: z.coerce.number().min(0).max(30).or(z.literal('')).default(''),
    }).safeParse(fields(form));
    if (!f.success) return fail(f.error.issues.some((i) => i.path[0] === 'customer_id') ? 'Choose the customer.' : 'Check the order details.');
    const lines = linesFrom(form.get('lines'));
    if (!lines.success) return fail('Add at least one item with a quantity.');
    const disc = money(form.get('discount')), ship = money(form.get('shipping'));
    if (disc === undefined || ship === undefined) return fail('Discount and shipping look like 10.00.');
    const { id: existing, tax_rate, ...v } = f.data;
    const { data, error } = await (await getSupabase()).rpc('save_sales_order', {
      p_org: ctx.org.id, p_id: existing,
      p: { ...v, tax_rate: tax_rate === '' ? null : tax_rate, discount_cents: disc ?? 0, shipping_cents: ship ?? 0, lines: lines.data },
    });
    if (error) throw error;
    id = data as string;
    done();
  } catch (e) { return failFrom(e); }
  redirect(`/app/wholesale/orders/${id}`);
}

export async function setOrderStatus(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await guard('wholesale.orders.create'); if (isState(ctx)) return ctx;
    const f = z.object({ id: uuid, status: z.enum(['order', 'picking', 'ready', 'cancelled']) }).safeParse(fields(form));
    if (!f.success) return fail('That change isn’t allowed.');
    const { error } = await (await getSupabase()).rpc('set_order_status', { p_org: ctx.org.id, p_id: f.data.id, p_status: f.data.status });
    if (error) throw error;
    done();
    return ok({ order: 'Now a sales order.', picking: 'Picking started.', ready: 'Marked ready to ship.', cancelled: 'Cancelled.' }[f.data.status]);
  } catch (e) { return failFrom(e); }
}

export async function setPicked(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await guard('wholesale.orders.create'); if (isState(ctx)) return ctx;
    const id = uuid.safeParse(form.get('line_id'));
    if (!id.success) return fail('That line wasn’t found.');
    const { error } = await (await getSupabase()).rpc('set_line_picked', { p_org: ctx.org.id, p_line: id.data, p_picked: form.get('picked') === 'true' });
    if (error) throw error;
    done();
    return ok('Saved.');
  } catch (e) { return failFrom(e); }
}

// ---------------------------------------------------------------- invoices
export async function invoiceOrder(_p: ActionState, form: FormData): Promise<ActionState> {
  let id: string | null = null;
  try {
    const ctx = await guard('wholesale.receivables.manage'); if (isState(ctx)) return ctx;
    const f = z.object({ order_id: uuid, invoice_date: optDate }).safeParse(fields(form));
    if (!f.success) return fail('Pick the invoice date.');
    const { data, error } = await (await getSupabase()).rpc('invoice_order', { p_org: ctx.org.id, p_order: f.data.order_id, p_date: f.data.invoice_date });
    if (error) throw error;
    id = data as string;
    done();
  } catch (e) { return failFrom(e); }
  redirect(`/app/wholesale/invoices/${id}`);
}

export async function createInvoice(_p: ActionState, form: FormData): Promise<ActionState> {
  let id: string | null = null;
  try {
    const ctx = await guard('wholesale.receivables.manage'); if (isState(ctx)) return ctx;
    const f = z.object({
      customer_id: uuid, invoice_date: optDate, terms: z.coerce.number().int().min(0).max(365).or(z.literal('')).default(''), customer_po: text(60), notes: text(1000),
      tax_rate: z.coerce.number().min(0).max(30).or(z.literal('')).default(''),
    }).safeParse(fields(form));
    if (!f.success) return fail(f.error.issues.some((i) => i.path[0] === 'customer_id') ? 'Choose the customer.' : 'Check the invoice details.');
    const lines = linesFrom(form.get('lines'));
    if (!lines.success) return fail('Add at least one line with a quantity.');
    const disc = money(form.get('discount')), ship = money(form.get('shipping'));
    if (disc === undefined || ship === undefined) return fail('Discount and shipping look like 10.00.');
    const v = f.data;
    const { data, error } = await (await getSupabase()).rpc('create_customer_invoice', {
      p_org: ctx.org.id,
      p: { ...v, terms: v.terms === '' ? null : v.terms, tax_rate: v.tax_rate === '' ? null : v.tax_rate, discount_cents: disc ?? 0, shipping_cents: ship ?? 0, lines: lines.data },
    });
    if (error) throw error;
    id = data as string;
    done();
  } catch (e) { return failFrom(e); }
  redirect(`/app/wholesale/invoices/${id}`);
}

export async function voidInvoice(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await guard('wholesale.receivables.manage'); if (isState(ctx)) return ctx;
    const id = uuid.safeParse(form.get('id'));
    if (!id.success) return fail('That invoice wasn’t found.');
    const { error } = await (await getSupabase()).rpc('void_customer_invoice', { p_org: ctx.org.id, p_id: id.data, p_reason: String(form.get('reason') ?? '').slice(0, 200) || null });
    if (error) throw error;
    done();
    return ok('Voided. The stock is back on hand and its order is open again.');
  } catch (e) { return failFrom(e); }
}

// ---------------------------------------------------------------- payments
export async function recordPayment(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await guard('wholesale.receivables.manage'); if (isState(ctx)) return ctx;
    const f = z.object({ invoice_id: uuid, paid_on: date, method: z.enum(['check', 'cash', 'ach', 'zelle', 'card', 'other']), check_no: text(30), bank: text(60), deposit_date: optDate }).safeParse(fields(form));
    if (!f.success) return fail('Enter the date and how they paid.');
    const amount = money(form.get('amount'));
    if (!amount) return fail('Amount looks like 250.00.', { amount: 'Enter an amount' });
    const v = f.data;
    const { error } = await (await getSupabase()).rpc('record_customer_payment', {
      p_org: ctx.org.id, p_invoice: v.invoice_id, p_paid_on: v.paid_on, p_amount_cents: amount, p_method: v.method, p_check_no: v.check_no || null, p_bank: v.bank || null, p_deposit_date: v.deposit_date,
    });
    if (error) throw error;
    done();
    return ok('Payment recorded.');
  } catch (e) { return failFrom(e); }
}

export async function deletePayment(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await guard('wholesale.receivables.manage'); if (isState(ctx)) return ctx;
    const id = uuid.safeParse(form.get('id'));
    if (!id.success) return fail('That payment wasn’t found.');
    const { error } = await (await getSupabase()).rpc('delete_customer_payment', { p_org: ctx.org.id, p_id: id.data });
    if (error) throw error;
    done();
    return ok('Payment removed.');
  } catch (e) { return failFrom(e); }
}

export async function markDeposited(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await guard('wholesale.receivables.manage'); if (isState(ctx)) return ctx;
    const ids = form.getAll('payment_id').map(String).filter((s) => uuid.safeParse(s).success);
    const d = date.safeParse(form.get('deposit_date'));
    if (!ids.length) return fail('Tick the checks and cash you took to the bank.');
    if (!d.success) return fail('Pick the deposit date.');
    const { data, error } = await (await getSupabase()).rpc('mark_payments_deposited', { p_org: ctx.org.id, p_ids: ids, p_date: d.data });
    if (error) throw error;
    done();
    return ok(`${Number(data)} payment${Number(data) === 1 ? '' : 's'} marked deposited.`);
  } catch (e) { return failFrom(e); }
}

/** Payment plan: the browser sends the dated payments (split evenly or typed in). */
export async function addPlan(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await guard('wholesale.receivables.manage'); if (isState(ctx)) return ctx;
    const cust = uuid.safeParse(form.get('customer_id'));
    if (!cust.success) return fail('Choose the customer.');
    const dates = form.getAll('due_date').map(String), amounts = form.getAll('amount').map(String), checks = form.getAll('check_no').map(String);
    const method = z.enum(['check', 'cash', 'ach', 'zelle', 'card', 'other']).catch('check').parse(form.get('method'));
    const rows = [];
    for (let i = 0; i < dates.length; i++) {
      if (!dates[i] && !amounts[i]) continue;
      const cents = parseDollarsToCents(amounts[i]);
      if (!date.safeParse(dates[i]).success || !cents) return fail(`Payment ${i + 1} needs a date and an amount.`);
      rows.push({ due_date: dates[i], amount_cents: cents, method, check_no: checks[i] || null, bank: String(form.get('bank') ?? '') || null, note: String(form.get('note') ?? '').slice(0, 200) || null });
    }
    if (!rows.length) return fail('Add at least one payment.');
    const { error } = await (await getSupabase()).rpc('add_expected_payments', { p_org: ctx.org.id, p_customer: cust.data, p: rows });
    if (error) throw error;
    done();
    return ok(`Added ${rows.length} expected payment${rows.length === 1 ? '' : 's'}.`);
  } catch (e) { return failFrom(e); }
}

export async function cancelExpected(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await guard('wholesale.receivables.manage'); if (isState(ctx)) return ctx;
    const id = uuid.safeParse(form.get('id'));
    if (!id.success) return fail('That payment wasn’t found.');
    const { error } = await (await getSupabase()).rpc('cancel_expected_payment', { p_org: ctx.org.id, p_id: id.data });
    if (error) throw error;
    done();
    return ok('Removed from the schedule.');
  } catch (e) { return failFrom(e); }
}

export async function receiveExpected(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await guard('wholesale.receivables.manage'); if (isState(ctx)) return ctx;
    const f = z.object({ id: uuid, received_on: date, method: z.enum(['check', 'cash', 'ach', 'zelle', 'card', 'other']).or(z.literal('')).default(''), check_no: text(30), deposit_date: optDate }).safeParse(fields(form));
    if (!f.success) return fail('Enter the day it came in.');
    const amount = money(form.get('amount'));
    if (amount === undefined || amount === 0) return fail('Amount looks like 250.00.', { amount: 'Enter an amount' });
    const v = f.data;
    const { data, error } = await (await getSupabase()).rpc('receive_expected_payment', {
      p_org: ctx.org.id, p_id: v.id, p_received_on: v.received_on, p_amount_cents: amount, p_method: v.method || null, p_check_no: v.check_no || null, p_deposit_date: v.deposit_date,
    });
    if (error) throw error;
    done();
    return ok(`Received and applied to ${Number(data)} invoice${Number(data) === 1 ? '' : 's'}, oldest first.`);
  } catch (e) { return failFrom(e); }
}
