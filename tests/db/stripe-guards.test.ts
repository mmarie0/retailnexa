import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, sys, createUser, createOrg, expectDenied, closeDb, type TestUser } from './helpers';

const service = { kind: 'service' as const };
let owner: TestUser;
let org: string;

beforeAll(async () => {
  owner = await createUser('sg-owner');
  org = await createOrg(owner, 'Stripe Guard Co', 'retail', { subscribe: false });
});
afterAll(closeDb);

const payload = (id: string, status: string, at: string) => ({
  stripe_subscription_id: id, stripe_customer_id: 'cus_sg', status, products: ['retail'], price_ids: ['price_r'],
  extra_locations: 0, trial_start: null, trial_end: null, current_period_start: at, current_period_end: '2026-12-31T00:00:00Z',
  cancel_at_period_end: false, synced_at: at,
});
const sync = (id: string, status: string, at: string) =>
  as<{ r: string }>(service, `select public.sync_subscription($1, $2::jsonb, 'evt_sg') as r`, [org, JSON.stringify(payload(id, status, at))]);
const current = async () =>
  (await sys<{ id: string; status: string }>(`select stripe_subscription_id as id, status from public.subscriptions where organization_id = $1`, [org]))[0];

describe('#11 one live subscription per organization', () => {
  it('a second live subscription does not replace the first and is flagged once', async () => {
    expect((await sync('sub_A', 'active', '2026-11-01T00:00:00Z'))[0].r).toBe('synced');
    expect((await sync('sub_B', 'active', '2026-11-02T00:00:00Z'))[0].r).toBe('conflict_second_live_subscription');
    expect((await sync('sub_B', 'active', '2026-11-03T00:00:00Z'))[0].r).toBe('conflict_second_live_subscription');
    expect(await current()).toEqual({ id: 'sub_A', status: 'active' });
    const flags = await sys(`select metadata from public.audit_logs where organization_id = $1 and action = 'billing.second_live_subscription'`, [org]);
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ metadata: { kept: 'sub_A', duplicate: 'sub_B' } });
    expect(await sys(`select 1 from public.subscription_events where organization_id = $1 and kind = 'second_live_subscription'`, [org])).toHaveLength(1);
  });

  it('a live subscription may still replace an ended one (reactivation)', async () => {
    expect((await sync('sub_A', 'canceled', '2026-11-04T00:00:00Z'))[0].r).toBe('synced');
    expect((await sync('sub_C', 'active', '2026-11-05T00:00:00Z'))[0].r).toBe('synced');
    expect(await current()).toEqual({ id: 'sub_C', status: 'active' });
  });
});

describe('#12 claim states', () => {
  const claim = (id: string) => as<{ s: string }>(service, `select public.claim_stripe_event_state($1, 'invoice.paid', now()) as s`, [id]);
  it('tells new, in-flight, stale, failed and finished events apart', async () => {
    expect((await claim('evt_S1'))[0].s).toBe('claimed');
    expect((await claim('evt_S1'))[0].s).toBe('in_flight');
    await sys(`update public.stripe_events set locked_at = now() - interval '6 minutes' where id = 'evt_S1'`);
    expect((await claim('evt_S1'))[0].s).toBe('claimed');
    await as(service, `select public.finish_stripe_event('evt_S1', 'failed', 'boom')`);
    expect((await claim('evt_S1'))[0].s).toBe('claimed');
    await as(service, `select public.finish_stripe_event('evt_S1', 'processed')`);
    expect((await claim('evt_S1'))[0].s).toBe('done');
    const [row] = await sys<{ attempts: number }>(`select attempts from public.stripe_events where id = 'evt_S1'`);
    expect(row.attempts).toBe(3);
  });
});

describe('#11 checkout lock', () => {
  it('serializes checkout starts per organization and remembers the open session', async () => {
    await sys(`insert into public.billing_accounts (organization_id, stripe_customer_id) values ($1, 'cus_sg_lock') on conflict do nothing`, [org]);
    expect((await as<{ p: string | null }>(service, `select public.begin_checkout($1) as p`, [org]))[0].p).toBeNull();
    await expectDenied(as(service, `select public.begin_checkout($1)`, [org]), /already being started/);
    await as(service, `select public.finish_checkout($1, 'cs_test_1')`, [org]);
    expect((await as<{ p: string }>(service, `select public.begin_checkout($1) as p`, [org]))[0].p).toBe('cs_test_1');
    await as(service, `select public.finish_checkout($1, null)`, [org]);
  });

  it('is not callable by end users', async () => {
    await expectDenied(as(owner, `select public.begin_checkout($1)`, [org]), /permission denied/);
    await expectDenied(as(owner, `select public.finish_checkout($1, null)`, [org]), /permission denied/);
    await expectDenied(as(owner, `select public.claim_stripe_event_state('evt_X', 'x', now())`), /permission denied/);
  });
});
