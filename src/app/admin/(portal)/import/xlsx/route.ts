import { NextResponse } from 'next/server';
import { getAdminContext } from '@/lib/auth/context';
import { readWorkbook, WorkbookError } from '@/lib/import/workbook';

/**
 * Reads the first sheet of an Excel file for the admin master import and returns
 * its cells as text. A route of its own (#129) so the 4 MB upload limit applies
 * here only; every Server Action keeps Next's default 1 MB body limit.
 */
const MAX_FILE = 4 * 1024 * 1024;
const MAX_UNZIPPED = 40 * 1024 * 1024; // zip-bomb guard
const MAX_ROWS = 20_000;
const json = (body: object, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(req: Request) {
  const ctx = await getAdminContext();
  if (ctx.role !== 'superadmin' || !ctx.mfaOk) return json({ ok: false, message: 'Only a superadmin with two-factor can import.' }, 403);
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > MAX_FILE + 64 * 1024) return json({ ok: false, message: 'Excel files up to 4 MB. Save larger ones as CSV.' }, 413);
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File) || file.size === 0) return json({ ok: false, message: 'Choose a file.' }, 400);
  if (file.size > MAX_FILE) return json({ ok: false, message: 'Excel files up to 4 MB. Save larger ones as CSV.' }, 413);
  try {
    const buf = await file.arrayBuffer();
    // Refuse archives that would unpack to something huge before exceljs touches them.
    // Only real zips ("PK") get the size check; anything else goes to readWorkbook, which explains .xls or reads a renamed CSV (#150).
    const head = new Uint8Array(buf.slice(0, 2));
    if (head[0] === 0x50 && head[1] === 0x4b) {
      const { default: JSZip } = await import('jszip');
      const zip = await JSZip.loadAsync(buf).catch(() => null);
      let unzipped = 0;
      zip?.forEach((_p, entry) => { unzipped += (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0; });
      if (unzipped > MAX_UNZIPPED) return json({ ok: false, message: 'That workbook is too large to read. Save it as CSV.' }, 413);
    }

    const sheets = await readWorkbook(buf, MAX_ROWS);
    return json({ ok: true, rows: sheets[0]?.rows ?? [], sheets });
  } catch (e) {
    return json({ ok: false, message: e instanceof WorkbookError ? e.message : 'That Excel file couldn’t be read. Open it in Excel and use Save As → CSV, then upload the CSV.' }, 400);
  }
}
