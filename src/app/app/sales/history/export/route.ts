import { can, getOrgContext } from '@/lib/auth/context';
import { toCsv } from '@/lib/csv-export';
import { avgSale } from '@/lib/sales/history';
import { loadMonths } from '../_load';

/** Monthly sales as CSV (formula-safe cells). ?y=2026 for one year, otherwise the last 3 years. */
export async function GET(req: Request) {
  const ctx = await getOrgContext();
  if (!can(ctx, 'sales.view')) return new Response('Not allowed', { status: 403 });
  const y = Number(new URL(req.url).searchParams.get('y'));
  const one = Number.isInteger(y) && y >= 2000 && y <= 2100;
  const { months } = await loadMonths(ctx, one ? 1 : 3, one ? y : undefined);
  const $ = (c: number) => (c / 100).toFixed(2);
  const csv = toCsv(['Month', 'Sales', 'Gross', 'Tax', 'Cash', 'Card', 'Store card', 'Points', 'Transactions', 'Average sale', 'Source'],
    [...months].reverse().map((m) => [m.ym, $(m.sales), $(m.gross), $(m.tax), $(m.cash), $(m.card), $(m.storeCard), $(m.points), m.transactions ?? '', avgSale(m) === null ? '' : $(avgSale(m)!),
      m.source === 'report' ? 'Monthly report' : m.source === 'daily' ? 'Daily reports' : 'Both']));
  return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="sales-by-month${one ? `-${y}` : ''}.csv"`, 'Cache-Control': 'private, no-store' } });
}
