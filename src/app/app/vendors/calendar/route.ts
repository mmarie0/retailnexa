import { can, getOrgContext, getSupabase } from '@/lib/auth/context';
import { todayIn } from '@/lib/time';
import { daysInMonth, monthItems, ymAdd, type BillRow, type TemplateRow } from '@/lib/bills/due';
import { icsCalendar } from '@/lib/bills/ics';

/**
 * Vendor calendar (#107), as in the live app's "Calendar" button: an .ics file of
 * what's due (unpaid bills plus recurring bills not created yet) for the next six
 * months, to open in Google Calendar, Apple Calendar or Outlook.
 */
export async function GET() {
  const ctx = await getOrgContext();
  if (!can(ctx, 'bills.view')) return new Response('Not allowed', { status: 403 });
  const supabase = await getSupabase();
  const { data: orgRow } = await supabase.from('organizations').select('timezone').eq('id', ctx.org.id).maybeSingle();
  const today = todayIn(orgRow?.timezone);
  const from = ymAdd(today.slice(0, 7), -1), to = ymAdd(today.slice(0, 7), 5);
  const [{ data: bills }, { data: tpls }, { data: vendors }] = await Promise.all([
    supabase.from('bills').select('id, vendor_id, bill_number, bill_date, due_date, status, total_cents, paid_cents, recurring_bill_id')
      .eq('organization_id', ctx.org.id).in('status', ['draft', 'approved'])
      .gte('due_date', `${from}-01`).lte('due_date', `${to}-${daysInMonth(to)}`).limit(5000),
    supabase.from('recurring_bills').select('id, vendor_id, name, frequency, day_of_month, next_date, end_date, due_days, is_active, lines')
      .eq('organization_id', ctx.org.id).eq('is_active', true),
    supabase.from('vendors').select('id, name').eq('organization_id', ctx.org.id),
  ]);
  const names = new Map((vendors ?? []).map((v) => [v.id, v.name]));
  const templates: TemplateRow[] = ((tpls ?? []) as (Omit<TemplateRow, 'amount_cents'> & { lines: { amount_cents: number }[] })[])
    .map(({ lines, ...t }) => ({ ...t, amount_cents: lines.reduce((a, l) => a + Number(l.amount_cents), 0) }));
  const items = Array.from({ length: 7 }, (_, i) => monthItems(ymAdd(from, i), (bills ?? []) as BillRow[], templates, names, today))
    .flat().filter((i) => i.leftCents > 0);
  const body = icsCalendar(`${ctx.org.name} bills`, items, new Date());
  return new Response(body, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="retailnexa-bills.ics"',
      'Cache-Control': 'private, no-store',
    },
  });
}
