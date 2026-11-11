import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, sys, createUser, createOrg, addMember, setSubscription, expectDenied, closeDb, type TestUser } from './helpers';

// Batch E: upkeep / maintenance schedule (#115).
let owner: TestUser, mgrA: TestUser, emp: TestUser, viewer: TestUser, outsider: TestUser;
let org: string, A: string, B: string;

beforeAll(async () => {
  owner = await createUser('up-owner'); mgrA = await createUser('up-mgrA'); emp = await createUser('up-emp'); viewer = await createUser('up-viewer'); outsider = await createUser('up-out');
  org = await createOrg(owner, 'Upkeep Co', 'retail');
  [{ id: A }] = await sys<{ id: string }>(`select id from public.locations where organization_id = $1 limit 1`, [org]);
  [{ id: B }] = await as<{ id: string }>(owner, `insert into public.locations (organization_id, name, kind) values ($1, 'UP B', 'store') returning id`, [org]);
  const m = await addMember(owner, org, mgrA, 'manager');
  await as(owner, `select public.set_member_locations($1, $2::uuid[])`, [m, [A]]);
  await addMember(owner, org, emp, 'employee');
  await addMember(owner, org, viewer, 'viewer');
});
afterAll(closeDb);

const save = (u: TestUser, p: object, id: string | null = null) => as<{ id: string }>(u, `select public.save_maintenance_task($1, $2, $3::jsonb) as id`, [org, id, JSON.stringify(p)]);
const base = { name: 'HVAC filter change', area: 'HVAC', every_n: 3, every_unit: 'months' };

describe('maintenance tasks (#115)', () => {
  let all: string, onlyB: string, onlyA: string;
  it('owners add business-wide or store tasks; bad intervals and future dates are refused', async () => {
    [{ id: all }] = await save(owner, base);
    [{ id: onlyB }] = await save(owner, { ...base, name: 'Store B pest', location_id: B });
    await expectDenied(save(owner, { ...base, every_n: 0 }), /how often/);
    await expectDenied(save(owner, { ...base, every_unit: 'decades' }), /how often/);
    await expectDenied(save(owner, { ...base, last_done: '2099-01-01' }), /future/);
    await expectDenied(save(owner, { ...base, name: ' ' }), /name the task/);
  });
  it('a store-limited manager sees business-wide and their store’s tasks; adds only for their store', async () => {
    [{ id: onlyA }] = await save(mgrA, { ...base, name: 'Store A ice machine' });
    expect((await sys<{ l: string }>(`select location_id as l from public.maintenance_tasks where id = $1`, [onlyA]))[0].l).toBe(A);
    const seen = (await as<{ id: string }>(mgrA, `select id from public.maintenance_tasks where organization_id = $1`, [org])).map((r) => r.id).sort();
    expect(seen).toEqual([all, onlyA].sort());
    await expectDenied(save(mgrA, { ...base, location_id: B }), /store you don.t have access to/);
    await expectDenied(save(mgrA, base, all), /store you don.t have access to/);
  });
  it('employees mark tasks done (not in the future) but can’t add or delete; costs are logged', async () => {
    await as(emp, `select public.log_maintenance($1, $2, '2026-11-01', 4500, 'filters')`, [org, all]);
    await expectDenied(as(emp, `select public.log_maintenance($1, $2, '2099-01-01', 0, null)`, [org, all]), /future/);
    await expectDenied(as(emp, `select public.log_maintenance($1, $2, '2026-11-01', -1, null)`, [org, all]), /cost/);
    await expectDenied(save(emp, base));
    await expectDenied(as(emp, `select public.delete_maintenance_task($1, $2)`, [org, all]));
    expect(await as(emp, `select done_on::text, cost_cents from public.maintenance_log where task_id = $1`, [all])).toEqual([{ done_on: '2026-11-01', cost_cents: '4500' }]);
  });
  it('viewers, outsiders, anon and direct writes are refused', async () => {
    expect(await as(viewer, `select id from public.maintenance_tasks where organization_id = $1`, [org])).toEqual([]);
    expect(await as(outsider, `select id from public.maintenance_tasks where organization_id = $1`, [org])).toEqual([]);
    await expectDenied(as(outsider, `select public.log_maintenance($1, $2, '2026-11-01', 0, null)`, [org, all]));
    await expectDenied(as({ kind: 'anon' } as never, `select public.save_maintenance_task($1, null, '{}'::jsonb)`, [org]));
    await expectDenied(as(owner, `insert into public.maintenance_log (organization_id, task_id, done_on) values ($1, $2, '2026-11-01')`, [org, all]));
    await expectDenied(as(owner, `update public.maintenance_tasks set name = 'x' where id = $1`, [all]));
  });
  it('deleting a task deletes its history; a read-only business can’t write', async () => {
    await as(owner, `select public.delete_maintenance_task($1, $2)`, [org, all]);
    expect(await sys(`select 1 from public.maintenance_log where task_id = $1`, [all])).toEqual([]);
    expect(onlyB).toBeTruthy();
    const u = await createUser('up-ro');
    const ro = await createOrg(u, 'RO Upkeep', 'retail');
    await setSubscription(ro, 'canceled');
    await expectDenied(as(u, `select public.save_maintenance_task($1, null, $2::jsonb)`, [ro, JSON.stringify(base)]));
  });
});
