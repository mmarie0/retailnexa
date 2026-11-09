/** Regression tests for the Phase 1 independent security review findings. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, sys, createUser, createOrg, addMember, expectDenied, closeDb, setSubscription, verifyMfa, type TestUser } from './helpers';

let owner: TestUser, admin: TestUser, mgr: TestUser;
let org: string, adminM: string, mgrM: string;

beforeAll(async () => {
  owner = await createUser('rv-owner');
  admin = await createUser('rv-admin');
  mgr = await createUser('rv-mgr');
  org = await createOrg(owner, 'Review Co', 'retail');
  adminM = await addMember(owner, org, admin, 'admin');
  mgrM = await addMember(owner, org, mgr, 'manager');
});
afterAll(closeDb);

const addStore = (u: TestUser, o: string, name: string) =>
  as(u, `insert into public.locations (organization_id, name, kind) values ($1, $2, 'store')`, [o, name]);

describe('billing state is enforced in the database (finding 2)', () => {
  it('an org without a subscription cannot write through the API', async () => {
    const u = await createUser('nosub');
    const o = await createOrg(u, 'No Sub Co', 'retail', { subscribe: false });
    await expectDenied(addStore(u, o, 'Extra'));
    await expectDenied(as(u, `select public.invite_member($1, 'x@example.test', 'employee')`, [o]));
    await expectDenied(as(u, `update public.organizations set phone = '1' where id = $1 returning id`, [o]).then((r) => { if (!r.length) throw new Error('row-level security'); }));
  });

  it('canceled and unpaid subscriptions are read-only; past_due has a 7-day grace from the first failure', async () => {
    const u = await createUser('states');
    const o = await createOrg(u, 'States Co', 'retail');
    for (const status of ['canceled', 'unpaid', 'incomplete']) {
      await setSubscription(o, status, { extraLocations: 5 }); // plenty of plan room: denial must come from billing state
      await expectDenied(addStore(u, o, `x-${status}`), /row-level security/);
    }
    await setSubscription(o, 'past_due', { pastDueSince: new Date(Date.now() - 3 * 86_400_000).toISOString(), extraLocations: 5 });
    await addStore(u, o, 'During grace');
    await setSubscription(o, 'past_due', { pastDueSince: new Date(Date.now() - 8 * 86_400_000).toISOString(), extraLocations: 5 });
    await expectDenied(addStore(u, o, 'After grace'), /row-level security/);
    // still readable for export
    expect(await as(u, `select id from public.locations where organization_id = $1`, [o])).not.toHaveLength(0);
  });

  it('sync_subscription anchors past_due_since to the first failure, not the period end', async () => {
    const u = await createUser('pd');
    const o = await createOrg(u, 'PD Co', 'retail', { subscribe: false });
    const sync = (status: string, at: string) => as({ kind: 'service' }, `select public.sync_subscription($1, $2::jsonb)`, [o, JSON.stringify({
      stripe_subscription_id: 'sub_pd', stripe_customer_id: 'cus_pd', status, products: ['retail'], synced_at: at,
      current_period_end: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    })]);
    await sync('active', '2026-01-01T00:00:00Z');
    await sync('past_due', '2026-01-02T00:00:00Z');
    const [a] = await sys<{ past_due_since: Date }>(`select past_due_since from public.subscriptions where organization_id = $1`, [o]);
    expect(a.past_due_since).not.toBeNull();
    await sys(`update public.subscriptions set past_due_since = now() - interval '10 days' where organization_id = $1`, [o]);
    await sync('past_due', '2026-01-03T00:00:00Z'); // a later retry must not reset the clock
    const [b] = await sys<{ days: number }>(`select extract(day from now() - past_due_since)::int as days from public.subscriptions where organization_id = $1`, [o]);
    expect(b.days).toBeGreaterThanOrEqual(9);
    await sync('active', '2026-01-04T00:00:00Z');
    const [c] = await sys(`select past_due_since from public.subscriptions where organization_id = $1`, [o]);
    expect(c).toEqual({ past_due_since: null });
  });
});

describe('plan location limit (finding 2)', () => {
  it('active stores cannot exceed 1 + purchased extra locations; warehouses and deactivation are unaffected', async () => {
    const u = await createUser('limit');
    const o = await createOrg(u, 'Limit Co', 'retail');
    await setSubscription(o, 'active', { products: ['retail'], extraLocations: 1 });
    await addStore(u, o, 'Second store');
    await expectDenied(addStore(u, o, 'Third store'), /plan includes 2 store/);
    await as(u, `insert into public.locations (organization_id, name, kind) values ($1, 'Back warehouse', 'warehouse')`, [o]);
    await as(u, `update public.locations set is_active = false where organization_id = $1 and name = 'Second store'`, [o]);
    await addStore(u, o, 'Replacement store');
  });
});

describe('location restrictions go through rank-checked RPC (finding 3)', () => {
  it('members cannot lift their own restriction or restrict someone above them', async () => {
    const [ownerM] = await sys<{ id: string }>(`select id from public.memberships where organization_id = $1 and user_id = $2`, [org, owner.id]);
    const [loc] = await sys<{ id: string }>(`select id from public.locations where organization_id = $1 limit 1`, [org]);
    await as(owner, `select public.set_member_locations($1, array[$2]::uuid[])`, [adminM, loc.id]);
    await expectDenied(as(admin, `select public.set_member_locations($1, '{}'::uuid[])`, [adminM]), /your own access/);
    await expectDenied(as(admin, `delete from public.member_locations where membership_id = $1`, [adminM]), /permission denied/);
    await expectDenied(as(admin, `select public.set_member_locations($1, array[$2]::uuid[])`, [ownerM.id, loc.id]));
    await as(admin, `select public.set_member_locations($1, array[$2]::uuid[])`, [mgrM, loc.id]);
    expect(await sys(`select 1 from public.member_locations where membership_id = $1`, [mgrM])).toHaveLength(1);
  });
});

describe('permission overrides do not survive demotion or removal (finding 4)', () => {
  it('drops overrides on role change and on disable', async () => {
    await as(owner, `select public.set_member_permission($1, 'data.export', true)`, [mgrM]);
    await as(owner, `select public.update_member_role($1, 'viewer')`, [mgrM]);
    const [{ p }] = await as<{ p: string[] }>(mgr, `select public.my_permissions($1) as p`, [org]);
    expect(p).not.toContain('data.export');
    await as(owner, `select public.update_member_role($1, 'manager')`, [mgrM]);
    await as(owner, `select public.set_member_permission($1, 'reports.export', true)`, [mgrM]);
    await as(owner, `select public.set_member_status($1, 'disabled')`, [mgrM]);
    await as(owner, `select public.set_member_status($1, 'active')`, [mgrM]);
    expect(await sys(`select 1 from public.member_permission_overrides where membership_id = $1`, [mgrM])).toHaveLength(0);
  });
});

describe('organizations can be deleted while audit history is kept (finding 5)', () => {
  it('owner-approved deletion works and leaves the audit trail', async () => {
    const u = await createUser('del');
    const o = await createOrg(u, 'Delete Me Co', 'retail');
    const before = await sys(`select count(*)::int as n from public.audit_logs where organization_id = $1`, [o]);
    await sys(`delete from public.organizations where id = $1`, [o]);
    const after = await sys<{ n: number }>(`select count(*)::int as n from public.audit_logs where organization_id = $1`, [o]);
    expect(after[0].n).toBeGreaterThanOrEqual((before[0] as { n: number }).n);
  });
});

describe('platform admin hardening (findings 10, 11)', () => {
  it('cannot grant platform access before a verified authenticator exists', async () => {
    const u = await createUser('tofu');
    await expect(sys(`insert into public.platform_admins (user_id, role) values ($1, 'support')`, [u.id])).rejects.toThrow(/two-factor/);
    await verifyMfa(u);
    await sys(`insert into public.platform_admins (user_id, role) values ($1, 'support')`, [u.id]);
  });

  it('billing admins cannot reopen a closed account; superadmins can', async () => {
    const sa = await createUser('sa');
    const ba = await createUser('ba');
    await verifyMfa(sa);
    await verifyMfa(ba);
    await sys(`insert into public.platform_admins (user_id, role) values ($1, 'superadmin'), ($2, 'billing')`, [sa.id, ba.id]);
    const u = await createUser('closed');
    const o = await createOrg(u, 'Closed Co', 'retail');
    await as({ ...sa, aal: 'aal2' }, `select public.admin_set_org_status($1, 'closed', 'Owner request')`, [o]);
    await expectDenied(as({ ...ba, aal: 'aal2' }, `select public.admin_set_org_status($1, 'active', 'Reopen')`, [o]));
    await as({ ...sa, aal: 'aal2' }, `select public.admin_set_org_status($1, 'active', 'Reopen')`, [o]);
  });
});

describe('other hardening (finding 11)', () => {
  it('ordinary members cannot read Stripe identifiers', async () => {
    await expectDenied(as(mgr, `select stripe_customer_id from public.subscriptions where organization_id = $1`, [org]), /permission denied/);
    expect(await as(mgr, `select status from public.subscriptions where organization_id = $1`, [org])).toHaveLength(1);
  });

  it('a table created by a future migration is not exposed to API roles by default', async () => {
    await sys(`create table public.zz_future_table (id int)`);
    const grants = await sys(`select privilege_type from information_schema.role_table_grants where table_name = 'zz_future_table' and grantee in ('anon', 'authenticated')`);
    await sys(`drop table public.zz_future_table`);
    expect(grants).toEqual([]);
  });

  it('profile email follows auth email changes', async () => {
    const u = await createUser('mover');
    await sys(`update auth.users set email = 'Moved.' || id || '@Example.test' where id = $1`, [u.id]);
    const [p] = await sys<{ email: string }>(`select email from public.profiles where id = $1`, [u.id]);
    expect(p.email).toBe(`moved.${u.id}@example.test`);
  });
});
