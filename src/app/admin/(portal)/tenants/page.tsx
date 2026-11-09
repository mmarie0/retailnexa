import type { Metadata } from 'next';
import Link from 'next/link';
import { getAdminContext } from '@/lib/auth/context';
import { Badge, Card, EmptyState, Input, PageHeader, buttonClass } from '@/components/ui';

export const metadata: Metadata = { title: 'Customers' };

export default async function TenantsPage({ searchParams }: PageProps<'/admin/tenants'>) {
  const { supabase } = await getAdminContext();
  const sp = await searchParams;
  const q = typeof sp.q === 'string' ? sp.q.trim().slice(0, 80) : '';
  let query = supabase.from('organizations').select('id, name, business_type, status, created_at, subscriptions(status, trial_end)').order('created_at', { ascending: false }).limit(200);
  if (q) query = query.ilike('name', `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
  const { data } = await query;
  return (
    <>
      <PageHeader title="Customers" />
      <form className="flex gap-2"><Input name="q" defaultValue={q} placeholder="Search business name" aria-label="Search business name" className="max-w-sm" /><button className={buttonClass('secondary')}>Search</button></form>
      {(data ?? []).length === 0 ? <EmptyState title={q ? 'No matching accounts' : 'No accounts yet'} /> : (
        <Card className="p-0">
          <ul className="divide-y divide-line">
            {(data ?? []).map((o) => {
              const sub = (o.subscriptions as unknown as { status: string }[] | { status: string } | null);
              const status = Array.isArray(sub) ? sub[0]?.status : sub?.status;
              return (
                <li key={o.id}>
                  <Link href={`/admin/tenants/${o.id}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 hover:bg-soft">
                    <span><span className="font-bold">{o.name}</span> <span className="text-muted">· {o.business_type} · since {new Date(o.created_at).toLocaleDateString()}</span></span>
                    <span className="flex gap-2">
                      {o.status !== 'active' && <Badge tone="danger">{o.status}</Badge>}
                      <Badge tone={status === 'active' ? 'good' : status === 'trialing' ? 'info' : status ? 'warning' : 'neutral'}>{status ?? 'no plan'}</Badge>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </>
  );
}
