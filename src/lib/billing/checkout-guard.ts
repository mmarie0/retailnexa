/**
 * Guards around starting a Stripe Checkout (#11), independent of Next.js and
 * the Stripe/DB clients so they can be unit-tested with fakes.
 *
 *  1. Stripe is the source of truth: if the customer already has a live
 *     subscription there, refuse, even if our mirror hasn't caught up.
 *  2. One start at a time per business (a 60s lock in billing_accounts);
 *     a concurrent start is refused.
 *  3. At most one open Checkout session per business: the previous open one
 *     is expired before a new one is created.
 */
export const STRIPE_LIVE_STATUSES = ['trialing', 'active', 'past_due', 'unpaid', 'paused', 'incomplete'] as const;

export interface CheckoutGuardDeps {
  listSubscriptionStatuses(customerId: string): Promise<string[]>;
  /** Takes the per-org lock; returns the previous open session id, or null. Throws code 55P03 when locked. */
  beginCheckout(orgId: string): Promise<string | null>;
  /** Releases the lock, recording the new session id when there is one. */
  finishCheckout(orgId: string, sessionId: string | null): Promise<void>;
  /** Expires a session if it is still open (no-op otherwise). */
  expireSessionIfOpen(sessionId: string): Promise<void>;
}

export class CheckoutBlockedError extends Error {
  constructor(public reason: 'already_subscribed' | 'in_progress', message: string) {
    super(message);
  }
}

export async function guardedCheckout<T extends { id: string }>(
  deps: CheckoutGuardDeps, orgId: string, customerId: string, create: () => Promise<T>,
): Promise<T> {
  const statuses = await deps.listSubscriptionStatuses(customerId);
  if (statuses.some((s) => (STRIPE_LIVE_STATUSES as readonly string[]).includes(s))) {
    throw new CheckoutBlockedError('already_subscribed',
      'This business already has a subscription. Use “Manage payment method and invoices” to change it.');
  }
  let previous: string | null;
  try {
    previous = await deps.beginCheckout(orgId);
  } catch (e) {
    if ((e as { code?: string }).code === '55P03') {
      throw new CheckoutBlockedError('in_progress', 'A checkout is already being started for this business. Wait a moment and try again.');
    }
    throw e;
  }
  let created: T | null = null;
  try {
    if (previous) await deps.expireSessionIfOpen(previous);
    created = await create();
    return created;
  } finally {
    await deps.finishCheckout(orgId, created?.id ?? null);
  }
}
