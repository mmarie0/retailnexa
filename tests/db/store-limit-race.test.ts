import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { adminUrl, TEST_DB, as, sys, createUser, createOrg, setSubscription, expectDenied, closeDb, type TestUser } from './helpers';

let owner: TestUser;
let org: string;
const open: Client[] = [];

/** A separate connection acting as the owner inside an open transaction. */
async function session(u: TestUser) {
  const c = new Client({ connectionString: adminUrl(TEST_DB) });
  await c.connect();
  open.push(c);
  await c.query('begin');
  await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: u.id, role: 'authenticated', aal: 'aal1' })]);
  await c.query('set local role authenticated');
  return c;
}

beforeAll(async () => {
  owner = await createUser('slr-owner');
  org = await createOrg(owner, 'Race Co', 'retail');
  await setSubscription(org, 'active', { products: ['retail'], extraLocations: 1 }); // 2 stores allowed, 1 in use
});
afterAll(async () => {
  await Promise.all(open.map((c) => c.end().catch(() => {})));
  await closeDb();
});

const activeStores = async () =>
  Number((await sys<{ n: string }>(`select count(*) as n from public.locations where organization_id = $1 and kind = 'store' and is_active`, [org]))[0].n);

describe('#15 store limit under concurrency', () => {
  it('only one of two simultaneous store inserts commits', async () => {
    const a = await session(owner);
    const b = await session(owner);
    await a.query(`insert into public.locations (organization_id, name, kind) values ($1, 'Race A', 'store')`, [org]);
    const second = b.query(`insert into public.locations (organization_id, name, kind) values ($1, 'Race B', 'store')`, [org]);
    await new Promise((r) => setTimeout(r, 150)); // b is now waiting on a's lock
    await a.query('commit');
    await expect(second).rejects.toMatchObject({ code: '23514' });
    await b.query('rollback');
    expect(await activeStores()).toBe(2);
  });

  it('reactivating a store races the same way', async () => {
    const [{ id: old }] = await sys<{ id: string }>(
      `insert into public.locations (organization_id, name, kind, is_active) values ($1, 'Closed store', 'store', false) returning id`, [org]);
    await sys(`update public.locations set is_active = false where organization_id = $1 and name = 'Race A'`, [org]);
    const a = await session(owner);
    const b = await session(owner);
    await a.query(`update public.locations set is_active = true where id = $1`, [old]);
    const second = b.query(`insert into public.locations (organization_id, name, kind) values ($1, 'Race C', 'store')`, [org]);
    await new Promise((r) => setTimeout(r, 150));
    await a.query('commit');
    await expect(second).rejects.toMatchObject({ code: '23514' });
    await b.query('rollback');
    expect(await activeStores()).toBe(2);
  });

  it('a wholesale-only subscription cannot add stores', async () => {
    const w = await createUser('slr-wholesale');
    const wOrg = await createOrg(w, 'Warehouse Only', 'wholesale');
    await expectDenied(as(w, `insert into public.locations (organization_id, name, kind) values ($1, 'Shop', 'store')`, [wOrg]), /need the Retail plan/);
    await as(w, `insert into public.locations (organization_id, name, kind) values ($1, 'Second warehouse', 'warehouse')`, [wOrg]);
  });
});
