import { describe, expect, it } from 'vitest';
import { revenueSummary } from './revenue';

describe('revenueSummary', () => {
  it('counts paying subscriptions as MRR and keeps trials separate', () => {
    const r = revenueSummary([
      { status: 'active', products: ['retail'], extra_locations: 1 },
      { status: 'past_due', products: ['wholesale'], extra_locations: 0, cancel_at_period_end: true },
      { status: 'trialing', products: ['retail', 'wholesale'], extra_locations: 0 },
      { status: 'canceled', products: ['retail'], extra_locations: 0 },
    ]);
    expect(r).toEqual({ mrrCents: 12999 + 9999 + 14999, paying: 2, trialing: 1, pastDue: 1, trialPipelineCents: 12999 + 14999, churningCents: 14999 });
  });
});
