import type { Metadata } from 'next';
import Link from 'next/link';
import { can, getOrgContext, getSupabase } from '@/lib/auth/context';
import { Badge, Card, EmptyState, Notice, PageHeader, buttonClass } from '@/components/ui';

export const metadata: Metadata = { title: 'Audit log' };
const PAGE = 50;

export default async function AuditPage({ searchParams }: PageProps<'/app/audit'>) {
  const ctx = await getOrgContext();
  if (!can(ctx, 'audit.view')) return <Notice tone="warning">You don’t have access to the audit log.</Notice>;
  const sp = await searchParams;
  const page = Math.max(0, Number(sp.page) || 0);
  const supabase = await getSupabase();
  const { data: rows } = await supabase.from('audit_logs').select('id, created_at, actor_user_id, actor_type, action, target_type, metadata')
    .eq('organization_id', ctx.org.id).order('id', { ascending: false }).range(page * PAGE, page * PAGE + PAGE);
  const list = rows ?? [];
  const actorIds = [...new Set(list.map((r) => r.actor_user_id).filter(Boolean))] as string[];
  const { data: profiles } = actorIds.length ? await supabase.from('profiles').select('id, email, full_name').in('id', actorIds) : { data: [] };
  const who = (r: (typeof list)[number]) => {
    if (r.actor_type === 'stripe') return 'Stripe';
    if (r.actor_type === 'system') return 'System';
    if (r.actor_type === 'platform_admin') return 'RetailNexa support';
    const p = (profiles ?? []).find((x) => x.id === r.actor_user_id);
    return p?.full_name || p?.email || 'Team member';
  };
  return (
    <>
      <PageHeader title="Audit log" description="A permanent record of changes to this business. Entries can’t be edited or deleted by anyone." />
      {list.length === 0 ? <EmptyState title="No activity yet" /> : (
        <Card className="p-0">
          <ul className="divide-y divide-line">
            {list.slice(0, PAGE).map((r) => (
              <li key={r.id} className="flex flex-col gap-1 px-5 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={r.actor_type === 'platform_admin' ? 'warning' : 'neutral'}>{r.action}</Badge>
                  <span className="font-semibold">{who(r)}</span>
                  <span className="text-sm text-muted">{new Date(r.created_at).toLocaleString()}</span>
                </div>
                {r.metadata && Object.keys(r.metadata).length > 0 && (
                  <details><summary className="cursor-pointer text-sm text-muted">Details</summary><pre className="mt-1 overflow-x-auto rounded-lg bg-soft p-2 text-xs">{JSON.stringify(r.metadata, null, 2)}</pre></details>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
      <div className="flex gap-2">
        {page > 0 && <Link className={buttonClass('secondary', 'sm')} href={`/app/audit?page=${page - 1}`}>Newer</Link>}
        {list.length > PAGE && <Link className={buttonClass('secondary', 'sm')} href={`/app/audit?page=${page + 1}`}>Older</Link>}
      </div>
    </>
  );
}
