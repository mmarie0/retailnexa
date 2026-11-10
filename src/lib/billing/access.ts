/**
 * Decides what an organization may do based on its own status and its Stripe
 * subscription. Pure and deterministic: everything it needs is passed in.
 *
 *   full         - normal use (active, trialing)
 *   grace        - payment failed recently; full use with a warning banner
 *   read_only    - can view and export data, cannot create or change records
 *   billing_only - must finish checkout / fix billing before using the app
 *   suspended    - suspended by platform staff; billing + export only
 *   closed       - closed; no tenant access
 */
export type AccessState = 'full' | 'grace' | 'read_only' | 'billing_only' | 'suspended' | 'closed';

export type OrgStatus = 'active' | 'suspended' | 'closed';
export type SubscriptionStatus =
  | 'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid' | 'incomplete' | 'incomplete_expired' | 'paused';

export interface AccessInput {
  orgStatus: OrgStatus;
  subscription: null | {
    status: SubscriptionStatus;
    currentPeriodEnd: Date | null;
    trialEnd: Date | null;
    cancelAtPeriodEnd: boolean;
    /** When the subscription first became past_due (grace anchor). */
    pastDueSince?: Date | null;
  };
  now: Date;
}

export interface Access {
  state: AccessState;
  canUseApp: boolean;
  canWrite: boolean;
  canExport: boolean;
  /** Short explanation for banners; null when nothing needs saying. */
  notice: null | { tone: 'info' | 'warning' | 'danger'; message: string };
  trialDaysLeft: number | null;
}

/** Must match the interval in private.org_is_writable (foundation migration). */
export const PAST_DUE_GRACE_DAYS = 7;
const DAY = 86_400_000;

function access(state: AccessState, notice: Access['notice'] = null, trialDaysLeft: number | null = null): Access {
  const canUseApp = state === 'full' || state === 'grace' || state === 'read_only';
  return {
    state,
    canUseApp,
    canWrite: state === 'full' || state === 'grace',
    canExport: state !== 'closed',
    notice,
    trialDaysLeft,
  };
}

export function computeAccess({ orgStatus, subscription: s, now }: AccessInput): Access {
  if (orgStatus === 'closed') return access('closed', { tone: 'danger', message: 'This account is closed.' });
  if (orgStatus === 'suspended') {
    return access('suspended', { tone: 'danger', message: 'This account is suspended. Contact support to restore access. You can still export your data.' });
  }
  if (!s) return access('billing_only', { tone: 'info', message: 'Add a payment method to start your free trial.' });

  switch (s.status) {
    case 'trialing': {
      const left = s.trialEnd ? Math.max(0, Math.ceil((s.trialEnd.getTime() - now.getTime()) / DAY)) : null;
      const msg = s.cancelAtPeriodEnd
        ? 'Your trial is set to end without converting. Resume your subscription to keep using RetailNexa.'
        : left === null ? 'You are on a free trial.' : `Free trial: ${left} day${left === 1 ? '' : 's'} left. Your first payment is taken when it ends.`;
      return access('full', { tone: s.cancelAtPeriodEnd ? 'warning' : 'info', message: msg }, left);
    }
    case 'active':
      return access('full', s.cancelAtPeriodEnd
        ? { tone: 'warning', message: 'Your subscription is canceled and ends at the close of this billing period.' }
        : null);
    case 'past_due': {
      // Stripe advances current_period_end at renewal even when the payment fails,
      // so grace is anchored to the first failure, not the period end.
      const since = s.pastDueSince ?? now;
      const graceEnds = since.getTime() + PAST_DUE_GRACE_DAYS * DAY;
      if (now.getTime() <= graceEnds) {
        return access('grace', { tone: 'warning', message: 'Your last payment failed. Update your payment method to avoid interruption.' });
      }
      return access('read_only', { tone: 'danger', message: 'Payment is overdue. Your data is read-only until billing is updated.' });
    }
    case 'unpaid':
      return access('read_only', { tone: 'danger', message: 'Payment is overdue. Your data is read-only until billing is updated.' });
    case 'canceled':
      return access('read_only', { tone: 'warning', message: 'Your subscription has ended. Your records are kept and can be exported. Reactivate any time.' });
    case 'paused':
    case 'incomplete':
    case 'incomplete_expired':
      return access('billing_only', { tone: 'warning', message: 'Finish setting up billing to use RetailNexa.' });
  }
}

/** Product entitlements: subscribed products plus platform overrides (unexpired). */
export function entitlements(
  products: readonly string[],
  overrides: ReadonlyArray<{ feature: string; enabled: boolean; expiresAt: Date | null }>,
  now: Date,
): Set<string> {
  const set = new Set<string>(products);
  for (const o of overrides) {
    if (o.expiresAt && o.expiresAt.getTime() <= now.getTime()) continue;
    if (o.enabled) set.add(o.feature);
    else set.delete(o.feature);
  }
  return set;
}
