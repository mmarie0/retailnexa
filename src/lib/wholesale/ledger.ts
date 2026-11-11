/**
 * Wholesale ledger rules, from the owner's Wholesale Ledger app: invoice status
 * and aging, customer balances and warnings, stock held by open orders,
 * reorder suggestions in case packs, tier prices and order totals. Pure, so
 * pages and tests share one source. The database computes the stored totals
 * (private.ws_totals); orderTotals here mirrors it for the live cart preview.
 */

export const TERMS: { days: number; label: string }[] = [
  { days: 0, label: 'Due on receipt' }, { days: 7, label: 'Net 7' }, { days: 10, label: 'Net 10' }, { days: 15, label: 'Net 15' },
  { days: 30, label: 'Net 30' }, { days: 45, label: 'Net 45' }, { days: 60, label: 'Net 60' }, { days: 90, label: 'Net 90' },
];
export const termsLabel = (d: number) => TERMS.find((t) => t.days === d)?.label ?? `Net ${d}`;

export const ADJUST_REASONS = ['Received', 'Cycle count', 'Damaged', 'Expired', 'Sample / promo', 'Theft / loss', 'Other'] as const;
export const PAY_METHODS = [
  { key: 'check', label: 'Check' }, { key: 'cash', label: 'Cash' }, { key: 'ach', label: 'ACH / bank transfer' },
  { key: 'zelle', label: 'Zelle' }, { key: 'card', label: 'Card' }, { key: 'other', label: 'Other' },
] as const;
export type PayMethod = (typeof PAY_METHODS)[number]['key'];
/** Paper payments that have to be taken to the bank. */
export const DEPOSITABLE: readonly string[] = ['check', 'cash'];
export const methodLabel = (m: string) => PAY_METHODS.find((p) => p.key === m)?.label ?? m;

export const ORDER_STATUS: Record<string, { label: string; tone: 'neutral' | 'info' | 'good' | 'warning' | 'danger' }> = {
  open: { label: 'Open', tone: 'info' }, picking: { label: 'Picking', tone: 'warning' }, ready: { label: 'Ready to ship', tone: 'good' },
  invoiced: { label: 'Invoiced', tone: 'neutral' }, cancelled: { label: 'Cancelled', tone: 'neutral' },
};

const dayNum = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86_400_000;
export const daysBetween = (from: string, to: string) => Math.round(dayNum(to) - dayNum(from));
export function addDays(d: string, n: number): string {
  return new Date((dayNum(d) + n) * 86_400_000).toISOString().slice(0, 10);
}

/** Tier price in cents: list price less the tier's percent, rounded to the cent. */
export const tierPrice = (priceCents: number, pct: number) => Math.round(priceCents * (1 - pct / 100));

export interface Line { qty: number; price_cents: number; cost_cents?: number }
/** Same math as the database: tax on (subtotal − discount), total adds shipping and tax. */
export function orderTotals(lines: Line[], discount = 0, shipping = 0, taxRate = 0) {
  const subtotal = lines.reduce((s, l) => s + Math.round(l.qty * l.price_cents), 0);
  const cost = lines.reduce((s, l) => s + Math.round(l.qty * (l.cost_cents ?? 0)), 0);
  const tax = Math.round((Math.max(subtotal - discount, 0) * taxRate) / 100);
  return { subtotal, cost, tax, total: subtotal - discount + shipping + tax };
}

export interface InvoiceRow {
  id: string; number: string; customer_id: string; invoice_date: string; due_date: string;
  total_cents: number; cost_cents: number; subtotal_cents: number; discount_cents: number; voided_at: string | null;
}
export interface PaymentRow { id: string; invoice_id: string; paid_on: string; amount_cents: number; method: string; check_no: string | null; bank: string | null; deposit_date: string | null; expected_payment_id: string | null }

export type InvoiceStatus = 'void' | 'paid' | 'overdue' | 'due_today' | 'open';
export const INVOICE_STATUS: Record<InvoiceStatus, { label: string; tone: 'neutral' | 'info' | 'good' | 'warning' | 'danger' }> = {
  void: { label: 'Void', tone: 'neutral' }, paid: { label: 'Paid', tone: 'good' }, overdue: { label: 'Overdue', tone: 'danger' },
  due_today: { label: 'Due today', tone: 'warning' }, open: { label: 'Open', tone: 'info' },
};

export function invoiceStatus(inv: Pick<InvoiceRow, 'voided_at' | 'due_date' | 'total_cents'>, paid: number, today: string): InvoiceStatus {
  if (inv.voided_at) return 'void';
  if (inv.total_cents - paid <= 0) return 'paid';
  if (inv.due_date < today) return 'overdue';
  if (inv.due_date === today) return 'due_today';
  return 'open';
}

export const AGING = ['Not yet due', '1–30', '31–60', '61–90', '90+'] as const;
export function agingBucket(dueDate: string, today: string): number {
  const late = daysBetween(dueDate, today);
  return late <= 0 ? 0 : late <= 30 ? 1 : late <= 60 ? 2 : late <= 90 ? 3 : 4;
}

/** Each invoice with what's been paid, what's left and its status. */
export function withBalances<T extends InvoiceRow>(invoices: T[], payments: PaymentRow[], today: string) {
  const paid = new Map<string, number>();
  for (const p of payments) paid.set(p.invoice_id, (paid.get(p.invoice_id) ?? 0) + p.amount_cents);
  return invoices.map((i) => {
    const p = paid.get(i.id) ?? 0;
    const status = invoiceStatus(i, p, today);
    return { ...i, paid: p, balance: status === 'void' ? 0 : Math.max(i.total_cents - p, 0), status, daysLate: Math.max(daysBetween(i.due_date, today), 0) };
  });
}
export type InvoiceWithBalance<T extends InvoiceRow = InvoiceRow> = ReturnType<typeof withBalances<T>>[number];

/** Aging buckets (cents) across open invoices. */
export function aging(invoices: InvoiceWithBalance[], today: string): number[] {
  const out = AGING.map(() => 0);
  for (const i of invoices) if (i.balance > 0) out[agingBucket(i.due_date, today)] += i.balance;
  return out;
}

export interface CustomerLite { id: string; credit_limit_cents: number | null; cert_expiry: string | null; tax_exempt: boolean; on_hold: boolean }
export interface CustomerStanding { balance: number; overdue: number; overdueCount: number; overLimit: boolean; certExpired: boolean; warnings: string[] }

/** Balance, overdue amount and the warnings the Ledger shows on a customer. */
export function standing(c: CustomerLite, invoices: InvoiceWithBalance[], today: string): CustomerStanding {
  const mine = invoices.filter((i) => i.customer_id === c.id && i.balance > 0);
  const balance = mine.reduce((s, i) => s + i.balance, 0);
  const late = mine.filter((i) => i.status === 'overdue');
  const overdue = late.reduce((s, i) => s + i.balance, 0);
  const overLimit = c.credit_limit_cents != null && balance > c.credit_limit_cents;
  const certExpired = c.tax_exempt && !!c.cert_expiry && c.cert_expiry < today;
  const warnings = [
    c.on_hold && 'On hold',
    late.length > 0 && 'Overdue invoices',
    overLimit && 'Over credit limit',
    certExpired && 'Resale certificate expired',
  ].filter(Boolean) as string[];
  return { balance, overdue, overdueCount: late.length, overLimit, certExpired, warnings };
}

export interface ItemLite { id: string; qty: number; case_pack: number | null; reorder_at: number | null; reorder_qty: number | null; cost_cents: number; price_cents: number; is_active: boolean }
export interface OpenLine { item_id: string | null; qty: number }

/** Stock held by open orders (not yet invoiced or cancelled) per item. */
export function committed(lines: OpenLine[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of lines) if (l.item_id) m.set(l.item_id, (m.get(l.item_id) ?? 0) + Number(l.qty));
  return m;
}

/**
 * How many to reorder: when free stock (on hand − committed) is at or below the
 * reorder point, bring it back to point + reorder qty (or just reorder qty),
 * rounded up to whole case packs. Null when no reorder is needed.
 */
export function reorderSuggestion(it: ItemLite, held: number): number | null {
  if (!it.is_active || it.reorder_at == null) return null;
  const free = Number(it.qty) - held;
  if (free > Number(it.reorder_at)) return null;
  const want = it.reorder_qty != null && Number(it.reorder_qty) > 0 ? Number(it.reorder_qty) : Math.max(Number(it.reorder_at) - free, 1);
  const pack = it.case_pack && it.case_pack > 1 ? it.case_pack : 1;
  return Math.ceil(want / pack) * pack;
}

export function stockValue(items: ItemLite[]) {
  let cost = 0, price = 0;
  for (const it of items) if (it.is_active && Number(it.qty) > 0) { cost += Math.round(Number(it.qty) * it.cost_cents); price += Math.round(Number(it.qty) * it.price_cents); }
  return { cost, price };
}

export interface Expected { id: string; customer_id: string; due_date: string; amount_cents: number; status: string }
/** Expected payments split into late, next 7 days and later. */
export function scheduleGroups<T extends Expected>(list: T[], today: string) {
  const open = list.filter((e) => e.status === 'expected').sort((a, b) => a.due_date.localeCompare(b.due_date));
  const week = addDays(today, 7);
  return {
    late: open.filter((e) => e.due_date < today),
    soon: open.filter((e) => e.due_date >= today && e.due_date <= week),
    later: open.filter((e) => e.due_date > week),
  };
}

/** Split an amount into n dated payments a set number of days apart (cents add up exactly). */
export function splitPlan(totalCents: number, n: number, first: string, everyDays: number): { due_date: string; amount_cents: number }[] {
  if (n < 1 || totalCents < n) return [];
  const base = Math.floor(totalCents / n), extra = totalCents - base * n;
  return Array.from({ length: n }, (_, i) => ({ due_date: addDays(first, i * everyDays), amount_cents: base + (i < extra ? 1 : 0) }));
}

export const fmtQty = (q: number) => (Number.isInteger(Number(q)) ? String(Number(q)) : Number(q).toFixed(3).replace(/0+$/, ''));
