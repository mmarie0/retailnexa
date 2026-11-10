/**
 * Reads the master import's "one file" upload into plain tables (and an optional
 * old-app backup). Runs in the browser; Excel is read by a callback (the server
 * route) so this stays testable in Node.
 */
import { parseCsv } from '@/lib/sales/csv';
import type { Table } from './bundle';

export const BUNDLE_LIMITS = { zipBytes: 25 * 1024 * 1024, unzippedBytes: 150 * 1024 * 1024, files: 60 };

export interface ReadResult { tables: Table[]; backups: { name: string; data: unknown }[]; skipped: string[] }

/** Returns every tab of the workbook, named "file › tab" when there's more than one. */
type ExcelReader = (name: string, data: Blob) => Promise<Table[]>;

export async function readBundle(file: File | { name: string; size: number; arrayBuffer(): Promise<ArrayBuffer>; text(): Promise<string> }, readExcel: ExcelReader): Promise<ReadResult> {
  const out: ReadResult = { tables: [], backups: [], skipped: [] };
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.csv') || lower.endsWith('.txt')) { out.tables.push({ name: file.name, rows: parseCsv(await file.text()) }); return out; }
  if (/\.(xlsx|xlsm|xls)$/.test(lower)) { out.tables.push(...await readExcel(file.name, new Blob([await file.arrayBuffer()]))); return out; }
  if (lower.endsWith('.json')) { out.backups.push({ name: file.name, data: JSON.parse(await file.text()) }); return out; }
  if (!lower.endsWith('.zip')) throw new Error('Upload a .csv, an Excel file (.xlsx) or a .zip.');
  if (file.size > BUNDLE_LIMITS.zipBytes) throw new Error('Zip files up to 25 MB.');

  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const entries = Object.values(zip.files).filter((e) => !e.dir && !/(^|\/)(__MACOSX|\.)/.test(e.name));
  if (entries.length > BUNDLE_LIMITS.files) throw new Error(`A zip can hold up to ${BUNDLE_LIMITS.files} files.`);
  const unzipped = entries.reduce((a, e) => a + ((e as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0), 0);
  if (unzipped > BUNDLE_LIMITS.unzippedBytes) throw new Error('That zip unpacks to more than 150 MB. Split it up.');
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const n = e.name.toLowerCase();
    if (n.endsWith('.csv') || n.endsWith('.txt')) out.tables.push({ name: e.name, rows: parseCsv(await e.async('string')) });
    else if (/\.(xlsx|xlsm|xls)$/.test(n)) out.tables.push(...await readExcel(e.name, await e.async('blob')));
    else if (n.endsWith('.json')) {
      try { out.backups.push({ name: e.name, data: JSON.parse(await e.async('string')) }); } catch { throw new Error(`${e.name} isn’t valid JSON.`); }
    } else out.skipped.push(e.name);
  }
  return out;
}
