import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, sys, createUser, createOrg, addMember, expectDenied, verifyMfa, closeDb, type TestUser } from './helpers';

let owner: TestUser, mate: TestUser, plain: TestUser;
let org: string;

beforeAll(async () => {
  owner = await createUser('mfa-owner'); mate = await createUser('mfa-mate'); plain = await createUser('mfa-plain');
  org = await createOrg(owner, 'MFA Co', 'retail');
  await addMember(owner, org, mate, 'manager');
  await as(owner, `insert into public.vendors (organization_id, name) values ($1, 'MFA Vendor')`, [org]);
  await verifyMfa(owner);
});
afterAll(closeDb);

const aal2 = (u: TestUser) => ({ ...u, aal: 'aal2' as const });

describe('#96 two-factor is enforced in the database', () => {
  it('a password-only (aal1) session of a 2FA user gets no business permissions', async () => {
    expect((await as<{ p: string[] }>(owner, `select public.my_permissions($1) as p`, [org]))[0].p).toEqual([]);
    expect(await as(owner, `select id from public.vendors where organization_id = $1`, [org])).toHaveLength(0);
    await expectDenied(as(owner, `select public.invite_member($1, 'x@example.test', 'employee')`, [org]));
    expect(await as(owner, `select id from public.profiles where id = $1`, [mate.id])).toHaveLength(0);
  });

  it('org, stores, subscription and overrides are closed too at aal1 (#118); own membership stays', async () => {
    for (const q of [
      `select id from public.organizations where id = $1`,
      `select id from public.locations where organization_id = $1`,
      `select organization_id from public.subscriptions where organization_id = $1`,
      `select organization_id from public.feature_overrides where organization_id = $1`,
      `select id from public.my_locations($1)`,
    ]) expect(await as(owner, q, [org]), q).toHaveLength(0);
    expect(await as(owner, `select id from public.memberships where user_id = $1`, [owner.id])).toHaveLength(1);
    expect(await as(aal2(owner), `select id from public.organizations where id = $1`, [org])).toHaveLength(1);
    expect((await as(aal2(owner), `select id from public.locations where organization_id = $1`, [org])).length).toBeGreaterThan(0);
    expect((await as(aal2(owner), `select id from public.my_locations($1)`, [org])).length).toBeGreaterThan(0);
  });

  it('the same user with password + code (aal2) has full access', async () => {
    expect((await as<{ p: string[] }>(aal2(owner), `select public.my_permissions($1) as p`, [org]))[0].p.length).toBeGreaterThan(10);
    expect(await as(aal2(owner), `select id from public.vendors where organization_id = $1`, [org])).toHaveLength(1);
  });

  it('users without a verified factor are unchanged', async () => {
    expect(await as(mate, `select id from public.vendors where organization_id = $1`, [org])).toHaveLength(1);
    await sys(`insert into auth.mfa_factors (user_id, status) values ($1, 'unverified')`, [plain.id]);
    expect((await as<{ ok: boolean }>(plain, `select private.mfa_ok() as ok`))[0].ok).toBe(true);
  });
});
