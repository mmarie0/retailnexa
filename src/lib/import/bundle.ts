/**
 * "Everything in one file" for the admin master import (owner request):
 *   - one CSV/Excel sheet with a Type column (Vendor, Bill, Sales, Bank, Fixed cost)
 *     and the columns each type needs, in any order; or
 *   - one .zip holding any mix of CSV/Excel sheets (one kind each, told apart by a
 *     Type column, the file name or the header row) and/or the old app's .json backup.
 * Pure: the client unzips and reads Excel, then hands plain tables here.
 */
import { planFromSheet } from './sheet';
import type { ImportKind, Row } from './backup';

export interface Table { name: string; rows: string[][] }
export interface BundlePlan { rows: Partial<Record<ImportKind, Row[]>>; errors: { line: number; message: string }[]; notes: string[] }

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9#]+/g, ' ').trim();
const TYPE_HEADERS = ['type', 'record', 'record type', 'kind', 'data type', 'sheet'];
const TYPE_WORDS: [RegExp, ImportKind][] = [
  [/^(vendors?|suppliers?)$/, 'vendor'],
  [/^(bills?|invoices?|vendor bills?|vendor invoices?|ap)$/, 'bill'],
  [/^(sales?|sales days?|daily sales|register|registers|z report|sales reports?)$/, 'sales_day'],
  [/^(bank|bank lines?|bank transactions?|transactions?|statements?|bank statements?)$/, 'bank_line'],
  [/^(fixed|fixed costs?|recurring|recurring bills?|fixed bills?)$/, 'recurring'],
];
export const KIND_WORD: Record<ImportKind, string> = { vendor: 'Vendor', bill: 'Bill', sales_day: 'Sales', bank_line: 'Bank', recurring: 'Fixed cost' };

export function kindFromWord(v: string): ImportKind | null {
  const w = norm(v);
  for (const [re, k] of TYPE_WORDS) if (re.test(w)) return k;
  return null;
}

/** From a file name like "2026 bills.csv" or "Bank statement Oct.xlsx". */
export function kindFromName(fileName: string): ImportKind | null {
  // "data.xlsx › Bills" (a workbook tab) is named by the tab.
  const n = norm((fileName.split('›').pop() ?? '').replace(/\.[a-z0-9]+$/i, '').split('/').pop() ?? '');
  if (/\bvendors?\b|\bsuppliers?\b/.test(n)) return 'vendor';
  if (/\bfixed\b|\brecurring\b/.test(n)) return 'recurring';
  if (/\bbank\b|\bstatement\b|\btransactions\b/.test(n)) return 'bank_line';
  if (/\bsales\b|\bregister\b|\bdaily\b|\bz report\b/.test(n)) return 'sales_day';
  if (/\bbills?\b|\binvoices?\b|\bap\b/.test(n)) return 'bill';
  return null;
}

/** Best guess from the header row when the name doesn't say. */
export function kindFromHeader(head: string[]): ImportKind | null {
  const h = new Set(head.map(norm));
  const has = (...a: string[]) => a.some((x) => h.has(x));
  if (has('gross sales', 'gross', 'net sales', 'cash', 'card', 'credit card') && has('date', 'business date')) return 'sales_day';
  if (has('vendor', 'supplier', 'company', 'payee') && has('amount', 'total', 'invoice amount') && has('date', 'bill date', 'invoice date')) return 'bill';
  if (has('description', 'memo', 'details') && has('debit', 'credit', 'amount') && has('date', 'posted', 'posting date')) return 'bank_line';
  if (has('day', 'day of month', 'due day') && has('amount', 'monthly amount', 'cost')) return 'recurring';
  if (has('name', 'vendor', 'company') && has('email', 'phone', 'terms', 'contact', 'payment terms')) return 'vendor';
  return null;
}

/** Splits a sheet with a Type column into one sheet per kind (same header row). */
export function splitByType(rows: string[][]): { tables: Map<ImportKind, string[][]>; lines: Map<ImportKind, number[]>; errors: { line: number; message: string }[] } | null {
  const [head, ...body] = rows;
  if (!head) return null;
  const t = head.map(norm).findIndex((x) => TYPE_HEADERS.includes(x));
  if (t < 0) return null;
  const tables = new Map<ImportKind, string[][]>();
  // The original line of each sub-table row, so messages point at the real line (#146).
  const lines = new Map<ImportKind, number[]>();
  const errors: { line: number; message: string }[] = [];
  body.forEach((r, i) => {
    if (r.every((c) => !c?.trim())) return;
    const k = kindFromWord(r[t] ?? '');
    if (!k) { errors.push({ line: i + 2, message: `Type “${(r[t] ?? '').trim() || '(empty)'}” isn’t one of: Vendor, Bill, Sales, Bank, Fixed cost` }); return; }
    if (!tables.has(k)) { tables.set(k, [head]); lines.set(k, []); }
    tables.get(k)!.push(r);
    lines.get(k)!.push(i + 2);
  });
  return { tables, lines, errors };
}

/** Every table → import rows for every kind, with errors naming the file. */
export function planFromTables(tables: Table[], opts: { today: string; timeZone?: string }): BundlePlan {
  const out: BundlePlan = { rows: {}, errors: [], notes: [] };
  const add = (kind: ImportKind, rows: Row[]) => { out.rows[kind] = [...(out.rows[kind] ?? []), ...rows]; };
  for (const tb of tables) {
    if (tb.rows.length < 2) { out.notes.push(`${tb.name}: empty, skipped.`); continue; }
    const split = splitByType(tb.rows);
    const parts: [ImportKind, string[][]][] = split ? [...split.tables.entries()] : [];
    if (split) for (const e of split.errors) out.errors.push({ line: e.line, message: `${tb.name}: ${e.message}` });
    if (!split) {
      const kind = kindFromName(tb.name) ?? kindFromHeader(tb.rows[0]);
      if (!kind) {
        out.errors.push({ line: 1, message: `${tb.name}: can’t tell what this sheet holds. Add a “Type” column, or name the file vendors, bills, sales, bank or fixed costs.` });
        continue;
      }
      parts.push([kind, tb.rows]);
    }
    for (const [kind, rows] of parts) {
      const plan = planFromSheet(kind, rows, opts);
      // Sub-table line N is the original sheet's line lines[N - 2].
      const orig = split?.lines.get(kind);
      const real = (n: number) => (orig && n >= 2 ? orig[n - 2] ?? n : n);
      add(kind, plan.rows.map((r) => (typeof r.line === 'number' ? { ...r, line: real(r.line) } : r)));
      for (const e of plan.errors) out.errors.push({ line: real(e.line), message: `${tb.name} line ${real(e.line)} (${KIND_WORD[kind]}): ${e.message}` });
      out.notes.push(`${tb.name}: ${plan.rows.length} ${KIND_WORD[kind].toLowerCase()} row${plan.rows.length === 1 ? '' : 's'}.`);
    }
  }
  return out;
}

/** A one-sheet template with every type, for "Download a template". */
export const TEMPLATE_CSV = [
  'Type,Name,Vendor,Invoice #,Bill date,Due date,Date,Description,Amount,Category,Paid amount,Paid date,Day of month,Contact,Email,Phone,Terms,Register,Gross sales,Discounts,Tax,Cash,Card,Store credit,Transactions',
  'Vendor,Hair Zone,,,,,,,,,,,,Dana,orders@example.com,555-0100,30,,,,,,,,',
  'Bill,,Hair Zone,INV-1001,2026-10-01,2026-10-31,,,1934.00,inventory,1934.00,2026-10-20,,,,,,,,,,,,,',
  'Fixed cost,Rent,,,,,,,2500.00,,,,1,,,,,,,,,,,,',
  'Sales,,,,,,2026-10-02,,,,,,,,,,,All registers,1650.00,0,115.50,700.00,1065.50,0,48',
  'Bank,,,,,,2026-10-05,ACH HAIR ZONE,-1934.00,,,,,,,,,,,,,,,,',
].join('\n') + '\n';
