import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, sys, createUser, createOrg, addMember, expectDenied, closeDb, type TestUser } from './helpers';

const service = { kind: 'service' as const };
let owner: TestUser, mgrA: TestUser, mgrAB: TestUser;
let org: string, A: string, B: string, vendor: string, rent: string;

beforeAll(async () => {
  owner = await createUser('ssd-owner'); mgrA = await createUser('ssd-mgrA'); mgrAB = await createUser('ssd-mgrAB');
  org = await createOrg(owner, 'Single Store Default Co', 'retail');
  [{ id: A }] = await sys<{ id: string }>(`select id from public.locations where organization_id = $1 limit 1`, [org]);
  [{ id: B }] = await as<{ id: string }>(owner, `insert into public.locations (organization_id, name, kind) values ($1, 'Store B', 'store') returning id`, [org]);
  const mA = await addMember(owner, org, mgrA, 'manager');
  const mAB = await addMember(owner, org, mgrAB, 'manager');
  await as(owner, `select public.set_member_locations($1, $2::uuid[])`, [mA, [A]]);
  await as(owner, `select public.set_member_locations($1, $2::uuid[])`, [mAB, [A, B]]);
  [{ id: vendor }] = await as<{ id: string }>(owner, `insert into public.vendors (organization_id, name) values ($1, 'SSD Vendor') returning id`, [org]);
  [{ id: rent }] = await sys<{ id: string }>(`select id from public.accounts where organization_id = $1 and role = 'rent'`, [org]);
});
afterAll(closeDb);

const lines = () => JSON.stringify([{ account_id: rent, amount_cents: 1000 }]);

describe('#78 one-store members save without a Store field', () => {
  it('a bill with no store goes to the member’s only store', async () => {
    const [{ id }] = await as<{ id: string }>(mgrA, `select public.create_bill($1, $2, 'SSD-1', '2026-11-01'::date, null, $3::jsonb, null, null) as id`, [org, vendor, lines()]);
    const [b] = await sys<{ location_id: string }>(`select location_id from public.bills where id = $1`, [id]);
    expect(b.location_id).toBe(A);
  });

  it('a recurring bill with no store goes to the member’s only store', async () => {
    const [{ id }] = await as<{ id: string }>(mgrA, `select public.save_recurring_bill($1, null, $2, 'SSD rent', $3::jsonb, 'monthly', '2026-12-01'::date) as id`, [org, vendor, lines()]);
    const [r] = await sys<{ location_id: string }>(`select location_id from public.recurring_bills where id = $1`, [id]);
    expect(r.location_id).toBe(A);
  });

  it('a member with two stores must still pick one; unrestricted members keep “whole business”', async () => {
    await expectDenied(as(mgrAB, `select public.create_bill($1, $2, 'SSD-2', '2026-11-01'::date, null, $3::jsonb, null, null)`, [org, vendor, lines()]), /store you don.t have access to/);
    const [{ id }] = await as<{ id: string }>(owner, `select public.create_bill($1, $2, 'SSD-3', '2026-11-01'::date, null, $3::jsonb, null, null) as id`, [org, vendor, lines()]);
    const [b] = await sys<{ location_id: string | null }>(`select location_id from public.bills where id = $1`, [id]);
    expect(b.location_id).toBeNull();
  });
});

describe('#80 a blocked checkout never releases the trial claim', () => {
  it('keeps the claim while another checkout holds the lock or a session exists', async () => {
    const u = await createUser('ssd-trial');
    const X = await createOrg(u, 'Trial X', 'retail', { subscribe: false });
    const Y = await createOrg(u, 'Trial Y', 'retail', { subscribe: false });
    await sys(`insert into public.billing_accounts (organization_id, stripe_customer_id) values ($1, 'cus_ssd_x')`, [X]);
    expect((await as<{ h: string }>(service, `select public.claim_trial($1, $2) as h`, [u.id, X]))[0].h).toBe(X);
    // request 1 holds the checkout lock; request 2 (double-click) is blocked and tries to release
    await as(service, `select public.begin_checkout($1)`, [X]);
    await as(service, `select public.release_trial_claim($1, $2)`, [u.id, X]);
    expect((await as<{ h: string }>(service, `select public.claim_trial($1, $2) as h`, [u.id, Y]))[0].h).toBe(X);
    // request 1 created its session; a later failed retry still can't release
    await as(service, `select public.finish_checkout($1, 'cs_ssd_1')`, [X]);
    await as(service, `select public.release_trial_claim($1, $2)`, [u.id, X]);
    expect((await as<{ h: string }>(service, `select public.claim_trial($1, $2) as h`, [u.id, Y]))[0].h).toBe(X);
  });
});
