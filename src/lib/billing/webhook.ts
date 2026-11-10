import type Stripe from 'stripe';
import { productsFromPrices, type PriceIds } from './plans';

/**
 * Stripe webhook processing, independent of HTTP and of the database client so
 * it can be unit-tested with fakes.
 *
 * Design:
 *  - Idempotent: every event id is claimed in stripe_events first; finished
 *    duplicates are acknowledged without reprocessing, in-flight ones get a
 *    retryable answer, failed or stalled ones are re-processed.
 *  - Order-independent: we never trust the (possibly stale) object embedded in
 *    the event. We re-fetch the subscription from Stripe and mirror it.
 *  - Tenant-safe: subscriptions are mapped to organizations through our own
 *    billing_accounts table (created server-side before Checkout). Metadata is
 *    only used to link a customer that is not yet linked, and a mismatch is
 *    treated as an error, never silently accepted.
 */
export interface WebhookDeps {
  prices: PriceIds;
  now(): Date;
  retrieveSubscription(id: string): Promise<Stripe.Subscription>;
  /** claimed = process it now; done = already processed/ignored; in_flight = another attempt holds a fresh lock. */
  claimEvent(id: string, type: string, createdAt: Date): Promise<ClaimState>;
  finishEvent(id: string, status: 'processed' | 'ignored' | 'failed', error?: string): Promise<void>;
  findOrgByCustomer(customerId: string): Promise<string | null>;
  orgExists(orgId: string): Promise<boolean>;
  /** Links customer to org if the org has none; returns the customer id stored for the org. */
  linkCustomer(orgId: string, customerId: string, email: string | null): Promise<string>;
  syncSubscription(orgId: string, payload: SubscriptionPayload, eventId: string | null): Promise<string>;
  audit(orgId: string | null, action: string, metadata: Record<string, unknown>): Promise<void>;
}

export type ClaimState = 'claimed' | 'done' | 'in_flight';

export interface SubscriptionPayload {
  stripe_subscription_id: string;
  stripe_customer_id: string;
  status: Stripe.Subscription.Status;
  products: string[];
  price_ids: string[];
  extra_locations: number;
  trial_start: string | null;
  trial_end: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  cancel_at: string | null;
  canceled_at: string | null;
  ended_at: string | null;
  synced_at: string;
}

const iso = (t: number | null | undefined) => (t ? new Date(t * 1000).toISOString() : null);
const idOf = (v: string | { id: string } | null | undefined) => (v == null ? null : typeof v === 'string' ? v : v.id);

export function subscriptionPayload(sub: Stripe.Subscription, prices: PriceIds, now: Date): SubscriptionPayload {
  const items = sub.items.data.map((i) => ({ priceId: i.price.id, quantity: i.quantity ?? 1 }));
  const { products, extraLocations } = productsFromPrices(items, prices);
  const starts = sub.items.data.map((i) => i.current_period_start).filter(Boolean);
  const ends = sub.items.data.map((i) => i.current_period_end).filter(Boolean);
  return {
    stripe_subscription_id: sub.id,
    stripe_customer_id: idOf(sub.customer)!,
    status: sub.status,
    products,
    price_ids: items.map((i) => i.priceId),
    extra_locations: extraLocations,
    trial_start: iso(sub.trial_start),
    trial_end: iso(sub.trial_end),
    current_period_start: starts.length ? iso(Math.min(...starts)) : null,
    current_period_end: ends.length ? iso(Math.max(...ends)) : null,
    cancel_at_period_end: sub.cancel_at_period_end,
    cancel_at: iso(sub.cancel_at),
    canceled_at: iso(sub.canceled_at),
    ended_at: iso(sub.ended_at),
    synced_at: now.toISOString(),
  };
}

export class WebhookSecurityError extends Error {}

async function resolveOrg(deps: WebhookDeps, customerId: string, metadataOrg: string | undefined, email: string | null) {
  const linked = await deps.findOrgByCustomer(customerId);
  if (linked) {
    if (metadataOrg && metadataOrg !== linked) {
      throw new WebhookSecurityError(`customer ${customerId} belongs to a different organization than its metadata`);
    }
    return linked;
  }
  if (!metadataOrg || !(await deps.orgExists(metadataOrg))) return null;
  const stored = await deps.linkCustomer(metadataOrg, customerId, email);
  if (stored !== customerId) {
    throw new WebhookSecurityError(`organization ${metadataOrg} is already linked to another Stripe customer`);
  }
  return metadataOrg;
}

export async function syncFromStripe(deps: WebhookDeps, subscriptionId: string, eventId: string | null, expectedOrg?: string) {
  const sub = await deps.retrieveSubscription(subscriptionId);
  const customerId = idOf(sub.customer)!;
  const org = await resolveOrg(deps, customerId, sub.metadata?.organization_id, null);
  if (!org) return { outcome: 'ignored' as const, detail: 'subscription not linked to an organization' };
  if (expectedOrg && expectedOrg !== org) {
    throw new WebhookSecurityError('checkout session organization does not match subscription organization');
  }
  const result = await deps.syncSubscription(org, subscriptionPayload(sub, deps.prices, deps.now()), eventId);
  return { outcome: 'processed' as const, detail: result, org };
}

export type HandleResult = { outcome: 'processed' | 'ignored' | 'duplicate' | 'in_flight'; detail?: string };

/** HTTP status for a handled event: in-flight deliveries get 409 so Stripe redelivers (#12). */
export function webhookHttpStatus(r: HandleResult): 200 | 409 {
  return r.outcome === 'in_flight' ? 409 : 200;
}

export async function handleStripeEvent(event: Stripe.Event, deps: WebhookDeps): Promise<HandleResult> {
  const claim = await deps.claimEvent(event.id, event.type, new Date(event.created * 1000));
  if (claim === 'done') return { outcome: 'duplicate' };
  // Another attempt is still working on it. Don't acknowledge: if that attempt dies,
  // Stripe's retry must reach us (#12). The route answers 409.
  if (claim === 'in_flight') return { outcome: 'in_flight' };

  try {
    const result = await dispatch(event, deps);
    await deps.finishEvent(event.id, result.outcome === 'ignored' ? 'ignored' : 'processed');
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await deps.finishEvent(event.id, 'failed', message);
    if (err instanceof WebhookSecurityError) await deps.audit(null, 'billing.webhook_security_error', { event: event.id, message });
    throw err;
  }
}

async function dispatch(event: Stripe.Event, deps: WebhookDeps): Promise<HandleResult> {
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded': {
      const s = event.data.object;
      if (s.mode !== 'subscription' || !s.subscription) return { outcome: 'ignored', detail: 'not a subscription checkout' };
      const r = await syncFromStripe(deps, idOf(s.subscription)!, event.id, s.client_reference_id ?? undefined);
      return { outcome: r.outcome, detail: r.detail };
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
    case 'customer.subscription.paused':
    case 'customer.subscription.resumed':
    case 'customer.subscription.trial_will_end': {
      const r = await syncFromStripe(deps, event.data.object.id, event.id);
      if (event.type === 'customer.subscription.trial_will_end' && r.outcome === 'processed') {
        await deps.audit(r.org ?? null, 'billing.trial_will_end', { subscription: event.data.object.id });
      }
      return { outcome: r.outcome, detail: r.detail };
    }
    case 'invoice.paid':
    case 'invoice.payment_failed':
    case 'invoice.payment_action_required': {
      const inv = event.data.object;
      const subId = idOf(inv.parent?.subscription_details?.subscription ?? null);
      if (!subId) return { outcome: 'ignored', detail: 'invoice not tied to a subscription' };
      const r = await syncFromStripe(deps, subId, event.id);
      if (r.outcome === 'processed' && event.type !== 'invoice.paid') {
        await deps.audit(r.org ?? null, `billing.${event.type.replace('invoice.', '')}`, {
          invoice: inv.id, amount_due: inv.amount_due, attempt_count: inv.attempt_count,
        });
      }
      return { outcome: r.outcome, detail: r.detail };
    }
    default:
      return { outcome: 'ignored', detail: `unhandled event type ${event.type}` };
  }
}
