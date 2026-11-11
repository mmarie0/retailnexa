/**
 * Vendor statements (#110), copied from the owner's RetailNexa app: each
 * statement line is matched to a bill; lines with no bill are flagged so they
 * can be added. Pure; money in integer cents.
 */
import { parseAmount, parseDate } from '@/lib/sales/import';

export interface StatementLineIn { line_date: string | null; reference: string | null; description: string | null; amount_cents: number }
export interface StatementLine extends StatementLineIn { id: string; bill_id: string | null; dismissed: boolean }
export interface BillLite { id: string; bill_number: string; bill_date: string; total_cents: number; status: string }
export type LineStatus = 'matched' | 'amount_differs' | 'missing' | 'credit' | 'set_aside';
export interface Matched extends StatementLine { status: LineStatus; bill: BillLite | null; how: 'linked' | 'number' | 'amount' | null }

/** Invoice numbers compared loosely: letters and digits only, leading zeros dropped ("INV-00123" = "123" = "inv123"). */
export const numKey = (s: string | null) => (s ?? '').toLowerCase().replace(/^(inv(oice)?|#)\s*/, '').replace(/[^a-z0-9]/g, '').replace(/^0+(?=\d)/, '');
const days = (a: string, b: string) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;

/**
 * Match lines to the vendor's bills: a bill picked by hand wins, then the same
 * invoice number, then the same amount within 7 days when only one bill fits.
 * Each bill matches one line. Credits and payments (negative) need no bill.
 */
export function matchStatement(lines: StatementLine[], bills: BillLite[]) {
  const live = bills.filter((b) => b.status !== 'void').map((b) => ({ ...b, total_cents: Number(b.total_cents) }));
  const byId = new Map(live.map((b) => [b.id, b]));
  const used = new Set(lines.map((l) => l.bill_id).filter(Boolean) as string[]);
  const out: Matched[] = lines.map((l) => ({ ...l, amount_cents: Number(l.amount_cents), status: 'missing', bill: null, how: null }));
  for (const m of out) {
    if (m.bill_id && byId.has(m.bill_id)) { m.bill = byId.get(m.bill_id)!; m.how = 'linked'; }
  }
  for (const m of out) {
    if (m.bill || m.dismissed || m.amount_cents < 0 || !numKey(m.reference)) continue;
    const b = live.find((x) => !used.has(x.id) && numKey(x.bill_number) === numKey(m.reference));
    if (b) { m.bill = b; m.how = 'number'; used.add(b.id); }
  }
  for (const m of out) {
    if (m.bill || m.dismissed || m.amount_cents < 0 || !m.line_date) continue;
    const fits = live.filter((x) => !used.has(x.id) && x.total_cents === m.amount_cents && days(x.bill_date, m.line_date!) <= 7);
    if (fits.length === 1) { m.bill = fits[0]; m.how = 'amount'; used.add(fits[0].id); }
  }
  for (const m of out) {
    m.status = m.dismissed ? 'set_aside' : m.amount_cents < 0 && !m.bill ? 'credit' : !m.bill ? 'missing' : m.bill.total_cents === m.amount_cents ? 'matched' : 'amount_differs';
  }
  const sum = (s: LineStatus) => out.filter((m) => m.status === s);
  return {
    lines: out,
    missing: sum('missing'), differs: sum('amount_differs'),
    totals: { statement: out.reduce((a, m) => a + m.amount_cents, 0), missing: sum('missing').reduce((a, m) => a + m.amount_cents, 0) },
  };
}

/** Bills in the statement's dates that the statement doesn't list (maybe already paid, or a mistake). */
export function notOnStatement(matched: Matched[], bills: BillLite[], from: string | null, to: string) {
  const on = new Set(matched.map((m) => m.bill?.id).filter(Boolean));
  return bills.filter((b) => b.status !== 'void' && !on.has(b.id) && (!from || b.bill_date >= from) && b.bill_date <= to);
}

const norm = (s: string) => (s ?? '').toLowerCase().replace(/[^a-z0-9#]+/g, ' ').trim();
/** Statement sheet: Date, Invoice # (or Reference, Number, Document), Description (optional), and Amount or Charges/Debit + Credits/Payments. */
export function parseStatementSheet(rows: string[][]): { lines: StatementLineIn[]; errors: { line: number; message: string }[] } {
  const [head, ...body] = rows;
  if (!head) return { lines: [], errors: [{ line: 1, message: 'The sheet is empty.' }] };
  const h = head.map(norm);
  const find = (...names: string[]) => { for (const n of names) { const i = h.indexOf(n); if (i >= 0) return i; } return -1; };
  const c = {
    date: find('date', 'invoice date', 'inv date', 'doc date', 'transaction date'),
    ref: find('invoice', 'invoice #', 'invoice number', 'inv #', 'inv', 'number', 'reference', 'ref', 'document', 'doc #', 'doc'),
    desc: find('description', 'memo', 'type', 'details'),
    amount: find('amount', 'total', 'balance due', 'invoice amount'),
    debit: find('charges', 'charge', 'debit', 'debits', 'invoices'),
    credit: find('credits', 'credit', 'payments', 'payment'),
  };
  if (c.amount < 0 && c.debit < 0) return { lines: [], errors: [{ line: 1, message: 'Add an "Amount" column (or "Charges" and "Credits").' }] };
  const lines: StatementLineIn[] = [], errors: { line: number; message: string }[] = [];
  body.forEach((r, i) => {
    const line = i + 2;
    if (r.every((x) => !x?.trim())) return;
    const ref = c.ref >= 0 ? (r[c.ref] ?? '').trim() : '', desc = c.desc >= 0 ? (r[c.desc] ?? '').trim() : '';
    if (/^(total|totals|balance|balance forward|amount due)$/i.test(ref || desc)) return;
    let cents: number | null;
    if (c.amount >= 0) cents = parseAmount(r[c.amount]);
    else { const d = parseAmount(r[c.debit]) ?? 0, cr = c.credit >= 0 ? parseAmount(r[c.credit]) ?? 0 : 0; cents = d - Math.abs(cr); }
    if (cents === null) return errors.push({ line, message: `${ref || 'This line'}: the amount must look like 1234.56` }) && undefined;
    if (cents === 0) return;
    const rawDate = c.date >= 0 ? (r[c.date] ?? '').trim() : '';
    const date = rawDate ? parseDate(rawDate) : null;
    if (rawDate && !date) return errors.push({ line, message: `“${rawDate}” isn’t a date` }) && undefined;
    lines.push({ line_date: date, reference: ref.slice(0, 100) || null, description: desc.slice(0, 200) || null, amount_cents: cents });
  });
  if (lines.length > 500) errors.push({ line: 1, message: 'Up to 500 lines per statement.' });
  return { lines, errors };
}
