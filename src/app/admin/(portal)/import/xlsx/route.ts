import { NextResponse } from 'next/server';
import { getAdminContext } from '@/lib/auth/context';
import { cellText } from '@/lib/import/cell';

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
    const { default: JSZip } = await import('jszip');
    const zip = await JSZip.loadAsync(buf);
    let unzipped = 0;
    zip.forEach((_p, entry) => { unzipped += (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0; });
    if (unzipped > MAX_UNZIPPED) return json({ ok: false, message: 'That workbook is too large to read. Save it as CSV.' }, 413);

    const { Workbook } = await import('exceljs');
    const wb = new Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.worksheets[0];
    if (!ws) return json({ ok: false, message: 'The workbook has no sheets.' }, 400);
    const rows: string[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      if (rows.length < MAX_ROWS + 1) rows.push((row.values as unknown[]).slice(1).map(cellText));
    });
    return json({ ok: true, rows });
  } catch {
    return json({ ok: false, message: 'That Excel file couldn’t be read. Try saving it as CSV.' }, 400);
  }
}
