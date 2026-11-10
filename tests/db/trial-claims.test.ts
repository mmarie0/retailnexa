import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { adminUrl, TEST_DB, as, sys, createUser, createOrg, expectDenied, closeDb, type TestUser } from './helpers';

const service = { kind: 'service' as const };
let owner: TestUser;
let A: string, B: string;

beforeAll(async () => {
  owner = await createUser('tc-owner');
  A = await createOrg(owner, 'Trial A', 'retail', { subscribe: false });
  B = await createOrg(owner, 'Trial B', 'retail', { subscribe: false });
});
afterAll(closeDb);

const claim = (org: string) => as<{ ok: boolean }>(service, `select public.claim_trial($1, $2) as ok`, [owner.id, org]);

describe('#17 one trial claim per owner', () => {
  it('two concurrent claims for two businesses: exactly one wins', async () => {
    const conns = await Promise.all([0, 1].map(async () => {
      const c = new Client({ connectionString: adminUrl(TEST_DB) });
      await c.connect();
      await c.query('begin');
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: 'service_role' })]);
      await c.query('set local role service_role');
      return c;
    }));
    const [r1, r2] = await Promise.all([
      conns[0].query(`select public.claim_trial($1, $2) as ok`, [owner.id, A]).then(async (r) => { await new Promise((s) => setTimeout(s, 100)); await conns[0].query('commit'); return r.rows[0].ok; }),
      conns[1].query(`select public.claim_trial($1, $2) as ok`, [owner.id, B]).then(async (r) => { await conns[1].query('commit'); return r.rows[0].ok; }),
    ]);
    await Promise.all(conns.map((c) => c.end()));
    expect([r1, r2].filter(Boolean)).toHaveLength(1);
  });

  it('the winner can retry its own checkout; the other business cannot', async () => {
    const [{ org }] = await sys<{ org: string }>(`select organization_id as org from public.trial_claims where owner_user_id = $1`, [owner.id]);
    const other = org === A ? B : A;
    expect((await claim(org))[0].ok).toBe(true);
    expect((await claim(other))[0].ok).toBe(false);
  });

  it('an unused claim lapses after 25 hours; a used one never does', async () => {
    const [{ org }] = await sys<{ org: string }>(`select organization_id as org from public.trial_claims where owner_user_id = $1`, [owner.id]);
    const other = org === A ? B : A;
    await sys(`update public.trial_claims set claimed_at = now() - interval '26 hours' where owner_user_id = $1`, [owner.id]);
    await sys(`update public.organizations set trial_consumed_at = now() where id = $1`, [org]);
    expect((await claim(other))[0].ok).toBe(false);
    await sys(`update public.organizations set trial_consumed_at = null where id = $1`, [org]);
    expect((await claim(other))[0].ok).toBe(true);
  });

  it('is service-role only', async () => {
    await expectDenied(as(owner, `select public.claim_trial($1, $2)`, [owner.id, A]), /permission denied/);
    await expectDenied(as(owner, `select * from public.trial_claims`), /permission denied/);
  });
});
