import 'server-only';
import { getSupabase, type OrgContext } from '@/lib/auth/context';
import type { BankLineIn } from '@/lib/bank/checks';

type Sb = Awaited<ReturnType<typeof getSupabase>>;
/** Page through a query in 1,000s (the API returns at most 1,000 rows per read). */
export async function pageAll<T>(read: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>, max = 20): Promise<T[]> {
  const out: T[] = [];
  for (let p = 0; p < max; p++) {
    const { data, error } = await read(p * 1000, p * 1000 + 999);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

export async function bankLines(sb: Sb, ctx: OrgContext, from: string, to: string) {
  return pageAll<BankLineIn>((a, b) => sb.from('bank_lines').select('id, posted_on, description, amount_cents, status, journal_entry_id')
    .eq('organization_id', ctx.org.id).gte('posted_on', from).lte('posted_on', to).order('posted_on').order('id').range(a, b));
}
