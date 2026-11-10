/**
 * Turns a POS export (one row per register per day) into sales days.
 *
 * Column names differ between POS systems, so headers are matched against
 * aliases and the user can correct the mapping before importing. The Vela POS
 * aliases are a best guess until checked against a real Vela export.
 */
export const SALES_FIELDS = [
  { key: 'date', label: 'Date', required: true },
  { key: 'register', label: 'Register', required: false },
  { key: 'gross', label: 'Gross sales (before discounts, excl. tax)', required: true },
  { key: 'discounts', label: 'Discounts / returns', required: false },
  { key: 'tax', label: 'Sales tax', required: false },
  { key: 'cash', label: 'Cash', required: false },
  { key: 'card', label: 'Card', required: false },
  { key: 'credit', label: 'Store credit / gift card', required: false },
  { key: 'transactions', label: 'Transactions', required: false },
] as const;
export type SalesField = (typeof SALES_FIELDS)[number]['key'];
export type Mapping = Partial<Record<SalesField, number>>;

const ALIASES: Record<SalesField, string[]> = {
  date: ['date', 'business date', 'sales date', 'report date', 'day', 'close date'],
  register: ['register', 'register name', 'terminal', 'station', 'workstation', 'drawer', 'till'],
  gross: ['gross sales', 'gross', 'total sales', 'sales', 'item sales', 'sales total', 'subtotal', 'sub total'],
  discounts: ['discounts', 'discount', 'total discount', 'discounts and returns', 'returns', 'refunds'],
  tax: ['tax', 'sales tax', 'total tax', 'tax collected', 'taxes'],
  cash: ['cash', 'cash sales', 'cash total', 'cash tender'],
  card: ['card', 'credit card', 'credit', 'cards', 'card sales', 'credit/debit', 'debit/credit', 'credit card sales', 'debit'],
  credit: ['store credit', 'gift card', 'gift cards', 'house account', 'store credit redeemed'],
  transactions: ['transactions', 'transaction count', 'tickets', 'receipts', 'orders', '# of transactions', 'customers'],
};

const norm = (s: string) => s.toLowerCase().replace(/[_\-]+/g, ' ').replace(/[^a-z0-9#/ ]/g, '').replace(/\s+/g, ' ').trim();

/** Best-effort header → field mapping; exact alias matches win over partial ones; each column used once. */
export function guessMapping(headers: string[]): Mapping {
  const h = headers.map(norm);
  const used = new Set<number>();
  const out: Mapping = {};
  for (const pass of ['exact', 'prefix'] as const) {
    for (const f of SALES_FIELDS) {
      if (out[f.key] !== undefined) continue;
      for (const alias of ALIASES[f.key]) {
        const idx = h.findIndex((col, i) => !used.has(i) && (pass === 'exact' ? col === alias : col.startsWith(alias + ' ')));
        if (idx >= 0) { out[f.key] = idx; used.add(idx); break; }
      }
    }
  }
  return out;
}

/** "$1,234.56", "1234.5", "(12.00)", "-3" → cents. Negative allowed here; the caller decides. */
export function parseAmount(raw: string | undefined): number | null {
  if (raw == null) return null;
  let s = raw.trim();
  if (s === '' || s === '-') return 0;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/[$\s,]/g, '');
  if (s.startsWith('-')) { neg = !neg; s = s.slice(1); }
  const m = /^(\d{0,12})(?:\.(\d{1,2})\d*)?$/.exec(s);
  if (!m || (m[1] === '' && m[2] === undefined)) return null;
  const c = Number(m[1] || '0') * 100 + Number((m[2] ?? '').padEnd(2, '0') || '0');
  return neg ? -c : c;
}

/**
 * YYYY-MM-DD, MM/DD/YYYY, M/D/YY (20xx), optionally with a leading weekday
 * ("Mon 11/09/2026") and a trailing time. A timestamp with "Z" or a UTC offset is
 * converted to the store's calendar day when `timeZone` is given (#40).
 */
export function parseDate(raw: string | undefined, timeZone?: string): string | null {
  if (!raw) return null;
  let t = raw.trim().replace(/^(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*\.?,?\s+/i, '');
  const zoned = /^\d{4}-\d{2}-\d{2}[T ]\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})$/i.exec(t);
  if (zoned) {
    const ms = Date.parse(t.replace(' ', 'T').replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
    if (Number.isNaN(ms)) return null;
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: timeZone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms);
    } catch {
      return new Date(ms).toISOString().slice(0, 10);
    }
  }
  t = t.split(/[ T]/)[0];
  const s = t;
  let y: number, mo: number, d: number;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s))) {
    mo = +m[1]; d = +m[2]; y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
  } else return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

export interface SalesDayRow {
  line: number;
  businessDate: string;
  register: string;
  grossCents: number;
  discountsCents: number;
  taxCents: number;
  cashCents: number;
  cardCents: number;
  creditCents: number;
  transactions: number | null;
}
export interface RowError { line: number; message: string }

const money = (c: number) => `$${(c / 100).toFixed(2)}`;

/** Validates and converts data rows (header excluded). `line` is the 1-based file line for messages. */
export function rowsToSalesDays(rows: string[][], mapping: Mapping, firstLine = 2, opts: { timeZone?: string } = {}): { days: SalesDayRow[]; errors: RowError[] } {
  const days: SalesDayRow[] = [];
  const errors: RowError[] = [];
  const seen = new Set<string>();
  const cell = (r: string[], f: SalesField) => (mapping[f] === undefined ? undefined : r[mapping[f]!]);

  rows.forEach((r, i) => {
    const line = firstLine + i;
    const fail = (message: string) => errors.push({ line, message });
    const date = parseDate(cell(r, 'date'), opts.timeZone);
    if (!date) return fail(`“${cell(r, 'date') ?? ''}” is not a date`);
    const amounts = {} as Record<'gross' | 'discounts' | 'tax' | 'cash' | 'card' | 'credit', number>;
    for (const f of ['gross', 'discounts', 'tax', 'cash', 'card', 'credit'] as const) {
      const v = mapping[f] === undefined ? 0 : parseAmount(cell(r, f));
      if (v === null) return fail(`${f}: “${cell(r, f)}” is not an amount`);
      amounts[f] = v;
    }
    // Exports often show discounts/returns as negatives; we store them as positive reductions.
    amounts.discounts = Math.abs(amounts.discounts);
    for (const f of ['gross', 'tax', 'cash', 'card', 'credit'] as const) {
      if (amounts[f] < 0) return fail(`${f} is negative`);
    }
    if (amounts.discounts > amounts.gross) return fail('discounts are larger than gross sales');
    const expected = amounts.gross - amounts.discounts + amounts.tax;
    const tendered = amounts.cash + amounts.card + amounts.credit;
    if (tendered !== expected) {
      return fail(`payments ${money(tendered)} don’t equal sales − discounts + tax ${money(expected)}`);
    }
    const register = (cell(r, 'register') ?? '').trim().slice(0, 60) || 'All registers';
    const key = `${date}|${register.toLowerCase()}`;
    if (seen.has(key)) return fail(`${date} ${register} appears twice in this file`);
    seen.add(key);
    const tx = cell(r, 'transactions');
    const txn = tx && /^\d+$/.test(tx.trim()) ? Number(tx.trim()) : null;
    days.push({
      line, businessDate: date, register, grossCents: amounts.gross, discountsCents: amounts.discounts, taxCents: amounts.tax,
      cashCents: amounts.cash, cardCents: amounts.card, creditCents: amounts.credit, transactions: txn,
    });
  });
  return { days, errors };
}
