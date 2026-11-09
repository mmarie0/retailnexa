import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, sys, createUser, createOrg, expectDenied, closeDb, type TestUser } from './helpers';
import { ALL_PERMISSIONS, MEMBER_ROLES, ROLE_DEFAULTS } from '@/lib/auth/permissions';

const service = { kind: 'service' as const };
let owner: TestUser;
let org: string;

beforeAll(async () => {
  owner = await createUser('billowner');
  org = await createOrg(owner, 'Billing Co', 'both', { subscribe: false });
});
afterAll(closeDb);

const sub = (over: Record<string, unknown> = {}) => ({
  stripe_subscription_id: 'sub_1',
  stripe_customer_id: 'cus_1',
  status: 'trialing',
  products: ['retail', 'wholesale'],
  price_ids: ['price_r', 'price_w'],
  extra_locations: 0,
  trial_start: '2026-11-01T00:00:00Z',
  trial_end: '2026-11-08T00:00:00Z',
  current_period_start: '2026-11-01T00:00:00Z',
  current_period_end: '2026-11-08T00:00:00Z',
  cancel_at_period_end: false,
  synced_at: '2026-11-01T00:00:00Z',
  ...over,
});
const sync = (p: object, evt = 'evt_x') =>
  as<{ r: string }>(service, `select public.sync_subscription($1, $2::jsonb, $3) as r`, [org, JSON.stringify(p), evt]);

describe('stripe webhook idempotency ledger', () => {
  it('claims an event once; re-claims only after failure', async () => {
    const claim = () => as<{ c: boolean }>(service, `select public.claim_stripe_event('evt_A', 'invoice.paid', now()) as c`);
    expect((await claim())[0].c).toBe(true);
    expect((await claim())[0].c).toBe(false);
    await as(service, `select public.finish_stripe_event('evt_A', 'failed', 'boom')`);
    expect((await claim())[0].c).toBe(true);
    await as(service, `select public.finish_stripe_event('evt_A', 'processed')`);
    expect((await claim())[0].c).toBe(false);
  });

  it('is not callable by end users', async () => {
    await expectDenied(as(owner, `select public.claim_stripe_event('evt_B', 'x', now())`), /permission denied/);
    await expectDenied(as(owner, `select public.sync_subscription($1, '{}'::jsonb)`, [org]), /permission denied/);
    await expectDenied(as(owner, `select public.check_rate_limit('x', 1, 60)`), /permission denied/);
  });
});

describe('subscription mirror', () => {
  it('starts a trial, consumes the one-per-org trial and records history', async () => {
    expect((await sync(sub(), 'evt_1'))[0].r).toBe('synced');
    const [o] = await sys<{ trial_consumed_at: Date | null }>(`select trial_consumed_at from public.organizations where id = $1`, [org]);
    expect(o.trial_consumed_at).not.toBeNull();
    const ev = await sys(`select kind from public.subscription_events where organization_id = $1`, [org]);
    expect(ev).toEqual([{ kind: 'trial_started' }]);
    // members can read their subscription state; outsiders cannot
    expect(await as(owner, `select status from public.subscriptions where organization_id = $1`, [org])).toEqual([{ status: 'trialing' }]);
  });

  it('ignores stale (out-of-order) updates', async () => {
    expect((await sync(sub({ status: 'active', synced_at: '2026-11-09T00:00:00Z' })))[0].r).toBe('synced');
    expect((await sync(sub({ status: 'trialing', synced_at: '2026-11-02T00:00:00Z' })))[0].r).toBe('stale');
    const [s] = await sys(`select status from public.subscriptions where organization_id = $1`, [org]);
    expect(s).toEqual({ status: 'active' });
  });

  it('tracks scheduled cancellation, then cancellation keeps data and sets a retention review date', async () => {
    await sync(sub({ status: 'active', cancel_at_period_end: true, synced_at: '2026-11-10T00:00:00Z' }));
    await sync(sub({ status: 'canceled', ended_at: '2026-12-08T00:00:00Z', synced_at: '2026-12-08T00:00:00Z' }));
    const [o] = await sys<{ canceled_at: Date; retention_review_at: Date; status: string }>(
      `select canceled_at, retention_review_at, status from public.organizations where id = $1`, [org]);
    expect(o.status).toBe('active'); // org itself is not destroyed or suspended
    expect(o.canceled_at.toISOString()).toBe('2026-12-08T00:00:00.000Z');
    expect(o.retention_review_at.toISOString()).toBe('2027-12-08T00:00:00.000Z');
    expect((await sys(`select count(*)::int as n from public.locations where organization_id = $1`, [org]))[0]).toEqual({ n: 1 });
    const kinds = (await sys<{ kind: string }>(`select kind from public.subscription_events where organization_id = $1 order by id`, [org])).map((r) => r.kind);
    expect(kinds).toContain('cancel_scheduled');
  });

  it('a new live subscription reactivates the account; a stale canceled one cannot overwrite it', async () => {
    await sync(sub({ stripe_subscription_id: 'sub_2', status: 'active', trial_start: null, trial_end: null, synced_at: '2027-01-05T00:00:00Z' }), 'evt_r');
    const [o] = await sys<{ canceled_at: Date | null }>(`select canceled_at from public.organizations where id = $1`, [org]);
    expect(o.canceled_at).toBeNull();
    const kinds = (await sys<{ kind: string }>(`select kind from public.subscription_events where organization_id = $1`, [org])).map((r) => r.kind);
    expect(kinds).toContain('reactivated');
    expect((await sync(sub({ stripe_subscription_id: 'sub_1', status: 'canceled', synced_at: '2027-02-01T00:00:00Z' })))[0].r).toBe('ignored_other_subscription');
  });
});

describe('rate limiter', () => {
  it('allows up to the limit within a window', async () => {
    const hit = async () => (await as<{ ok: boolean }>(service, `select public.check_rate_limit('lead:1.2.3.4', 3, 3600) as ok`))[0].ok;
    expect([await hit(), await hit(), await hit(), await hit()]).toEqual([true, true, true, false]);
  });
});

describe('schema-wide guards', () => {
  it('every public table has RLS enabled', async () => {
    const rows = await sys<{ relname: string }>(`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`);
    expect(rows).toEqual([]);
  });

  it('anon has no table privileges and no executable public functions', async () => {
    const tables = await sys(`select table_name, privilege_type from information_schema.role_table_grants
                              where grantee = 'anon' and table_schema = 'public'`);
    expect(tables).toEqual([]);
    const fns = await sys(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                           where n.nspname in ('public', 'private') and has_function_privilege('anon', p.oid, 'execute')`);
    expect(fns).toEqual([]);
  });

  it('every SECURITY DEFINER function pins its search_path', async () => {
    const rows = await sys(`select n.nspname, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private') and p.prosecdef
        and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`);
    expect(rows).toEqual([]);
  });

  it('the TypeScript permission catalog matches the database exactly', async () => {
    const perms = (await sys<{ key: string }>(`select key from public.permissions order by key`)).map((r) => r.key);
    expect(perms).toEqual([...ALL_PERMISSIONS].sort());
    for (const role of MEMBER_ROLES) {
      const dbPerms = (await sys<{ permission: string }>(
        `select permission from public.role_permissions where role = $1 order by permission`, [role])).map((r) => r.permission);
      expect(dbPerms, role).toEqual([...ROLE_DEFAULTS[role]].sort());
    }
  });
});
