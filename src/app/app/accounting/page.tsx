import type { Metadata } from 'next';
import { can, getOrgContext, getSupabase } from '@/lib/auth/context';
import { Badge, Card, Notice, PageHeader } from '@/components/ui';
import { AccountingTabs, TYPE_LABEL, TYPE_ORDER } from './nav';

export const metadata: Metadata = { title: 'Chart of accounts' };

export default async function ChartOfAccountsPage() {
  const ctx = await getOrgContext();
  if (!can(ctx, 'accounting.view')) return <Notice tone="warning">Only owners, admins and accountants can see the books.</Notice>;
  const supabase = await getSupabase();
  const { data } = await supabase.from('accounts').select('id, code, name, type, is_active, is_system').eq('organization_id', ctx.org.id).order('code');
  const accounts = data ?? [];
  return (
    <>
      <PageHeader title="Accounting" description="Your double-entry books. Every sale, bill and payment will post here automatically as those modules arrive." />
      <AccountingTabs active="/app/accounting" />
      {TYPE_ORDER.map((t) => {
        const rows = accounts.filter((a) => a.type === t);
        if (!rows.length) return null;
        return (
          <Card key={t} className="p-0">
            <h2 className="px-5 pt-4 text-lg font-bold">{TYPE_LABEL[t]}</h2>
            <ul className="mt-2 divide-y divide-line">
              {rows.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                  <span><span className="num mr-3 text-muted">{a.code}</span>{a.name}</span>
                  <span className="flex gap-2">{a.is_system && <Badge>Standard</Badge>}{!a.is_active && <Badge tone="warning">Inactive</Badge>}</span>
                </li>
              ))}
            </ul>
          </Card>
        );
      })}
    </>
  );
}
