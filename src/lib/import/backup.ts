/**
 * Maps the owner's old RetailNexa app data into import rows for
 * public.admin_import_rows. Pure, so it can be unit-tested.
 *
 * Accepted shapes (the old app stores each collection as documents):
 *   { bills: [...], fixed: [...], sales: [...], vendors: [...], bank: [...], months: [...], ... }
 *   { collections: { ...same } }  or  { data: { ...same } }
 * Each document may be flat ({ id, company, amount, ... }) or wrapped ({ id, data: {...} }).
 * Money in the old app is in dollars; rows here are in integer cents.
 */

export type ImportKind = 'vendor' | 'bill' | 'recurring' | 'sales_day' | 'bank_line';
export type Row = Record<string, unknown>;
export interface ImportPlan {
  rows: Record<ImportKind, Row[]>;
  warnings: string[];
  /** Collections found in the file that can't be imported yet, with their document counts. */
  notYet: { name: string; count: number; why: string }[];
}

const NOT_YET: Record<string, string> = {
  months: 'monthly sales history (coming with Sales history, #103)',
  employees: 'staff (coming with Staff, #102)',
  payruns: 'payroll runs (coming with Staff, #102)',
  weeks: 'schedules (coming with Staff, #102)',
  statements: 'vendor statements (coming with #110)',
  cats: 'sales categories (coming with #112)',
  profits: 'entered profits (coming with Profit partners, #104)',
  dists: 'partner payouts (coming with Profit partners, #104)',
  xfers: 'location balances (coming with #106)',
  maint: 'maintenance tasks (coming with Upkeep, #115)',
  cashlog: 'cash & safe log (not built: owner excluded)',
  cashweeks: 'cash & safe weeks (not built: owner excluded)',
};

const BILL_WORDS = /\b(rent|lease|landlord|electric|power|energy|utilit|water|sewer|gas co|natural gas|waste|trash|garbage|insurance|phone|wireless|mobile|internet|cable|comcast|verizon|at&t|spectrum|xfinity|t-mobile|frontier|teco|alarm|security|adt|alert ?360|software|subscription|pos\b|card processing|merchant|processing fee|credit card fee|bank fee|loan|mortgage|tax|irs|payroll|accountant|cpa|cleaning|pest|license|permit|hoa|cam\b|common area)/i;

/** Expense account (by role) for a bill, from its vendor name. Vendor orders go to inventory. */
export function accountRoleFor(vendor: string, kind?: unknown): string {
  const isBill = kind === 'bill' || (kind !== 'order' && BILL_WORDS.test(vendor));
  if (!isBill) return 'inventory';
  if (/\b(rent|lease|landlord|cam\b|common area|hoa)/i.test(vendor)) return 'rent';
  if (/\b(electric|power|energy|utilit|water|sewer|gas co|natural gas|waste|trash|garbage|teco|phone|wireless|mobile|internet|cable|comcast|verizon|at&t|spectrum|xfinity|t-mobile|frontier)/i.test(vendor)) return 'utilities';
  if (/\b(card processing|merchant|processing fee|credit card fee)/i.test(vendor)) return 'card_fees';
  if (/\b(loan|mortgage)/i.test(vendor)) return 'interest';
  return 'other_operating';
}

export const toCents = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());
/** A real calendar date from 2000 to 2100 (#130); anything else is treated as missing. */
export const isoDate = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const y = +s.slice(0, 4), m = +s.slice(5, 7), d = +s.slice(8, 10);
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1) return null;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate() ? s : null;
};

function docs(v: unknown): Row[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((d) => {
    if (!d || typeof d !== 'object') return [];
    const o = d as Row;
    if (o.data && typeof o.data === 'object' && !Array.isArray(o.data)) return [{ id: o.id, ...(o.data as Row) }];
    return [o];
  });
}

function collections(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('This file isn’t a RetailNexa backup (expected a JSON object).');
  const o = input as Record<string, unknown>;
  for (const k of ['collections', 'data', 'store']) {
    const inner = o[k];
    if (inner && typeof inner === 'object' && !Array.isArray(inner) && Object.values(inner).some(Array.isArray)) return inner as Record<string, unknown>;
  }
  if (!Object.values(o).some(Array.isArray)) throw new Error('This file has no collections to import (bills, sales, vendors…).');
  return o;
}

/** Next date on or after `from` that falls on `day` of the month (clamped to month end). */
export function nextOnDay(from: string, day: number): string {
  const [y, m, d] = from.split('-').map(Number);
  const dim = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  let yy = y, mm = m;
  if (Math.min(day, dim(yy, mm)) < d) { mm += 1; if (mm > 12) { mm = 1; yy += 1; } }
  const dd = Math.min(Math.max(1, day), dim(yy, mm));
  return `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

export function planFromBackup(input: unknown, opts: { today: string }): ImportPlan {
  const c = collections(input);
  const rows: ImportPlan['rows'] = { vendor: [], bill: [], recurring: [], sales_day: [], bank_line: [] };
  const warnings: string[] = [];
  const notYet: ImportPlan['notYet'] = [];

  for (const v of docs(c.vendors)) {
    const name = str(v.name);
    if (!name) continue;
    const terms = Number(v.terms);
    rows.vendor.push({
      key: str(v.id) || name.toLowerCase(), name, contact_name: str(v.contact) || null, email: str(v.email) || null,
      phone: str(v.phone) || null, payment_terms_days: Number.isInteger(terms) && terms >= 0 && terms <= 365 ? terms : null,
      notes: [str(v.notes), v.payMethod ? `Pays by ${str(v.payMethod)}` : '', v.account ? `Account # ${str(v.account)}` : ''].filter(Boolean).join(' · ') || null,
    });
  }

  let credits = 0, noDate = 0, noVendor = 0;
  for (const b of docs(c.bills)) {
    const vendor = str(b.company);
    const amount = toCents(b.amount);
    const due = isoDate(b.dueDate);
    const billDate = isoDate(b.invoiceDate) ?? due;
    if (!vendor) { noVendor++; continue; }
    if (!billDate) { noDate++; continue; }
    if (amount === null || amount <= 0 || b.credit === true || b.kind === 'credit') { credits++; continue; }
    const pays = Array.isArray(b.payments) ? (b.payments as Row[]) : [];
    let payments = pays.map((p) => ({
      date: isoDate(p.date) ?? isoDate(b.paidDate) ?? billDate,
      amount_cents: toCents(p.amount) ?? 0,
      source: /cash/i.test(str(p.method)) ? 'cash_on_hand' : 'bank',
      reference: [str(p.method), str(p.ref)].filter(Boolean).join(' ') || null,
    })).filter((p) => p.amount_cents > 0);
    if (b.paid === true && payments.length === 0) payments = [{ date: isoDate(b.paidDate) ?? billDate, amount_cents: amount, source: 'bank', reference: 'Marked paid' }];
    // Never pay more than the bill (the old app allowed rounding drift).
    let left = amount;
    payments = payments.map((p) => { const a = Math.min(p.amount_cents, left); left -= a; return { ...p, amount_cents: a }; }).filter((p) => p.amount_cents > 0);
    rows.bill.push({
      key: str(b.id) || `${vendor}|${billDate}|${amount}|${str(b.invoiceNo)}`,
      vendor, bill_number: str(b.invoiceNo) || null, bill_date: billDate, due_date: due ?? billDate, amount_cents: amount,
      account_role: accountRoleFor(vendor, b.kind), memo: str(b.note).slice(0, 300) || null, payments,
    });
  }
  if (credits) warnings.push(`${credits} credit or zero-amount bill${credits === 1 ? '' : 's'} skipped (credits aren’t imported yet).`);
  if (noDate) warnings.push(`${noDate} bill${noDate === 1 ? '' : 's'} without a date skipped.`);
  if (noVendor) warnings.push(`${noVendor} bill${noVendor === 1 ? '' : 's'} without a company skipped.`);

  for (const f of docs(c.fixed)) {
    const name = str(f.name), amount = toCents(f.amount), day = Number(f.day) || 1;
    if (!name || !amount || amount <= 0) continue;
    const start = typeof f.startMonth === 'string' && /^\d{4}-\d{2}$/.test(f.startMonth) ? `${f.startMonth}-01` : opts.today;
    const from = start > opts.today ? start : opts.today;
    const endMonth = typeof f.endMonth === 'string' && /^\d{4}-\d{2}$/.test(f.endMonth) ? f.endMonth : null;
    const endDate = endMonth ? nextOnDay(`${endMonth}-01`, 31) : null;
    if (endDate && endDate < from) continue;
    rows.recurring.push({
      key: str(f.id) || name.toLowerCase(), name, vendor: name, amount_cents: amount, day_of_month: Math.min(31, Math.max(1, day)),
      next_date: nextOnDay(from, day), end_date: endDate, active: f.active !== false, account_role: accountRoleFor(name, 'bill'),
    });
  }

  let rebalanced = 0, empty = 0, future = 0;
  for (const d of docs(c.sales)) {
    const date = isoDate(d.date) ?? isoDate(d.id);
    if (!date) continue;
    if (date > opts.today) { future++; continue; }
    const c0 = (k: string) => toCents(d[k]) ?? 0;
    const tax = c0('tax'), cash = c0('cash'), card = c0('card') + c0('other'), credit = c0('storeCard'), disc = c0('points');
    let net = toCents(d.sales) ?? (toCents(d.gross) !== null ? (toCents(d.gross) as number) - tax : 0);
    const tender = cash + card + credit;
    if (tender === 0 && net === 0 && tax === 0) { empty++; continue; }
    let cashOut = cash;
    if (tender !== net - disc + tax) {
      // The old app kept tenders and totals separately; the ledger needs them to agree.
      // Money actually collected wins when there is some; otherwise the totals are taken as cash.
      if (tender > 0) net = tender - tax + disc;
      else cashOut = net - disc + tax;
      rebalanced++;
    }
    if (net < 0 || net < disc) { empty++; continue; }
    rows.sales_day.push({
      key: date, date, gross_sales_cents: net, discounts_cents: disc, sales_tax_cents: tax,
      cash_cents: cashOut, card_cents: card, customer_credit_cents: credit,
      transaction_count: Number.isInteger(Number(d.txns)) && Number(d.txns) > 0 ? Number(d.txns) : null,
    });
  }
  if (rebalanced) warnings.push(`${rebalanced} sales day${rebalanced === 1 ? '' : 's'} didn’t balance (payments ≠ sales + tax); sales were set from what was collected, or the totals were taken as cash when no payments were recorded.`);
  if (empty) warnings.push(`${empty} empty or invalid sales day${empty === 1 ? '' : 's'} skipped.`);
  if (future) warnings.push(`${future} future-dated sales day${future === 1 ? '' : 's'} skipped.`);

  let bankSkipped = 0;
  for (const t of docs(c.bank)) {
    const date = isoDate(t.date) ?? isoDate(t.postedOn) ?? isoDate(t.posted);
    const description = str(t.description ?? t.desc ?? t.name ?? t.memo ?? t.note).slice(0, 300);
    let amount = toCents(t.amount);
    if (amount !== null && (t.type === 'debit' || t.direction === 'out' || t.withdrawal === true) && amount > 0) amount = -amount;
    if (!date || !description || !amount) { bankSkipped++; continue; }
    rows.bank_line.push({ date, description, amount_cents: amount });
  }
  if (bankSkipped) warnings.push(`${bankSkipped} bank line${bankSkipped === 1 ? '' : 's'} without a date, description or amount skipped.`);

  for (const [name, why] of Object.entries(NOT_YET)) {
    const n = docs(c[name]).length;
    if (n) notYet.push({ name, count: n, why });
  }
  return { rows, warnings, notYet };
}
