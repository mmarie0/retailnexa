import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, sys, createUser, createOrg, addMember, expectDenied, closeDb, type TestUser } from './helpers';

let alice: TestUser, bob: TestUser, mona: TestUser, carl: TestUser, ada: TestUser, olga: TestUser;
let orgA: string, orgB: string;
let carlM: string, adaM: string;

beforeAll(async () => {
  alice = await createUser('alice'); // owner of A
  bob = await createUser('bob'); // owner of B
  mona = await createUser('mona'); // manager in A
  carl = await createUser('carl'); // employee in A
  ada = await createUser('ada'); // admin in A
  olga = await createUser('olga'); // second owner candidate in A
  orgA = await createOrg(alice, 'JLO Test Store', 'retail');
  orgB = await createOrg(bob, 'Other Wholesale', 'wholesale');
  await addMember(alice, orgA, mona, 'manager');
  carlM = await addMember(alice, orgA, carl, 'employee');
  adaM = await addMember(alice, orgA, ada, 'admin');
});
afterAll(closeDb);

describe('signup & organization creation', () => {
  it('creates a profile for every new auth user', async () => {
    const [p] = await sys(`select email, full_name from public.profiles where id = $1`, [alice.id]);
    expect(p).toMatchObject({ email: alice.email, full_name: 'alice' });
  });

  it('create_organization makes the caller owner, adds a first location and audits it', async () => {
    const [m] = await sys(`select role, status from public.memberships where organization_id = $1 and user_id = $2`, [orgA, alice.id]);
    expect(m).toEqual({ role: 'owner', status: 'active' });
    const locs = await sys(`select kind from public.locations where organization_id = $1`, [orgB]);
    expect(locs).toEqual([{ kind: 'warehouse' }]);
    const audit = await sys(`select 1 from public.audit_logs where organization_id = $1 and action = 'organization.created'`, [orgA]);
    expect(audit).toHaveLength(1);
  });

  it('rejects anonymous callers and invalid timezones', async () => {
    await expectDenied(as({ kind: 'anon' }, `select public.create_organization('X', 'retail')`), /permission denied/);
    await expectDenied(as(alice, `select public.create_organization('X', 'retail', null, 'Mars/Base')`), /invalid timezone/);
  });
});

describe('tenant isolation', () => {
  it('a user cannot see another tenant’s organization, locations, members or audit log', async () => {
    expect(await as(bob, `select id from public.organizations where id = $1`, [orgA])).toHaveLength(0);
    expect(await as(bob, `select id from public.locations where organization_id = $1`, [orgA])).toHaveLength(0);
    expect(await as(bob, `select id from public.memberships where organization_id = $1`, [orgA])).toHaveLength(0);
    expect(await as(bob, `select id from public.audit_logs where organization_id = $1`, [orgA])).toHaveLength(0);
    expect(await as(bob, `select id from public.profiles where id = $1`, [alice.id])).toHaveLength(0);
  });

  it('a user cannot write into another tenant', async () => {
    await expectDenied(as(bob, `insert into public.locations (organization_id, name) values ($1, 'Sneaky')`, [orgA]));
    const updated = await as(bob, `update public.organizations set name = 'pwned' where id = $1 returning id`, [orgA]);
    expect(updated).toHaveLength(0);
    await expectDenied(as(bob, `select public.invite_member($1, 'x@example.test', 'employee')`, [orgA]));
  });

  it('member_locations cannot link a membership to another org’s location', async () => {
    const [locB] = await sys<{ id: string }>(`select id from public.locations where organization_id = $1`, [orgB]);
    await expectDenied(
      as(alice, `insert into public.member_locations (membership_id, location_id, organization_id) values ($1, $2, $3)`, [carlM, locB.id, orgA]),
      /same organization|row-level/,
    );
  });

  it('anonymous visitors cannot read any table', async () => {
    for (const t of ['organizations', 'profiles', 'memberships', 'locations', 'subscriptions', 'leads', 'audit_logs', 'announcements']) {
      await expectDenied(as({ kind: 'anon' }, `select * from public.${t} limit 1`), /permission denied/);
    }
  });
});

describe('role-based permissions', () => {
  it('my_permissions reflects role defaults', async () => {
    const [{ p }] = await as<{ p: string[] }>(carl, `select public.my_permissions($1) as p`, [orgA]);
    expect(p).toContain('pos.use');
    expect(p).not.toContain('members.view');
    expect(p).not.toContain('profit.view');
    const [{ p: none }] = await as<{ p: string[] }>(bob, `select public.my_permissions($1) as p`, [orgA]);
    expect(none).toEqual([]);
  });

  it('employees cannot edit the organization or see teammates or the audit log', async () => {
    expect(await as(carl, `update public.organizations set name = 'x' where id = $1 returning id`, [orgA])).toHaveLength(0);
    const members = await as<{ user_id: string }>(carl, `select user_id from public.memberships where organization_id = $1`, [orgA]);
    expect(members.map((m) => m.user_id)).toEqual([carl.id]);
    expect(await as(carl, `select id from public.audit_logs where organization_id = $1`, [orgA])).toHaveLength(0);
  });

  it('managers can view the team but cannot manage locations or invite at/above their rank', async () => {
    expect((await as(mona, `select id from public.memberships where organization_id = $1`, [orgA])).length).toBeGreaterThan(2);
    await expectDenied(as(mona, `insert into public.locations (organization_id, name) values ($1, 'Store 2')`, [orgA]));
    await expectDenied(as(mona, `select public.invite_member($1, 'x@example.test', 'admin')`, [orgA]));
  });

  it('owners can edit allowed columns but never status, trial or retention fields', async () => {
    const ok = await as(alice, `update public.organizations set phone = '813-555-0100' where id = $1 returning id`, [orgA]);
    expect(ok).toHaveLength(1);
    await expectDenied(as(alice, `update public.organizations set status = 'active' where id = $1`, [orgA]), /permission denied/);
    await expectDenied(as(alice, `update public.organizations set trial_consumed_at = null where id = $1`, [orgA]), /permission denied/);
  });

  it('nobody can write memberships directly (only via RPC)', async () => {
    await expectDenied(as(alice, `update public.memberships set role = 'owner' where id = $1`, [carlM]), /permission denied/);
    await expectDenied(as(carl, `insert into public.memberships (organization_id, user_id, role) values ($1, $2, 'owner')`, [orgA, carl.id]), /permission denied/);
  });
});

describe('member management rules', () => {
  it('admins cannot change owners or themselves, and cannot grant admin', async () => {
    const [aliceM] = await sys<{ id: string }>(`select id from public.memberships where organization_id = $1 and user_id = $2`, [orgA, alice.id]);
    await expectDenied(as(ada, `select public.update_member_role($1, 'viewer')`, [aliceM.id]));
    await expectDenied(as(ada, `select public.update_member_role($1, 'owner')`, [adaM]));
    await expectDenied(as(ada, `select public.update_member_role($1, 'admin')`, [carlM]));
    await as(ada, `select public.update_member_role($1, 'viewer')`, [carlM]);
    await as(ada, `select public.update_member_role($1, 'employee')`, [carlM]);
  });

  it('the last owner cannot be demoted or disabled; a second owner can be', async () => {
    const [aliceM] = await sys<{ id: string }>(`select id from public.memberships where organization_id = $1 and user_id = $2`, [orgA, alice.id]);
    const olgaM = await addMember(alice, orgA, olga, 'manager');
    await as(alice, `select public.update_member_role($1, 'owner')`, [olgaM]);
    // olga (owner) demotes alice — allowed now that two owners exist
    await as(olga, `select public.update_member_role($1, 'admin')`, [aliceM.id]);
    // olga is now the only owner; alice (admin) cannot touch her
    await expectDenied(as(alice, `select public.set_member_status($1, 'disabled')`, [olgaM]));
    // restore
    await as(olga, `select public.update_member_role($1, 'owner')`, [aliceM.id]);
    await as(alice, `select public.update_member_role($1, 'manager')`, [olgaM]);
    // alice is sole owner again: cannot be demoted by anyone (self-change blocked, others lack rank)
    await expectDenied(as(alice, `select public.update_member_role($1, 'admin')`, [aliceM.id]), /your own access/);
  });

  it('permission overrides: owner can grant a held permission; managers cannot override', async () => {
    await as(alice, `select public.set_member_permission($1, 'reports.view', true)`, [carlM]);
    const [{ p }] = await as<{ p: string[] }>(carl, `select public.my_permissions($1) as p`, [orgA]);
    expect(p).toContain('reports.view');
    await as(alice, `select public.set_member_permission($1, 'pos.use', false)`, [carlM]);
    const [{ p: p2 }] = await as<{ p: string[] }>(carl, `select public.my_permissions($1) as p`, [orgA]);
    expect(p2).not.toContain('pos.use');
    await as(alice, `select public.set_member_permission($1, 'pos.use', null)`, [carlM]);
    await expectDenied(as(mona, `select public.set_member_permission($1, 'reports.view', true)`, [carlM]));
  });
});

describe('invitations', () => {
  it('only the invited email can accept, and only once; hashes are never readable', async () => {
    const eve = await createUser('eve');
    const intended = await createUser('intended');
    const [inv] = await as<{ token: string }>(alice, `select token from public.invite_member($1, $2, 'employee')`, [orgA, intended.email]);
    await expectDenied(as(eve, `select public.accept_invitation($1)`, [inv.token]));
    await as(intended, `select public.accept_invitation($1)`, [inv.token]);
    await expectDenied(as(intended, `select public.accept_invitation($1)`, [inv.token]));
    await expectDenied(as(alice, `select token_hash from public.invitations`), /permission denied/);
    expect(await sys(`select 1 from public.invitations where token_hash = $1`, [inv.token])).toHaveLength(0);
  });

  it('accounts with an unconfirmed email cannot accept', async () => {
    const pending = await createUser('pending');
    await sys(`update auth.users set email_confirmed_at = null where id = $1`, [pending.id]);
    const [inv] = await as<{ token: string }>(alice, `select token from public.invite_member($1, $2, 'viewer')`, [orgA, pending.email]);
    await expectDenied(as(pending, `select public.accept_invitation($1)`, [inv.token]), /confirm your email/);
  });

  it('expired invitations cannot be accepted', async () => {
    const late = await createUser('late');
    const [inv] = await as<{ invitation_id: string; token: string }>(alice, `select * from public.invite_member($1, $2, 'viewer')`, [orgA, late.email]);
    await sys(`update public.invitations set expires_at = now() - interval '1 minute' where id = $1`, [inv.invitation_id]);
    await expectDenied(as(late, `select public.accept_invitation($1)`, [inv.token]));
  });
});

describe('audit log', () => {
  it('records configuration changes with the acting user', async () => {
    const rows = await sys<{ actor_user_id: string }>(
      `select actor_user_id from public.audit_logs where organization_id = $1 and action = 'organizations.update' order by id desc limit 1`, [orgA]);
    expect(rows[0]?.actor_user_id).toBe(alice.id);
  });

  it('is append-only even for the database superuser', async () => {
    await expect(sys(`update public.audit_logs set action = 'x'`)).rejects.toThrow(/append-only/);
    await expect(sys(`delete from public.audit_logs`)).rejects.toThrow(/append-only/);
    await expectDenied(as(alice, `insert into public.audit_logs (actor_type, action) values ('user', 'forged')`), /permission denied/);
  });
});

describe('platform admin & support access', () => {
  let pat: TestUser, bill: TestUser;
  beforeAll(async () => {
    pat = await createUser('pat');
    bill = await createUser('bill');
    await sys(`insert into public.platform_admins (user_id, role) values ($1, 'support'), ($2, 'billing')`, [pat.id, bill.id]);
  });

  it('requires an MFA (aal2) session', async () => {
    expect(await as({ ...pat, aal: 'aal1' }, `select id from public.organizations where id = $1`, [orgA])).toHaveLength(0);
    expect(await as({ ...pat, aal: 'aal2' }, `select id from public.organizations where id = $1`, [orgA])).toHaveLength(1);
  });

  it('tenant business data requires a live, tenant-granted support grant', async () => {
    const check = () => as<{ ok: boolean }>({ ...pat, aal: 'aal2' }, `select private.has_support_access($1) as ok`, [orgA]);
    expect((await check())[0].ok).toBe(false);
    const [{ id }] = await as<{ id: string }>(alice, `select public.grant_support_access($1, 2, 'Help importing invoices') as id`, [orgA]);
    expect((await check())[0].ok).toBe(true);
    await as(alice, `select public.revoke_support_access($1)`, [id]);
    expect((await check())[0].ok).toBe(false);
    await expectDenied(as(carl, `select public.grant_support_access($1, 2, 'nope')`, [orgA]));
    await expectDenied(as(alice, `select public.grant_support_access($1, 100, 'too long')`, [orgA]), /between 1 and 72/);
  });

  it('only superadmin/billing can suspend; suspension makes the tenant read-only', async () => {
    await expectDenied(as({ ...pat, aal: 'aal2' }, `select public.admin_set_org_status($1, 'suspended', 'test')`, [orgB]));
    await expectDenied(as({ ...bill, aal: 'aal1' }, `select public.admin_set_org_status($1, 'suspended', 'test')`, [orgB]));
    await as({ ...bill, aal: 'aal2' }, `select public.admin_set_org_status($1, 'suspended', 'Chargeback review')`, [orgB]);
    expect(await as(bob, `select id from public.organizations where id = $1`, [orgB])).toHaveLength(1); // still readable (export)
    await expectDenied(as(bob, `insert into public.locations (organization_id, name) values ($1, 'New')`, [orgB]));
    await expectDenied(as(bob, `select public.invite_member($1, 'x@example.test', 'employee')`, [orgB]));
    const [log] = await sys<{ actor_type: string }>(`select actor_type from public.audit_logs where organization_id = $1 and action = 'organization.status_changed'`, [orgB]);
    expect(log.actor_type).toBe('platform_admin');
    await expectDenied(as({ ...bill, aal: 'aal2' }, `select public.admin_set_org_status($1, 'closed', 'x')`, [orgB]));
    await as({ ...bill, aal: 'aal2' }, `select public.admin_set_org_status($1, 'active', 'Resolved')`, [orgB]);
  });

  it('leads are visible only to platform admins and cannot be inserted by API users', async () => {
    await sys(`insert into public.leads (kind, name, email) values ('demo', 'Test Lead', 'lead@example.test')`);
    expect(await as(alice, `select id from public.leads`)).toHaveLength(0);
    expect((await as({ ...pat, aal: 'aal2' }, `select id from public.leads`)).length).toBeGreaterThan(0);
    await expectDenied(as(alice, `insert into public.leads (kind, name, email) values ('demo', 'x', 'x@x.x')`), /permission denied/);
  });
});
