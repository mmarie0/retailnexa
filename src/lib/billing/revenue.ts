import { monthlyTotalCents, normalizeSelection } from './plans';

export interface SubRow { status: string; products: string[]; extra_locations: number; cancel_at_period_end?: boolean }

/**
 * Monthly recurring revenue estimate from the subscription mirror and the plan
 * catalog (list prices; excludes discounts, coupons and tax). Trials are not
 * revenue yet and are reported separately.
 */
export function revenueSummary(subs: SubRow[]) {
  let mrrCents = 0, paying = 0, trialing = 0, pastDue = 0, trialPipelineCents = 0, churningCents = 0;
  for (const s of subs) {
    const amount = monthlyTotalCents(normalizeSelection({ retail: s.products.includes('retail'), wholesale: s.products.includes('wholesale'), extraLocations: s.extra_locations }));
    if (s.status === 'active' || s.status === 'past_due') {
      mrrCents += amount;
      paying++;
      if (s.status === 'past_due') pastDue++;
      if (s.cancel_at_period_end) churningCents += amount;
    } else if (s.status === 'trialing') {
      trialing++;
      if (!s.cancel_at_period_end) trialPipelineCents += amount;
    }
  }
  return { mrrCents, paying, trialing, pastDue, trialPipelineCents, churningCents };
}
