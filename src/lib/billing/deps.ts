import 'server-only';
import { getStripe } from './stripe';
import { stripeEnv } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase/admin';
import type { WebhookDeps } from './webhook';

/** Production wiring of the webhook/sync dependencies (Stripe API + service-role DB). */
export function liveWebhookDeps(): WebhookDeps {
  const stripe = getStripe();
  const db = createAdminClient();
  const must = <T,>(r: { data: T; error: unknown }) => {
    if (r.error) throw r.error;
    return r.data;
  };
  return {
    prices: stripeEnv().prices,
    now: () => new Date(),
    retrieveSubscription: (id) => stripe.subscriptions.retrieve(id),
    claimEvent: async (id, type, createdAt) =>
      must(await db.rpc('claim_stripe_event', { p_id: id, p_type: type, p_created: createdAt.toISOString() })) as boolean,
    finishEvent: async (id, status, error) => {
      must(await db.rpc('finish_stripe_event', { p_id: id, p_status: status, p_error: error ?? null }));
    },
    findOrgByCustomer: async (customerId) => {
      const row = must(await db.from('billing_accounts').select('organization_id').eq('stripe_customer_id', customerId).maybeSingle());
      return (row as { organization_id: string } | null)?.organization_id ?? null;
    },
    orgExists: async (orgId) => {
      if (!/^[0-9a-f-]{36}$/i.test(orgId)) return false;
      const row = must(await db.from('organizations').select('id').eq('id', orgId).maybeSingle());
      return !!row;
    },
    linkCustomer: async (orgId, customerId, email) =>
      must(await db.rpc('link_billing_customer', { p_org: orgId, p_customer: customerId, p_email: email })) as string,
    syncSubscription: async (orgId, payload, eventId) =>
      must(await db.rpc('sync_subscription', { p_org: orgId, p: payload, p_event_id: eventId })) as string,
    audit: async (orgId, action, metadata) => {
      must(await db.from('audit_logs').insert({ organization_id: orgId, actor_type: 'stripe', action, metadata }));
    },
  };
}
