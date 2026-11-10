import type { Metadata } from 'next';
import { getAdminContext } from '@/lib/auth/context';
import { Card, Notice, PageHeader } from '@/components/ui';
import { ImportClient } from './import-client';

export const metadata: Metadata = { title: 'Master import' };

export default async function MasterImportPage() {
  const ctx = await getAdminContext();
  if (ctx.role !== 'superadmin') return <Notice tone="warning">Only a superadmin can import data.</Notice>;
  const [{ data: orgs }, { data: runs }] = await Promise.all([
    ctx.supabase.from('organizations').select('id, name, status').neq('status', 'closed').order('name').limit(500),
    ctx.supabase.from('import_runs').select('id, organization_id, kind, source, file_name, dry_run, imported, skipped, failed, created_at').order('created_at', { ascending: false }).limit(20),
  ]);
  const orgName = new Map((orgs ?? []).map((o) => [o.id, o.name]));
  return (
    <>
      <PageHeader title="Master import" description="Load a business’s data from the old RetailNexa app or from spreadsheets. Every row goes through the same checks as the business’s own screens, and a check run comes first." />
      <Notice tone="info">The business must give HQ support access first (its owner: Settings → Support access). Everything you import is recorded under your name, not the owner’s.</Notice>
      <ImportClient orgs={(orgs ?? []).map((o) => ({ id: o.id, name: o.name }))} />
      <Card>
        <h2 className="mb-2 font-bold">Recent imports</h2>
        {(runs ?? []).length === 0 ? <p className="text-muted">None yet.</p> : (
          <ul className="divide-y divide-line text-sm">
            {(runs ?? []).map((r) => (
              <li key={r.id} className="flex flex-wrap justify-between gap-2 py-2">
                <span><strong>{orgName.get(r.organization_id) ?? 'Business'}</strong> · {r.kind} · {r.file_name ?? r.source}{r.dry_run ? ' · check only' : ''}</span>
                <span className="num">{r.imported} in · {r.skipped} skipped · {r.failed} failed · {new Date(r.created_at).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
