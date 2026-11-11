import { notFound } from 'next/navigation';
import { getOrgContext, getSupabase, type OrgContext } from '@/lib/auth/context';
import { pageAll } from '@/lib/page-all';
import { todayIn } from '@/lib/time';
import type { InvoiceRow, PaymentRow } from '@/lib/wholesale/ledger';

/** Wholesale pages are for Wholesale and Both accounts; a Retail account gets a 404. */
export async function wsContext(): Promise<OrgContext & { today: string }> {
  const ctx = await getOrgContext();
  if (ctx.org.businessType === 'retail') notFound();
  const { data } = await (await getSupabase()).from('organizations').select('timezone').eq('id', ctx.org.id).maybeSingle();
  return { ...ctx, today: todayIn(data?.timezone) };
}

export interface Tier { id: string; name: string; pct: number; sort: number }
export interface Customer {
  id: string; name: string; contact: string | null; email: string | null; phone: string | null; address: string | null; ship_address: string | null;
  terms: number; tier_id: string | null; credit_limit_cents: number | null; tax_exempt: boolean; resale_cert: string | null; cert_expiry: string | null;
  auto_email: boolean; on_hold: boolean; notes: string | null; is_active: boolean;
}
export interface Item {
  id: string; name: string; sku: string | null; upc: string | null; brand: string | null; category: string | null; vendor: string | null; bin: string | null;
  unit: string | null; cost_cents: number; price_cents: number; case_pack: number | null; reorder_at: number | null; reorder_qty: number | null; qty: number; is_active: boolean;
}
export interface Settings { default_terms: number; tax_rate: number; inv_prefix: string; next_inv: number; so_prefix: string; next_so: number; markup: number; pay_instructions: string | null }
export interface Order {
  id: string; kind: 'quote' | 'order'; number: string; customer_id: string; order_date: string; need_by: string | null; valid_until: string | null; customer_po: string | null;
  status: string; discount_cents: number; shipping_cents: number; tax_rate: number; subtotal_cents: number; cost_cents: number; tax_cents: number; total_cents: number;
  notes: string | null; invoice_id: string | null;
}
export interface Invoice extends InvoiceRow { order_id: string | null; terms: number; customer_po: string | null; shipping_cents: number; tax_rate: number; tax_cents: number; notes: string | null; void_reason: string | null }
export interface ExpectedPayment { id: string; customer_id: string; due_date: string; amount_cents: number; method: string; check_no: string | null; bank: string | null; note: string | null; status: string; received_on: string | null }

export const DEFAULT_SETTINGS: Settings = { default_terms: 30, tax_rate: 0, inv_prefix: 'INV-', next_inv: 1001, so_prefix: 'SO-', next_so: 1, markup: 40, pay_instructions: null };

const CUSTOMER_COLS = 'id, name, contact, email, phone, address, ship_address, terms, tier_id, credit_limit_cents, tax_exempt, resale_cert, cert_expiry, auto_email, on_hold, notes, is_active';
const ITEM_COLS = 'id, name, sku, upc, brand, category, vendor, bin, unit, cost_cents, price_cents, case_pack, reorder_at, reorder_qty, qty, is_active';
const ORDER_COLS = 'id, kind, number, customer_id, order_date, need_by, valid_until, customer_po, status, discount_cents, shipping_cents, tax_rate, subtotal_cents, cost_cents, tax_cents, total_cents, notes, invoice_id';
const INVOICE_COLS = 'id, number, customer_id, order_id, invoice_date, terms, due_date, customer_po, discount_cents, shipping_cents, tax_rate, subtotal_cents, cost_cents, tax_cents, total_cents, notes, voided_at, void_reason';
const PAYMENT_COLS = 'id, invoice_id, paid_on, amount_cents, method, check_no, bank, deposit_date, expected_payment_id';

const num = <T extends object>(rows: T[], keys: (keyof T)[]) => rows.map((r) => { const o = { ...r }; for (const k of keys) if (o[k] != null) (o[k] as unknown) = Number(o[k]); return o; });

export async function loadSettings(org: string): Promise<Settings> {
  const { data } = await (await getSupabase()).from('wholesale_settings').select('default_terms, tax_rate, inv_prefix, next_inv, so_prefix, next_so, markup, pay_instructions').eq('organization_id', org).maybeSingle();
  return data ? { ...(data as Settings), tax_rate: Number(data.tax_rate), markup: Number(data.markup) } : DEFAULT_SETTINGS;
}

export async function loadTiers(org: string): Promise<Tier[]> {
  const { data, error } = await (await getSupabase()).from('price_tiers').select('id, name, pct, sort').eq('organization_id', org).order('sort');
  if (error) throw error;
  return num((data ?? []) as Tier[], ['pct']);
}

export async function loadCustomers(org: string) {
  const sb = await getSupabase();
  const rows = await pageAll<Customer>((a, b) => sb.from('customers').select(CUSTOMER_COLS).eq('organization_id', org).order('name').order('id').range(a, b));
  return Object.assign(num(rows, ['credit_limit_cents']), { truncated: rows.truncated });
}

export async function loadItems(org: string) {
  const sb = await getSupabase();
  const rows = await pageAll<Item>((a, b) => sb.from('items').select(ITEM_COLS).eq('organization_id', org).order('name').order('id').range(a, b));
  return Object.assign(num(rows, ['cost_cents', 'price_cents', 'qty', 'reorder_at', 'reorder_qty']), { truncated: rows.truncated });
}

export async function loadOrders(org: string, opts: { open?: boolean } = {}) {
  const sb = await getSupabase();
  const rows = await pageAll<Order>((a, b) => {
    let q = sb.from('sales_orders').select(ORDER_COLS).eq('organization_id', org);
    if (opts.open) q = q.in('status', ['open', 'picking', 'ready']);
    return q.order('order_date', { ascending: false }).order('id').range(a, b);
  });
  return Object.assign(num(rows, ['discount_cents', 'shipping_cents', 'tax_rate', 'subtotal_cents', 'cost_cents', 'tax_cents', 'total_cents']), { truncated: rows.truncated });
}

/** Lines of open (not invoiced or cancelled) orders: the stock they hold. */
export async function loadOpenLines(org: string) {
  const sb = await getSupabase();
  const rows = await pageAll<{ item_id: string | null; qty: number; order_id: string; picked: boolean }>((a, b) =>
    sb.from('sales_order_lines').select('item_id, qty, order_id, picked, sales_orders!inner(status, kind)').eq('organization_id', org)
      .in('sales_orders.status', ['open', 'picking', 'ready']).eq('sales_orders.kind', 'order').order('id').range(a, b));
  return Object.assign(rows.map((r) => ({ item_id: r.item_id, qty: Number(r.qty), order_id: r.order_id, picked: r.picked })), { truncated: rows.truncated });
}

export async function loadReceivables(org: string) {
  const sb = await getSupabase();
  const [inv, pay] = await Promise.all([
    pageAll<Invoice>((a, b) => sb.from('customer_invoices').select(INVOICE_COLS).eq('organization_id', org).order('invoice_date', { ascending: false }).order('id').range(a, b)),
    pageAll<PaymentRow>((a, b) => sb.from('customer_payments').select(PAYMENT_COLS).eq('organization_id', org).order('paid_on', { ascending: false }).order('id').range(a, b)),
  ]);
  return {
    invoices: num(inv, ['discount_cents', 'shipping_cents', 'tax_rate', 'subtotal_cents', 'cost_cents', 'tax_cents', 'total_cents']),
    payments: num(pay, ['amount_cents']),
    truncated: inv.truncated || pay.truncated,
  };
}

export async function loadExpected(org: string) {
  const sb = await getSupabase();
  const rows = await pageAll<ExpectedPayment>((a, b) => sb.from('expected_payments').select('id, customer_id, due_date, amount_cents, method, check_no, bank, note, status, received_on').eq('organization_id', org).order('due_date').order('id').range(a, b));
  return Object.assign(num(rows, ['amount_cents']), { truncated: rows.truncated });
}
