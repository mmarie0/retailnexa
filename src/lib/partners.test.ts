import { describe, expect, it } from 'vitest';
import { PLANS } from './billing/plans';
import { bookSummary, planCents, stageOf, type AgentClient } from './partners';

const c = (o: Partial<AgentClient>): AgentClient => ({
  organization_id: 'x', name: 'X', business_type: 'retail', org_status: 'active', created_at: '2026-11-02T00:00:00Z', source: 'referral', since: '2026-11-02T00:00:00Z',
  sub_status: 'active', products: ['retail'], extra_locations: 0, trial_end: null, current_period_end: null, cancel_at_period_end: false, ...o,
});

describe('partner book', () => {
  it('stages and plan price', () => {
    expect([stageOf(c({})), stageOf(c({ sub_status: 'trialing' })), stageOf(c({ sub_status: null })), stageOf(c({ sub_status: 'canceled' })), stageOf(c({ org_status: 'closed' }))])
      .toEqual(['paying', 'trial', 'no_plan', 'canceled', 'canceled']);
    expect(planCents(c({ products: ['retail', 'wholesale'], extra_locations: 1 }))).toBe(PLANS.retail.monthlyCents + (PLANS.retail.extraLocationCents ?? 0) + PLANS.wholesale.monthlyCents);
  });
  it('MRR counts paying and past-due accounts only, at list price', () => {
    const s = bookSummary([c({}), c({ sub_status: 'past_due', products: ['wholesale'] }), c({ sub_status: 'trialing' }), c({ sub_status: null, since: '2026-10-01T00:00:00Z', created_at: '2026-10-01T00:00:00Z' })], new Date('2026-11-11T12:00:00Z'));
    expect(s.mrrCents).toBe(PLANS.retail.monthlyCents + PLANS.wholesale.monthlyCents);
    expect(s).toMatchObject({ paying: 2, pastDue: 1, trialing: 1, accounts: 4, newThisMonth: 3, noPlan: 1 });
  });
});
