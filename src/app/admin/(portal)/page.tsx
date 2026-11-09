import { requestNow } from '@/lib/time';
import Link from 'next/link';
import { getAdminContext } from '@/lib/auth/context';
import { KpiTile } from '@/components/data/kpi-tile';
import { Card, PageHeader } from '@/components/ui';
import { formatMoney } from '@/lib/billing/plans';
import { revenueSummary } from '@/lib/billing/revenue';

export default async function AdminHome() {
  const { supabase } = await getAdminContext();
  const soon = new Date(requestNow() + 3 * 86_400_000).toISOString();
  const weekAgo = new Date(requestNow() - 7 * 86_400_000).toISOString();
  const [orgs, subs, endingTrials, leads, failed] = await Promise.all([
    supabase.from('organizations').select('status'),
    supabase.from('subscriptions').select('status, products, extra_locations, cancel_at_period_end'),
    supabase.from('subscriptions').select('organization_id, trial_end').eq('status', 'trialing').lte('trial_end', soon).order('trial_end'),
    supabase.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'new'),
    supabase.from('stripe_events').select('id', { count: 'exact', head: true }).eq('status', 'failed').gte('received_at', weekAgo),
  ]);
  const r = revenueSummary(subs.data ?? []);
  const byStatus = (s: string) => (orgs.data ?? []).filter((o) => o.status === s).length;
  return (
    <>
      <PageHeader title="Platform overview" description="Revenue figures use list prices from the plan catalog and exclude discounts and tax." />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile size="lg" tone="indigo" label="Monthly recurring revenue" value={formatMoney(r.mrrCents)} footnote={`${r.paying} paying accounts`} />
        <KpiTile size="lg" tone="blue" label="In free trial" value={String(r.trialing)} footnote={`${formatMoney(r.trialPipelineCents)}/mo if all convert`} />
        <KpiTile size="lg" tone="coral" label="Payment failed" value={String(r.pastDue)} footnote={`${formatMoney(r.churningCents)}/mo scheduled to cancel`} />
        <KpiTile size="lg" tone="lav" label="New leads" value={String(leads.count ?? 0)} footnote={<Link href="/admin/leads" className="underline">Review leads</Link> } />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <KpiTile label="Accounts" value={String(orgs.data?.length ?? 0)} footnote={`${byStatus('suspended')} suspended · ${byStatus('closed')} closed`} />
        <KpiTile label="Trials ending in 3 days" value={String(endingTrials.data?.length ?? 0)} />
        <KpiTile label="Failed billing events (7 days)" value={String(failed.count ?? 0)} footnote="See System health" />
      </div>
      {(endingTrials.data ?? []).length > 0 && (
        <Card>
          <h2 className="mb-2 font-bold">Trials ending soon</h2>
          <ul className="divide-y divide-line">
            {(endingTrials.data ?? []).map((t) => (
              <li key={t.organization_id} className="flex justify-between py-2"><Link href={`/admin/tenants/${t.organization_id}`} className="font-semibold text-accent-strong">Open account</Link><span>{new Date(t.trial_end).toLocaleString()}</span></li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
