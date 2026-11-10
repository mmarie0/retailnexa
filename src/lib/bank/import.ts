import { parseAmount, parseDate } from '@/lib/sales/import';

/**
 * Bank statement CSV → signed lines (+ money in, − money out).
 * Banks export either one signed "Amount" column or separate Debit/Credit
 * (Withdrawal/Deposit) columns; both are supported. Identical lines on the same
 * day get an occurrence number so re-imports de-duplicate correctly.
 */
export const BANK_FIELDS = [
  { key: 'date', label: 'Date', required: true },
  { key: 'description', label: 'Description', required: true },
  { key: 'amount', label: 'Amount (signed)', required: false },
  { key: 'moneyOut', label: 'Money out (debit / withdrawal)', required: false },
  { key: 'moneyIn', label: 'Money in (credit / deposit)', required: false },
] as const;
export type BankField = (typeof BANK_FIELDS)[number]['key'];
export type BankMapping = Partial<Record<BankField, number>>;

const ALIASES: Record<BankField, string[]> = {
  date: ['date', 'posting date', 'posted date', 'transaction date', 'post date', 'trans date'],
  description: ['description', 'details', 'memo', 'payee', 'name', 'transaction description', 'narrative'],
  amount: ['amount', 'transaction amount', 'amt'],
  moneyOut: ['debit', 'withdrawal', 'withdrawals', 'debits', 'money out', 'payment', 'paid out'],
  moneyIn: ['credit', 'deposit', 'deposits', 'credits', 'money in', 'paid in'],
};
const norm = (s: string) => s.toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();

export function guessBankMapping(headers: string[]): BankMapping {
  const h = headers.map(norm);
  const out: BankMapping = {};
  const used = new Set<number>();
  for (const f of BANK_FIELDS) {
    for (const a of ALIASES[f.key]) {
      const i = h.findIndex((c, idx) => !used.has(idx) && c === a);
      if (i >= 0) { out[f.key] = i; used.add(i); break; }
    }
  }
  return out;
}

export interface BankLine { line: number; date: string; description: string; amountCents: number; occurrence: number }
export interface BankRowError { line: number; message: string }

export function rowsToBankLines(rows: string[][], m: BankMapping, opts: { flipSign?: boolean } = {}, firstLine = 2) {
  const lines: BankLine[] = [];
  const errors: BankRowError[] = [];
  const seen = new Map<string, number>();
  const cell = (r: string[], f: BankField) => (m[f] === undefined ? undefined : r[m[f]!]);
  rows.forEach((r, i) => {
    const line = firstLine + i;
    const date = parseDate(cell(r, 'date'));
    if (!date) return errors.push({ line, message: `“${cell(r, 'date') ?? ''}” is not a date` });
    const description = (cell(r, 'description') ?? '').trim().replace(/\s+/g, ' ').slice(0, 300);
    if (!description) return errors.push({ line, message: 'no description' });
    let amount: number | null;
    if (m.amount !== undefined) {
      amount = parseAmount(cell(r, 'amount'));
    } else {
      const out = parseAmount(cell(r, 'moneyOut'));
      const inn = parseAmount(cell(r, 'moneyIn'));
      amount = out === null || inn === null ? null : Math.abs(inn) - Math.abs(out);
    }
    if (amount === null) return errors.push({ line, message: 'amount is not a number' });
    if (amount === 0) return errors.push({ line, message: 'amount is zero' });
    if (opts.flipSign) amount = -amount;
    const key = `${date}|${amount}|${description.toLowerCase()}`;
    const occurrence = (seen.get(key) ?? 0) + 1;
    seen.set(key, occurrence);
    lines.push({ line, date, description, amountCents: amount, occurrence });
  });
  return { lines, errors };
}
