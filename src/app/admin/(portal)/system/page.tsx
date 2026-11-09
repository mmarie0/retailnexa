import type { Metadata } from 'next';
import { getAdminContext } from '@/lib/auth/context';
import { Badge, Card, PageHeader } from '@/components/ui';
import { cronSecret, isStripeConfigured, isSupabaseConfigured } from '@/lib/env';

export const metadata: Metadata = { title: 'System health' };

export default async function SystemPage() {
  const { supabase } = await getAdminContext();
  const { data: failed } = await supabase.from('stripe_events').select('id, type, attempts, last_error, received_at').in('status', ['failed', 'processing']).order('received_at', { ascending: false }).limit(50);
  const checks = [
    ['Supabase (database and sign-in)', isSupabaseConfigured()],
    ['Supabase service key (webhooks, leads)', !!process.env.SUPABASE_SERVICE_ROLE_KEY],
    ['Stripe billing', isStripeConfigured()],
    ['Scheduled jobs secret (CRON_SECRET)', !!cronSecret()],
  ] as const;
  return (
    <>
      <PageHeader title="System health" description="Integration configuration and background work that needs attention." />
      <Card>
        <h2 className="mb-2 font-bold">Integrations</h2>
        <ul className="divide-y divide-line">{checks.map(([label, okay]) => <li key={label} className="flex justify-between py-2"><span>{label}</span>{okay ? <Badge tone="good">Configured</Badge> : <Badge tone="danger">Missing</Badge>}</li>)}</ul>
      </Card>
      <Card>
        <h2 className="mb-2 font-bold">Billing events needing attention</h2>
        {(failed ?? []).length === 0 ? <p className="text-muted">None. Every Stripe event has been processed.</p> : (
          <ul className="divide-y divide-line text-sm">
            {(failed ?? []).map((e) => <li key={e.id} className="py-2"><strong>{e.type}</strong> · {e.id} · {e.attempts} attempt(s) · {new Date(e.received_at).toLocaleString()}<span className="block text-late">{e.last_error}</span></li>)}
          </ul>
        )}
        <p className="mt-3 text-sm text-muted">Stripe retries failed deliveries automatically for up to 3 days, and the daily reconcile job re-syncs every subscription.</p>
      </Card>
    </>
  );
}
