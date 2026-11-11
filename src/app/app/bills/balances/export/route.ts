import { can, getOrgContext } from '@/lib/auth/context';
import { toCsv } from '@/lib/csv-export';
import { DIRECTION_LABEL } from '@/lib/bills/balances';
import { loadBalances } from '../_load';

/** Location balances as CSV (formula-safe cells), one row per balance. */
export async function GET() {
  const ctx = await getOrgContext();
  if (!can(ctx, 'bills.view')) return new Response('Not allowed', { status: 403 });
  const { balances, stores } = await loadBalances(ctx);
  const name = new Map(stores.map((s) => [s.id, s.name]));
  const $ = (c: number) => (c / 100).toFixed(2);
  const csv = toCsv(['Date', 'Who owes whom', 'Other store', 'Your store', 'Counts in month', 'Paid by', 'Amount', 'Paid', 'Left', 'Status', 'Reference', 'Note', 'Lines'],
    [...balances].sort((a, b) => a.entry_date.localeCompare(b.entry_date)).map((b) => [b.entry_date, DIRECTION_LABEL[b.direction], b.other_party, name.get(b.location_id) ?? '',
      b.count_month.slice(0, 7), b.due_date ?? '', $(b.amount_cents), $(b.paid), $(b.left), b.status, b.reference ?? '', b.note ?? '',
      b.lines.map((l) => `${l.description} ${$(Number(l.amount_cents))}`).join('; ')]));
  return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="location-balances.csv"', 'Cache-Control': 'private, no-store' } });
}
