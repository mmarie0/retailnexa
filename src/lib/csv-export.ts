/**
 * CSV export helpers (#27 L1). Every CSV/XLSX export must build cells with
 * csvCell(): it quotes the value and neutralizes spreadsheet formulas, so text
 * that came from an import (register names, categories, file names, memos)
 * can't run as a formula when the file is opened in Excel or Sheets.
 */
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  if (value == null) return '';
  let s = typeof value === 'number' || typeof value === 'bigint' ? String(value) : String(value);
  // Numbers are safe as-is (a leading "-" is a negative amount, not a formula).
  if (typeof value !== 'number' && typeof value !== 'bigint' && FORMULA_START.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvRow(values: unknown[]): string {
  return values.map(csvCell).join(',');
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [csvRow(header), ...rows.map(csvRow)].join('\r\n') + '\r\n';
}
