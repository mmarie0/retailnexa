/**
 * Spreadsheet (CSV or Excel) rows → import rows for public.admin_import_rows.
 * One sheet holds one kind of record; the header row decides the columns
 * (common names are recognised, case-insensitive). Pure and unit-tested.
 */
import { guessMapping, parseAmount, parseDate, rowsToSalesDays, type RowError } from '@/lib/sales/import';
import { guessBankMapping, rowsToBankLines } from '@/lib/bank/import';
import { accountRoleFor, type ImportKind, type Row } from './backup';

export const SHEET_KINDS: { kind: ImportKind; label: string; columns: string }[] = [
  { kind: 'vendor', label: 'Vendors', columns: 'Name, Contact, Email, Phone, Terms (days), Notes' },
  { kind: 'bill', label: 'Bills', columns: 'Vendor, Invoice #, Bill date, Due date, Amount, Category (rent/utilities/inventory…), Paid amount, Paid date, Memo' },
  { kind: 'sales_day', label: 'Daily sales', columns: 'Date, Register, Gross sales, Discounts, Tax, Cash, Card, Store credit, Transactions' },
  { kind: 'bank_line', label: 'Bank statement', columns: 'Date, Description, Amount (or Debit / Credit)' },
  { kind: 'recurring', label: 'Fixed costs', columns: 'Name, Amount, Day of month' },
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9#%]+/g, ' ').trim();
function col(headers: string[], ...aliases: string[]): number | undefined {
  const h = headers.map(norm);
  for (const a of aliases) { const i = h.indexOf(a); if (i >= 0) return i; }
  for (const a of aliases) { const i = h.findIndex((x) => x.startsWith(a + ' ') || x.endsWith(' ' + a)); if (i >= 0) return i; }
  return undefined;
}
const ROLE_WORDS: Record<string, string> = {
  rent: 'rent', utilities: 'utilities', utility: 'utilities', inventory: 'inventory', merchandise: 'inventory', stock: 'inventory',
  'card fees': 'card_fees', 'card processing': 'card_fees', payroll: 'payroll', interest: 'interest', other: 'other_operating',
};

export function planFromSheet(kind: ImportKind, rows: string[][], opts: { today: string; timeZone?: string }): { rows: Row[]; errors: RowError[] } {
  const [head, ...body] = rows;
  if (!head || body.length === 0) return { rows: [], errors: [{ line: 1, message: 'The sheet needs a header row and at least one row of data.' }] };
  const errors: RowError[] = [];
  const out: Row[] = [];
  const cell = (r: string[], i: number | undefined) => (i === undefined ? '' : (r[i] ?? '').trim());

  if (kind === 'sales_day') {
    const { days, errors: e } = rowsToSalesDays(body, guessMapping(head), 2, { timeZone: opts.timeZone });
    return {
      rows: days.map((d) => ({ key: `${d.businessDate}|${d.register}`, date: d.businessDate, register: d.register, gross_sales_cents: d.grossCents,
        discounts_cents: d.discountsCents, sales_tax_cents: d.taxCents, cash_cents: d.cashCents, card_cents: d.cardCents,
        customer_credit_cents: d.creditCents, transaction_count: d.transactions })),
      errors: e,
    };
  }
  if (kind === 'bank_line') {
    const { lines, errors: e } = rowsToBankLines(body, guessBankMapping(head));
    return { rows: lines.map((l) => ({ date: l.date, description: l.description, amount_cents: l.amountCents, occurrence: l.occurrence })), errors: e };
  }

  if (kind === 'vendor') {
    const c = { name: col(head, 'name', 'vendor', 'company', 'vendor name'), contact: col(head, 'contact', 'contact name', 'rep'), email: col(head, 'email', 'e mail'),
      phone: col(head, 'phone', 'telephone', 'tel'), terms: col(head, 'terms', 'payment terms', 'terms days', 'net'), notes: col(head, 'notes', 'note', 'memo') };
    if (c.name === undefined) return { rows: [], errors: [{ line: 1, message: 'Add a "Name" column.' }] };
    body.forEach((r, i) => {
      const line = i + 2, name = cell(r, c.name);
      if (!name) return;
      const t = cell(r, c.terms).replace(/[^0-9]/g, '');
      out.push({ key: name.toLowerCase(), name, contact_name: cell(r, c.contact) || null, email: cell(r, c.email) || null, phone: cell(r, c.phone) || null,
        payment_terms_days: t && Number(t) <= 365 ? Number(t) : null, notes: cell(r, c.notes) || null, line });
    });
    return { rows: out, errors };
  }

  if (kind === 'recurring') {
    const c = { name: col(head, 'name', 'vendor', 'company', 'bill'), amount: col(head, 'amount', 'monthly amount', 'cost'), day: col(head, 'day', 'day of month', 'due day') };
    if (c.name === undefined || c.amount === undefined) return { rows: [], errors: [{ line: 1, message: 'Add "Name" and "Amount" columns.' }] };
    body.forEach((r, i) => {
      const line = i + 2, name = cell(r, c.name);
      if (!name) return;
      const amount = parseAmount(cell(r, c.amount)); const day = Number(cell(r, c.day)) || 1;
      if (!amount || amount <= 0) { errors.push({ line, message: `${name}: enter an amount like 1600.00` }); return; }
      const d = Math.min(31, Math.max(1, day));
      const [y, m, dd] = opts.today.split('-').map(Number);
      const last = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0)).getUTCDate();
      let yy = y, mm = m; if (Math.min(d, last(yy, mm)) < dd) { mm++; if (mm > 12) { mm = 1; yy++; } }
      out.push({ key: name.toLowerCase(), name, vendor: name, amount_cents: amount, day_of_month: d, active: true, account_role: accountRoleFor(name, 'bill'),
        next_date: `${yy}-${String(mm).padStart(2, '0')}-${String(Math.min(d, last(yy, mm))).padStart(2, '0')}`, line });
    });
    return { rows: out, errors };
  }

  // bills
  const c = { vendor: col(head, 'vendor', 'company', 'supplier', 'payee', 'name'), number: col(head, 'invoice #', 'invoice', 'invoice number', 'bill #', 'bill number', 'number', 'ref'),
    date: col(head, 'bill date', 'invoice date', 'date'), due: col(head, 'due date', 'due'), amount: col(head, 'amount', 'total', 'invoice amount', 'bill amount'),
    category: col(head, 'category', 'account', 'type'), paid: col(head, 'paid amount', 'paid', 'amount paid'), paidOn: col(head, 'paid date', 'date paid', 'paid on'),
    memo: col(head, 'memo', 'notes', 'note', 'description') };
  if (c.vendor === undefined || c.amount === undefined || c.date === undefined) return { rows: [], errors: [{ line: 1, message: 'Add "Vendor", "Bill date" and "Amount" columns.' }] };
  body.forEach((r, i) => {
    const line = i + 2, vendor = cell(r, c.vendor);
    if (!vendor && !cell(r, c.amount)) return;
    const fail = (m: string) => errors.push({ line, message: m });
    if (!vendor) return fail('vendor is missing');
    const date = parseDate(cell(r, c.date), opts.timeZone); if (!date) return fail(`${vendor}: bill date isn’t a date`);
    const due = cell(r, c.due) ? parseDate(cell(r, c.due), opts.timeZone) : date; if (!due) return fail(`${vendor}: due date isn’t a date`);
    const amount = parseAmount(cell(r, c.amount)); if (!amount || amount <= 0) return fail(`${vendor}: enter an amount like 125.00`);
    const cat = norm(cell(r, c.category));
    const role = ROLE_WORDS[cat] ?? accountRoleFor(vendor);
    const paidRaw = cell(r, c.paid);
    const paid = paidRaw ? (/^(yes|y|paid|true)$/i.test(paidRaw) ? amount : parseAmount(paidRaw)) : null;
    if (paidRaw && paid === null) return fail(`${vendor}: paid amount isn’t a number`);
    const paidOn = cell(r, c.paidOn) ? parseDate(cell(r, c.paidOn), opts.timeZone) : due;
    const number = cell(r, c.number);
    out.push({ key: `${vendor.toLowerCase()}|${number || date}|${amount}`, vendor, bill_number: number || null, bill_date: date, due_date: due, amount_cents: amount,
      account_role: role, memo: cell(r, c.memo) || null, line,
      payments: paid && paid > 0 ? [{ date: paidOn ?? due, amount_cents: Math.min(paid, amount), source: 'bank', reference: 'Imported' }] : [] });
  });
  return { rows: out, errors };
}
