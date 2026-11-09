import type { Metadata } from 'next';
import Link from 'next/link';
import { getAdminContext } from '@/lib/auth/context';
import { Badge, Card, PageHeader, buttonClass } from '@/components/ui';

export const metadata: Metadata = { title: 'Audit log' };
const PAGE = 100;

export default async function AdminAuditPage({ searchParams }: PageProps<'/admin/audit'>) {
  const { supabase } = await getAdminContext();
  const sp = await searchParams;
  const page = Math.max(0, Number(sp.page) || 0);
  const actor = typeof sp.actor === 'string' && ['user', 'platform_admin', 'system', 'stripe'].includes(sp.actor) ? sp.actor : null;
  let q = supabase.from('audit_logs').select('id, created_at, organization_id, actor_user_id, actor_type, action, target_type, target_id, metadata').order('id', { ascending: false }).range(page * PAGE, page * PAGE + PAGE);
  if (actor) q = q.eq('actor_type', actor);
  const { data } = await q;
  const rows = data ?? [];
  return (
    <>
      <PageHeader title="Audit log" description="Every tenant and platform action, newest first." />
      <nav className="flex flex-wrap gap-2 text-sm">
        {[null, 'platform_admin', 'user', 'stripe', 'system'].map((a) => (
          <Link key={a ?? 'all'} href={a ? `/admin/audit?actor=${a}` : '/admin/audit'} className={buttonClass(a === actor ? 'primary' : 'secondary', 'sm')}>{a ?? 'all'}</Link>
        ))}
      </nav>
      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-soft text-left"><tr><th className="px-4 py-2">When</th><th>Actor</th><th>Action</th><th>Account</th><th>Target</th></tr></thead>
          <tbody>
            {rows.slice(0, PAGE).map((r) => (
              <tr key={r.id} className="border-t border-line align-top">
                <td className="px-4 py-2">{new Date(r.created_at).toLocaleString()}</td>
                <td><Badge tone={r.actor_type === 'platform_admin' ? 'warning' : 'neutral'}>{r.actor_type}</Badge></td>
                <td className="font-semibold">{r.action}</td>
                <td>{r.organization_id ? <Link className="text-accent-strong underline" href={`/admin/tenants/${r.organization_id}`}>open</Link> : '—'}</td>
                <td className="text-muted">{r.target_type ? `${r.target_type} ${r.target_id ?? ''}` : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <div className="flex gap-2">
        {page > 0 && <Link className={buttonClass('secondary', 'sm')} href={`/admin/audit?page=${page - 1}${actor ? `&actor=${actor}` : ''}`}>Newer</Link>}
        {rows.length > PAGE && <Link className={buttonClass('secondary', 'sm')} href={`/admin/audit?page=${page + 1}${actor ? `&actor=${actor}` : ''}`}>Older</Link>}
      </div>
    </>
  );
}
