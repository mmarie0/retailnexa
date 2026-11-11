import 'server-only';
import { getSupabase, type OrgContext } from '@/lib/auth/context';
import type { BankLineIn } from '@/lib/bank/checks';

type Sb = Awaited<ReturnType<typeof getSupabase>>;
export { pageAll } from '@/lib/page-all';
import { pageAll } from '@/lib/page-all';

export async function bankLines(sb: Sb, ctx: OrgContext, from: string, to: string) {
  return pageAll<BankLineIn>((a, b) => sb.from('bank_lines').select('id, posted_on, description, amount_cents, status, journal_entry_id')
    .eq('organization_id', ctx.org.id).gte('posted_on', from).lte('posted_on', to).order('posted_on').order('id').range(a, b));
}
