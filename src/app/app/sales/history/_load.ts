import 'server-only';
import { getSupabase, type OrgContext } from '@/lib/auth/context';
import { todayIn } from '@/lib/time';
import { monthTotals, type DayRow, type MonthReport } from '@/lib/sales/history';

/** Months with sales for `years` years ending with `lastYear`. */
const MAX_PAGES = 50; // 50,000 daily rows

export async function loadMonths(ctx: OrgContext, years: number, lastYear?: number) {
  const supabase = await getSupabase();
  const { data: org } = await supabase.from('organizations').select('timezone').eq('id', ctx.org.id).maybeSingle();
  const today = todayIn(org?.timezone);
  const endYear = lastYear ?? +today.slice(0, 4);
  const from = `${endYear - years + 1}-01-01`, to = `${endYear}-12-31`;
  const days: DayRow[] = [];
  // Page through daily rows (a few stores × registers × 3 years can pass one page).
  // Past MAX_PAGES we stop and say so on the page rather than under-count quietly.
  let truncated = false;
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data } = await supabase.from('sales_days')
      .select('business_date, location_id, gross_sales_cents, discounts_cents, sales_tax_cents, cash_cents, card_cents, customer_credit_cents, transaction_count')
      .eq('organization_id', ctx.org.id).is('voided_at', null).gte('business_date', from).lte('business_date', to)
      .order('business_date').order('id').range(page * 1000, page * 1000 + 999);
    days.push(...((data ?? []) as DayRow[]));
    if (!data || data.length < 1000) break;
    if (page === MAX_PAGES - 1) truncated = true;
  }
  const [{ data: reports }, { data: locs }] = await Promise.all([
    supabase.from('sales_months').select('location_id, month, sales_cents, gross_cents, tax_cents, cash_cents, card_cents, store_card_cents, points_cents, transactions')
      .eq('organization_id', ctx.org.id).gte('month', from).lte('month', to),
    supabase.rpc('my_locations', { p_org: ctx.org.id }),
  ]);
  return { today, endYear, truncated, months: monthTotals(days, (reports ?? []) as MonthReport[]), stores: (locs ?? []) as { id: string; name: string }[] };
}
