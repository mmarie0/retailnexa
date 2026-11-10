import { parseAmount, parseDate, type SalesDayRow } from './import';
import { parseCsv } from './csv';

/**
 * Vela POS "Sales Summary" export → one sales day (#39).
 *
 * The export is a vertical label/value report for one business day, delivered
 * either as an HTML <table> saved with a .xls extension (title
 * "SALES SUMMARY - MM/DD/YYYY~MM/DD/YYYY") or as CSV. Sections:
 *   TRANSACTIONS (FIRST, LAST, COUNT, …), TOTALS (SALES, DISCOUNT, RETURNS,
 *   SUBTOTAL, TAX, SALES TOTAL), PAYMENTS (CASH → SALES/REFUNDS;
 *   CREDIT CARD → SALES, REFUNDS, TOTAL; other tenders), then breakdowns.
 * Counts are written as "(n)" in breakdown sections; they are never read as money.
 */

export interface VelaResult { day: SalesDayRow | null; errors: string[]; warnings: string[] }

const decode = (s: string) => s
  .replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/\s+/g, ' ').trim();

/** Rows of cell text from an HTML table export (no DOM needed, so it runs in tests and on the server). */
export function htmlTableRows(html: string): string[][] {
  const rows: string[][] = [];
  for (const tr of html.match(/<tr[\s\S]*?<\/tr>/gi) ?? []) {
    const cells = (tr.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) ?? []).map(decode);
    if (cells.some((c) => c)) rows.push(cells);
  }
  return rows;
}

export function looksLikeVelaSummary(text: string): boolean {
  const t = text.slice(0, 20_000).toUpperCase();
  return /SALES SUMMARY/.test(t) || (/(^|[\n,>])\s*TRANSACTIONS\s*(,|<)/.test(t) && /TOTALS/.test(t) && /PAYMENTS/.test(t));
}

const SECTION_RE = /^[A-Z][A-Z &/]+$/;
const isCount = (v: string) => /^\(\s*\d+\s*\)$/.test(v.trim());
const CREDIT_TENDERS = /^(GIFT ?CARDS?|STORE CREDIT|HOUSE ACCOUNT|CREDIT VOUCHER)$/;

export function parseVelaSummary(text: string, opts: { timeZone?: string; line?: number } = {}): VelaResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const isHtml = /<table/i.test(text);
  const rows = isHtml ? htmlTableRows(text) : parseCsv(text);

  // Date: title range (must be a single day) or the first transaction time.
  let date: string | null = null;
  const title = /SALES SUMMARY\s*-\s*([\d/]+)\s*~\s*([\d/]+)/i.exec(isHtml ? decode(text) : text);
  if (title) {
    const from = parseDate(title[1]); const to = parseDate(title[2]);
    if (from && to && from !== to) errors.push(`This export covers ${from} to ${to}. Export one day at a time.`);
    date = from;
  }

  let section = '';
  let tender = '';
  const totals: Record<string, number> = {};
  const tenders: Record<string, Record<string, number>> = {};
  let count: number | null = null;
  let firstTxn: string | null = null;

  for (const r of rows) {
    const cells = r.map((c) => (c ?? '').trim());
    const head = cells[0];
    const rest = cells.slice(1).filter((c) => c !== '');
    if (head && SECTION_RE.test(head.toUpperCase()) && rest.length === 0) { section = head.toUpperCase(); tender = ''; continue; }
    if (!rest.length) continue;
    const label = rest[0].toUpperCase();
    const value = rest[rest.length - 1];
    if (section === 'TRANSACTIONS') {
      if (label === 'FIRST') firstTxn = value;
      if (label === 'COUNT' && /^\d+$/.test(value.replace(/,/g, ''))) count = Number(value.replace(/,/g, ''));
      continue;
    }
    if (section === 'TOTALS') {
      if (rest.length === 1) continue;
      const v = parseAmount(value);
      if (v === null) { errors.push(`TOTALS ${label}: “${value}” is not an amount`); continue; }
      totals[label] = v;
      continue;
    }
    if (section === 'PAYMENTS') {
      if (rest.length === 1) { tender = label; tenders[tender] ??= {}; continue; } // tender heading row
      if (!tender) continue;
      if (isCount(value)) continue;
      const v = parseAmount(value);
      if (v === null) { errors.push(`PAYMENTS ${tender} ${label}: “${value}” is not an amount`); continue; }
      tenders[tender][label] = v;
    }
  }

  if (!date && firstTxn) date = parseDate(firstTxn.replace(/^[A-Za-z]{3,9},?\s+/, ''), opts.timeZone);
  if (!date) errors.push('Couldn’t find the report date. Export the Sales Summary for a single day.');
  if (totals.SALES === undefined) errors.push('Couldn’t find TOTALS → SALES.');

  // Tender amounts: prefer TOTAL, else SALES/REFUNDS, else SALES − |REFUNDS|.
  const tenderAmount = (t: Record<string, number>) =>
    t.TOTAL ?? t['SALES/REFUNDS'] ?? ((t.SALES ?? 0) - Math.abs(t.REFUNDS ?? 0));
  let cash = 0, card = 0, credit = 0;
  for (const [name, t] of Object.entries(tenders)) {
    const amt = tenderAmount(t);
    if (name === 'CASH') cash += amt;
    else if (/^(CREDIT ?CARD|DEBIT ?CARD|CARD|CREDIT\/DEBIT)$/.test(name)) card += amt;
    else if (CREDIT_TENDERS.test(name)) credit += amt;
    else if (amt !== 0) errors.push(`Payment type “${name}” isn’t supported yet (${(amt / 100).toFixed(2)}). Enter this day by hand.`);
  }

  const gross = totals.SALES ?? 0;
  const discounts = Math.abs(totals.DISCOUNT ?? totals.DISCOUNTS ?? 0) + Math.abs(totals.RETURNS ?? 0);
  const tax = totals.TAX ?? 0;
  if (gross < 0 || tax < 0 || cash < 0 || card < 0 || credit < 0) errors.push('A total is negative (more refunds than sales). Enter this day by hand.');
  const expected = gross - discounts + tax;
  if (totals['SALES TOTAL'] !== undefined && totals['SALES TOTAL'] !== expected) {
    warnings.push(`Vela’s SALES TOTAL (${(totals['SALES TOTAL'] / 100).toFixed(2)}) differs from sales − discounts − returns + tax (${(expected / 100).toFixed(2)}).`);
  }
  if (cash + card + credit !== expected) {
    errors.push(`Payments ${(cash + card + credit) / 100} don’t equal sales − discounts + tax ${(expected / 100).toFixed(2)}.`);
  }
  if (errors.length || !date) return { day: null, errors, warnings };
  return {
    day: { line: opts.line ?? 1, businessDate: date, register: 'All registers', grossCents: gross, discountsCents: discounts, taxCents: tax,
      cashCents: cash, cardCents: card, creditCents: credit, transactions: count },
    errors, warnings,
  };
}
