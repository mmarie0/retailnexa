import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, sys, createUser, createOrg, addMember, expectDenied, closeDb, type TestUser } from './helpers';

let owner: TestUser, mgrA: TestUser, acctB: TestUser, acctAll: TestUser;
let org: string, A: string, B: string, vendor: string, rent: string;
const scopeErr = /store you don.t have access to|permission denied/;

beforeAll(async () => {
  owner = await createUser('ls-owner'); mgrA = await createUser('ls-mgrA'); acctB = await createUser('ls-acctB'); acctAll = await createUser('ls-acctAll');
  org = await createOrg(owner, 'Scope Co', 'retail');
  [{ id: A }] = await sys<{ id: string }>(`select id from public.locations where organization_id = $1 limit 1`, [org]);
  [{ id: B }] = await as<{ id: string }>(owner, `insert into public.locations (organization_id, name, kind) values ($1, 'Store B', 'store') returning id`, [org]);
  const mA = await addMember(owner, org, mgrA, 'manager');
  const mB = await addMember(owner, org, acctB, 'accountant');
  await addMember(owner, org, acctAll, 'accountant');
  await as(owner, `select public.set_member_locations($1, $2::uuid[])`, [mA, [A]]);
  await as(owner, `select public.set_member_locations($1, $2::uuid[])`, [mB, [B]]);
  [{ id: vendor }] = await as<{ id: string }>(owner, `insert into public.vendors (organization_id, name) values ($1, 'Scope Vendor') returning id`, [org]);
  [{ id: rent }] = await sys<{ id: string }>(`select id from public.accounts where organization_id = $1 and role = 'rent'`, [org]);
});
afterAll(closeDb);

const day = (u: TestUser, loc: string, date: string) =>
  as<{ id: string }>(u, `select public.record_sales_day($1, $2, $3::date, 1000, 0, 0, 1000, 0, 0, 'Reg 1') as id`, [org, loc, date]);
const bill = (u: TestUser, num: string, loc: string | null) =>
  as<{ id: string }>(u, `select public.create_bill($1, $2, $3, '2026-11-01'::date, null, $4::jsonb, null, $5) as id`,
    [org, vendor, num, JSON.stringify([{ account_id: rent, amount_cents: 1000 }]), loc]);

describe('sales days (#27)', () => {
  it('a member restricted to store A can record A but not B', async () => {
    await day(mgrA, A, '2026-11-02');
    await expectDenied(day(mgrA, B, '2026-11-02'), scopeErr);
  });

  it('restricted members only see their stores’ days; unrestricted see all', async () => {
    await day(owner, B, '2026-11-02');
    const seen = await as<{ location_id: string }>(mgrA, `select location_id from public.sales_days where organization_id = $1`, [org]);
    expect(new Set(seen.map((r) => r.location_id))).toEqual(new Set([A]));
    expect((await as(acctAll, `select id from public.sales_days where organization_id = $1`, [org])).length).toBe(2);
  });

  it('voiding another store’s day is refused', async () => {
    // Give the store-B accountant sales.edit so the refusal below comes from the store rule, not the role.
    const [{ id: mB }] = await sys<{ id: string }>(`select id from public.memberships where organization_id = $1 and user_id = $2`, [org, acctB.id]);
    await as(owner, `select public.set_member_permission($1, 'sales.edit', true)`, [mB]);
    const [{ id: aDay }] = await sys<{ id: string }>(`select id from public.sales_days where organization_id = $1 and location_id = $2`, [org, A]);
    const [{ id: bDay }] = await sys<{ id: string }>(`select id from public.sales_days where organization_id = $1 and location_id = $2`, [org, B]);
    await expectDenied(as(acctB, `select public.void_sales_day($1, 'not my store')`, [aDay]), scopeErr);
    await as(acctB, `select public.void_sales_day($1, 'my store, typo')`, [bDay]);
  });
});

describe('bills (#27)', () => {
  let billA: string, billB: string, billOrg: string;
  it('restricted members can create bills only for their store, never org-wide', async () => {
    [{ id: billA }] = await bill(mgrA, 'A-1', A);
    await expectDenied(bill(mgrA, 'B-1', B), scopeErr);
    await expectDenied(bill(mgrA, 'ORG-1', null), scopeErr);
    [{ id: billB }] = await bill(owner, 'B-2', B);
    [{ id: billOrg }] = await bill(owner, 'ORG-2', null);
  });

  it('reads: restricted members see only their store’s bills, lines and payments; org-wide bills hidden', async () => {
    const a = await as<{ id: string }>(mgrA, `select id from public.bills where organization_id = $1`, [org]);
    expect(a.map((r) => r.id)).toEqual([billA]);
    expect(await as(mgrA, `select id from public.bill_lines where bill_id = $1`, [billB])).toHaveLength(0);
    expect((await as(acctAll, `select id from public.bills where organization_id = $1`, [org])).length).toBe(3);
  });

  it('approve / pay / void across stores is refused; within the store it works', async () => {
    await expectDenied(as(acctB, `select public.approve_bill($1)`, [billA]), scopeErr);
    await expectDenied(as(acctB, `select public.approve_bill($1)`, [billOrg]), scopeErr);
    await as(acctB, `select public.approve_bill($1)`, [billB]);
    await expectDenied(as(acctB, `select public.void_bill($1, 'not mine')`, [billA]), scopeErr);
    await as(acctAll, `select public.approve_bill($1)`, [billA]);
    const [{ id: pay }] = await as<{ id: string }>(owner, `select public.record_bill_payment($1, '2026-11-05'::date, 1000, 'bank', 'ls-pay-0001') as id`, [billB]);
    const rows = await as(acctB, `select id from public.bill_payments where bill_id = $1`, [billB]);
    expect(rows).toHaveLength(1);
    expect(await as(acctB, `select id from public.bill_payments where id = $1 and bill_id <> $2`, [pay, billB])).toHaveLength(0);
  });

  it('removing restrictions restores full access', async () => {
    const [{ id: m }] = await sys<{ id: string }>(`select id from public.memberships where organization_id = $1 and user_id = $2`, [org, mgrA.id]);
    await as(owner, `select public.set_member_locations($1, '{}'::uuid[])`, [m]);
    expect((await as(mgrA, `select id from public.bills where organization_id = $1`, [org])).length).toBe(3);
  });
});
