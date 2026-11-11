import 'server-only';
import { getSupabase, type OrgContext } from '@/lib/auth/context';
import { todayIn } from '@/lib/time';
import { withPayments, type BalancePayment, type BalanceRow } from '@/lib/bills/balances';

/** Every location balance this person may see, with payments (paged; the API returns at most 1,000 rows per read). */
export async function loadBalances(ctx: OrgContext) {
  const supabase = await getSupabase();
  const { data: org } = await supabase.from('organizations').select('timezone').eq('id', ctx.org.id).maybeSingle();
  const today = todayIn(org?.timezone);
  const page = async <T,>(table: 'location_balances' | 'location_balance_payments', cols: string) => {
    const out: T[] = [];
    for (let p = 0; p < 20; p++) {
      const { data, error } = await supabase.from(table).select(cols).eq('organization_id', ctx.org.id).order('id').range(p * 1000, p * 1000 + 999);
      if (error) throw error;
      out.push(...((data ?? []) as T[]));
      if (!data || data.length < 1000) break;
    }
    return out;
  };
  const [rows, pays, { data: locs }] = await Promise.all([
    page<BalanceRow>('location_balances', 'id, direction, location_id, other_party, entry_date, due_date, count_month, amount_cents, lines, reference, note'),
    page<BalancePayment>('location_balance_payments', 'id, balance_id, paid_on, amount_cents, method, reference'),
    supabase.rpc('my_locations', { p_org: ctx.org.id }),
  ]);
  return { today, balances: withPayments(rows, pays, today), stores: (locs ?? []) as { id: string; name: string }[] };
}
