import { describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';
import { handleStripeEvent, subscriptionPayload, type WebhookDeps } from './webhook';

const prices = { retail: 'price_r', retailExtraLocation: 'price_rx', wholesale: 'price_w' };
const NOW = new Date('2026-11-09T12:00:00Z');

function subscription(over: Partial<Stripe.Subscription> = {}): Stripe.Subscription {
  return {
    id: 'sub_1',
    object: 'subscription',
    customer: 'cus_1',
    status: 'trialing',
    metadata: { organization_id: 'org_A' },
    trial_start: 1762560000,
    trial_end: 1763164800,
    cancel_at_period_end: false,
    cancel_at: null,
    canceled_at: null,
    ended_at: null,
    items: {
      object: 'list',
      data: [
        { price: { id: 'price_r' }, quantity: 1, current_period_start: 1762560000, current_period_end: 1763164800 },
        { price: { id: 'price_rx' }, quantity: 2, current_period_start: 1762560000, current_period_end: 1763164800 },
      ],
    },
    ...over,
  } as unknown as Stripe.Subscription;
}

function event(type: string, object: unknown, id = 'evt_1'): Stripe.Event {
  return { id, type, created: 1762560000, data: { object } } as unknown as Stripe.Event;
}

function deps(over: Partial<WebhookDeps> = {}) {
  const claimed = new Set<string>();
  const d: WebhookDeps = {
    prices,
    now: () => NOW,
    retrieveSubscription: vi.fn(async () => subscription()),
    claimEvent: vi.fn(async (id) => (claimed.has(id) ? false : (claimed.add(id), true))),
    finishEvent: vi.fn(async () => {}),
    findOrgByCustomer: vi.fn(async (c) => (c === 'cus_1' ? 'org_A' : null)),
    orgExists: vi.fn(async () => true),
    linkCustomer: vi.fn(async (_o, c) => c),
    syncSubscription: vi.fn(async () => 'synced'),
    audit: vi.fn(async () => {}),
    ...over,
  };
  return d;
}

describe('subscriptionPayload', () => {
  it('maps prices to products and extra locations, and timestamps to ISO', () => {
    const p = subscriptionPayload(subscription(), prices, NOW);
    expect(p.products).toEqual(['retail']);
    expect(p.extra_locations).toBe(2);
    expect(p.trial_end).toBe('2025-11-15T00:00:00.000Z');
    expect(p.current_period_end).toBe('2025-11-15T00:00:00.000Z');
    expect(p.synced_at).toBe(NOW.toISOString());
  });
});

describe('handleStripeEvent', () => {
  it('re-fetches the subscription from Stripe instead of trusting the event payload', async () => {
    const d = deps();
    const stale = subscription({ status: 'active' });
    await handleStripeEvent(event('customer.subscription.updated', stale), d);
    expect(d.retrieveSubscription).toHaveBeenCalledWith('sub_1');
    expect(d.syncSubscription).toHaveBeenCalledWith('org_A', expect.objectContaining({ status: 'trialing' }), 'evt_1');
    expect(d.finishEvent).toHaveBeenCalledWith('evt_1', 'processed');
  });

  it('acknowledges duplicate deliveries without reprocessing', async () => {
    const d = deps();
    await handleStripeEvent(event('customer.subscription.updated', subscription()), d);
    const r = await handleStripeEvent(event('customer.subscription.updated', subscription()), d);
    expect(r.outcome).toBe('duplicate');
    expect(d.syncSubscription).toHaveBeenCalledTimes(1);
  });

  it('marks failures so Stripe retries can re-process', async () => {
    const d = deps({ syncSubscription: vi.fn(async () => { throw new Error('db down'); }) });
    await expect(handleStripeEvent(event('customer.subscription.updated', subscription()), d)).rejects.toThrow('db down');
    expect(d.finishEvent).toHaveBeenCalledWith('evt_1', 'failed', 'db down');
  });

  it('rejects a checkout whose organization does not match the linked customer', async () => {
    const d = deps();
    const session = { mode: 'subscription', subscription: 'sub_1', client_reference_id: 'org_EVIL' };
    await expect(handleStripeEvent(event('checkout.session.completed', session), d)).rejects.toThrow(/does not match/);
    expect(d.syncSubscription).not.toHaveBeenCalled();
    expect(d.audit).toHaveBeenCalledWith(null, 'billing.webhook_security_error', expect.anything());
  });

  it('rejects metadata pointing a known customer at another organization', async () => {
    const d = deps({ retrieveSubscription: vi.fn(async () => subscription({ metadata: { organization_id: 'org_B' } })) });
    await expect(handleStripeEvent(event('customer.subscription.updated', subscription()), d)).rejects.toThrow(/different organization/);
  });

  it('links an unlinked customer via metadata only when the org has no other customer', async () => {
    const sub = subscription({ customer: 'cus_new' });
    const ok = deps({ retrieveSubscription: vi.fn(async () => sub) });
    await handleStripeEvent(event('customer.subscription.created', sub), ok);
    expect(ok.linkCustomer).toHaveBeenCalledWith('org_A', 'cus_new', null);
    expect(ok.syncSubscription).toHaveBeenCalled();

    const taken = deps({ retrieveSubscription: vi.fn(async () => sub), linkCustomer: vi.fn(async () => 'cus_other') });
    await expect(handleStripeEvent(event('customer.subscription.created', sub, 'evt_2'), taken)).rejects.toThrow(/already linked/);
  });

  it('ignores subscriptions that belong to no organization', async () => {
    const sub = subscription({ customer: 'cus_x', metadata: {} });
    const d = deps({ retrieveSubscription: vi.fn(async () => sub) });
    const r = await handleStripeEvent(event('customer.subscription.updated', sub), d);
    expect(r.outcome).toBe('ignored');
    expect(d.finishEvent).toHaveBeenCalledWith('evt_1', 'ignored');
  });

  it('syncs and audits failed invoice payments through the invoice parent', async () => {
    const d = deps();
    const inv = { id: 'in_1', amount_due: 12999, attempt_count: 1, parent: { subscription_details: { subscription: 'sub_1' } } };
    await handleStripeEvent(event('invoice.payment_failed', inv), d);
    expect(d.syncSubscription).toHaveBeenCalled();
    expect(d.audit).toHaveBeenCalledWith('org_A', 'billing.payment_failed', expect.objectContaining({ invoice: 'in_1' }));
  });

  it('ignores unrelated event types', async () => {
    const r = await handleStripeEvent(event('customer.created', {}), deps());
    expect(r.outcome).toBe('ignored');
  });
});
