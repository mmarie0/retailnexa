/**
 * Reads an uploaded workbook into tabs of text cells: exceljs first, then the
 * forgiving reader (xlsx-lite) if exceljs fails. Explains the usual reasons a
 * file can't be read instead of a generic error.
 */
import { cellText } from './cell';
import { LiteLimitError, readXlsxLite, type LiteSheet } from './xlsx-lite';
import { parseCsv } from '@/lib/sales/csv';

export class WorkbookError extends Error {}

export async function readWorkbook(buf: ArrayBuffer, maxRows = 20_000): Promise<LiteSheet[]> {
  const head = new Uint8Array(buf.slice(0, 8));
  // Old Excel 97–2003 (.xls) and other OLE files start with D0 CF 11 E0.
  if (head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0) {
    throw new WorkbookError('This is an old .xls file (or it has a password). Open it in Excel and use Save As → Excel Workbook (.xlsx) or CSV.');
  }
  // Not a zip at all: often a CSV that was renamed to .xlsx.
  if (!(head[0] === 0x50 && head[1] === 0x4b)) {
    const text = new TextDecoder().decode(buf.slice(0, 2_000_000));
    if (/[,;\t]/.test(text.split(/\r?\n/)[0] ?? '') && !/\u0000/.test(text)) return [{ name: 'Sheet1', rows: parseCsv(text).slice(0, maxRows + 1) }];
    throw new WorkbookError('This file isn’t an Excel workbook. Save it as .xlsx or CSV and try again.');
  }
  try {
    const { Workbook } = await import('exceljs');
    const wb = new Workbook();
    await wb.xlsx.load(buf);
    let total = 0;
    const sheets = wb.worksheets.filter((ws) => ws.state !== 'hidden' && ws.state !== 'veryHidden').map((ws) => {
      const rows: string[][] = [];
      ws.eachRow({ includeEmpty: false }, (row) => {
        if (total < maxRows + 1) { rows.push((row.values as unknown[]).slice(1).map(cellText)); total++; }
      });
      return { name: ws.name, rows };
    });
    if (sheets.some((s) => s.rows.length)) return sheets;
  } catch { /* fall through to the forgiving reader */ }
  try {
    const sheets = await readXlsxLite(buf, maxRows);
    if (!sheets.length) throw new WorkbookError('The workbook has no visible sheets.');
    return sheets;
  } catch (e) {
    if (e instanceof WorkbookError) throw e;
    if (e instanceof LiteLimitError) throw new WorkbookError(`That Excel file can’t be read safely (${e.message}). Open it in Excel and use Save As → CSV, then upload the CSV.`);
    throw new WorkbookError('That Excel file couldn’t be read. Open it in Excel and use Save As → CSV, then upload the CSV.');
  }
}
