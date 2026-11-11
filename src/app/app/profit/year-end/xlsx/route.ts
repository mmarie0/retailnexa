import { can, getOrgContext } from '@/lib/auth/context';
import { yearEndSheets, yearEndXlsx } from '@/lib/reports/year-end';
import { ExportTooLargeError, yearEndData } from '../_build';

/** #111 Year-end Excel workbook for ?y=YYYY. Needs reports.export; each sheet also needs its own view permission. */
export async function GET(req: Request) {
  const ctx = await getOrgContext();
  if (!can(ctx, 'reports.export')) return new Response('Not allowed', { status: 403 });
  const y = Number(new URL(req.url).searchParams.get('y'));
  const now = new Date().getUTCFullYear();
  if (!Number.isInteger(y) || y < 2000 || y > now) return new Response('Pick a year', { status: 400 });
  let sheets;
  try {
    sheets = yearEndSheets(await yearEndData(ctx, y));
  } catch (e) {
    if (e instanceof ExportTooLargeError) return new Response(e.message, { status: 413, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    throw e;
  }
  if (!sheets.length) return new Response('Nothing you can export', { status: 403 });
  const buf = await yearEndXlsx(`${ctx.org.name} ${y}`, sheets);
  const safe = ctx.org.name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'business';
  return new Response(new Uint8Array(buf), { headers: {
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="${safe}-${y}-year-end.xlsx"`, 'Cache-Control': 'private, no-store',
  } });
}
