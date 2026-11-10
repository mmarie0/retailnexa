import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, sys, createUser, createOrg, verifyMfa, expectDenied, closeDb, type Actor, type TestUser } from './helpers';

let owner: TestUser, admin: TestUser, other: TestUser;
let org: string;
const adminS = (): Actor => ({ ...admin, aal: 'aal2' });

beforeAll(async () => {
  owner = await createUser('imp-owner'); admin = await createUser('imp-admin'); other = await createUser('imp-other');
  org = await createOrg(owner, 'Import Co', 'retail');
  await verifyMfa(admin);
  await sys(`insert into public.platform_admins (user_id, role) values ($1, 'superadmin')`, [admin.id]);
  await grant(org);
});
const grant = (o: string) => sys(`insert into public.support_access_grants (organization_id, granted_by, reason, expires_at) values ($1, $2, 'Import our old data', now() + interval '24 hours')`, [o, owner.id]);
afterAll(closeDb);

type R = { imported: number; skipped: number; failed: number; errors: { error: string; key?: string }[]; run: string };
const run = (kind: string, rows: object[], dry = false, who: Actor = adminS(), o = org) =>
  as<{ r: R }>(who, `select public.admin_import_rows($1, $2, $3::jsonb, $4, 'retailnexa_backup', 'test.json') as r`, [o, kind, JSON.stringify(rows), dry]);
const one = async (kind: string, rows: object[], o = org) => (await run(kind, rows, false, adminS(), o))[0].r;

describe('admin master import', () => {
  it('only a superadmin with two-factor can import', async () => {
    await expectDenied(run('vendor', [{ key: 'v1', name: 'X' }], true, owner));
    await expectDenied(run('vendor', [{ key: 'v1', name: 'X' }], true, { ...admin, aal: 'aal1' as const }));
    await expectDenied(run('vendor', [{ key: 'v1', name: 'X' }], true, other));
  });

  it('dry run reports what would happen and writes nothing', async () => {
    const [{ r }] = await run('vendor', [{ key: 'v1', name: 'Hair Zone' }, { key: 'v2', name: '' }], true);
    expect(r).toMatchObject({ imported: 1, failed: 1 });
    expect(r.errors[0].error).toMatch(/vendor name is missing/);
    expect(await sys(`select 1 from public.vendors where organization_id = $1`, [org])).toHaveLength(0);
  });

  it('imports bills with payments through the normal rules, once', async () => {
    const bill = { key: 'b1', vendor: 'Hair Zone', bill_number: 'INV-1', bill_date: '2026-10-01', due_date: '2026-10-31', amount_cents: 193400,
      account_role: 'inventory', memo: 'Hair order', payments: [{ date: '2026-10-05', amount_cents: 100000, source: 'bank' }] };
    const [{ r }] = await run('bill', [bill]);
    expect(r).toMatchObject({ imported: 1, failed: 0 });
    const [b] = await sys<{ status: string; paid_cents: string; created_by: string }>(
      `select status, paid_cents, created_by from public.bills where organization_id = $1 and bill_number = 'INV-1'`, [org]);
    expect(b).toMatchObject({ status: 'approved', paid_cents: '100000', created_by: admin.id });
    // ledger balanced: AP entry + payment
    const [t] = await sys<{ d: string; c: string }>(`select sum(debit_cents) as d, sum(credit_cents) as c from public.journal_lines l join public.journal_entries e on e.id = l.entry_id where e.organization_id = $1`, [org]);
    expect(t.d).toBe(t.c);
    const [{ r: again }] = await run('bill', [bill]);
    expect(again).toMatchObject({ imported: 0, skipped: 1 });
  });

  it('imports fixed costs, sales days and bank lines; bad rows are reported, not fatal', async () => {
    const [{ r: f }] = await run('recurring', [{ key: 'f1', name: 'TECO', amount_cents: 160000, day_of_month: 8, next_date: '2026-12-08', account_role: 'utilities' }]);
    expect(f.imported).toBe(1);
    const [{ r: s }] = await run('sales_day', [
      { key: '2026-10-02', date: '2026-10-02', gross_sales_cents: 100000, sales_tax_cents: 7500, cash_cents: 50000, card_cents: 57500 },
      { key: '2026-10-03', date: '2026-10-03', gross_sales_cents: 100000, sales_tax_cents: 0, cash_cents: 1, card_cents: 0 },
    ]);
    expect(s).toMatchObject({ imported: 1, failed: 1 });
    expect(s.errors[0].error).toMatch(/payments/);
    const [{ r: bk }] = await run('bank_line', [{ date: '2026-10-05', description: 'ACH HAIR ZONE', amount_cents: -100000 }]);
    expect(bk.imported).toBe(1);
    const runs = await as(adminS(), `select kind, imported from public.import_runs where organization_id = $1`, [org]);
    expect(runs.length).toBeGreaterThan(3);
    expect(await as(owner, `select 1 from public.import_runs where organization_id = $1`, [org])).toHaveLength(0);
  });

  it('refuses a read-only business', async () => {
    const o2 = await createOrg(other, 'No Plan Co', 'retail', { subscribe: false });
    await grant(o2);
    await expectDenied(as(adminS(), `select public.admin_import_rows($1, 'vendor', '[{"key":"x","name":"Y"}]'::jsonb, true)`, [o2]), /read-only/);
  });
});

describe('#128 consent and attribution', () => {
  it('needs a live support grant from the business, for dry runs too', async () => {
    const u = await createUser('imp-nogrant');
    const o = await createOrg(u, 'No Grant Co', 'retail');
    await expectDenied(run('vendor', [{ key: 'v', name: 'X' }], true, adminS(), o), /support access/);
    await sys(`insert into public.support_access_grants (organization_id, granted_by, reason, expires_at, revoked_at) values ($1, $2, 'old', now() + interval '1 hour', now())`, [o, u.id]);
    await expectDenied(run('vendor', [{ key: 'v', name: 'X' }], true, adminS(), o), /support access/);
  });

  it('a superadmin session without a second factor is refused even if MFA isn’t required for them', async () => {
    await expectDenied(run('vendor', [{ key: 'v', name: 'X' }], true, { ...admin, aal: 'aal1' as const }));
  });

  it('every record an import writes names the admin, not the owner', async () => {
    const r = await one('bill', [{ key: 'attr-1', vendor: 'Attr Vendor', bill_number: 'ATTR-1', bill_date: '2026-10-01', due_date: '2026-10-30', amount_cents: 5000,
      account_role: 'inventory', payments: [{ date: '2026-10-02', amount_cents: 5000, source: 'bank' }] }]);
    expect(r).toMatchObject({ imported: 1, failed: 0 });
    const [b] = await sys<{ id: string; created_by: string; approved_by: string }>(`select id, created_by, approved_by from public.bills where organization_id = $1 and bill_number = 'ATTR-1'`, [org]);
    expect(b).toMatchObject({ created_by: admin.id, approved_by: admin.id });
    const pays = await sys<{ created_by: string }>(`select created_by from public.bill_payments where bill_id = $1`, [b.id]);
    expect(pays.map((p) => p.created_by)).toEqual([admin.id]);
    const posted = await sys<{ posted_by: string }>(`select distinct posted_by from public.journal_entries where organization_id = $1 and created_at = (select created_at from public.bills where id = $2)`, [org, b.id]);
    expect(posted.map((p) => p.posted_by)).toEqual([admin.id]);
    const logs = await sys<{ action: string; actor_type: string; actor_user_id: string; m: { on_behalf_of?: string; import_run_id?: string } }>(
      `select action, actor_type, actor_user_id, metadata as m from public.audit_logs where organization_id = $1 and (metadata ->> 'import_run_id') = $2`, [org, r.run]);
    expect(logs.length).toBeGreaterThanOrEqual(5);
    for (const l of logs) expect(l).toMatchObject({ actor_type: 'platform_admin', actor_user_id: admin.id });
    expect(logs.filter((l) => l.action !== 'admin.import').every((l) => l.m.on_behalf_of === owner.id)).toBe(true);
    expect(await sys(`select action from public.audit_logs where organization_id = $1 and actor_user_id = $2 and created_at >= (select created_at from public.import_runs where id = $3)`, [org, owner.id, r.run])).toEqual([]);
  });

  it('the attribution can’t be forged: outside an import run the setting does nothing', async () => {
    const [{ id: run }] = await sys<{ id: string }>(`select id from public.import_runs where organization_id = $1 limit 1`, [org]);
    const rows = await as<{ a: string | null }>(owner, `select set_config('app.import_run', $1, true), (select private.import_actor()) as a`, [run]).catch(() => [{ a: 'denied' }]);
    // Clients can't call private functions; and even the setting alone names no one outside the run's own transaction.
    expect(rows[0].a === null || rows[0].a === 'denied').toBe(true);
    const [{ a }] = await sys<{ a: string | null }>(`select set_config('app.import_run', $1, true), private.import_actor() as a`, [run]);
    expect(a).toBeNull();
  });

  it('import runs are visible to superadmins only', async () => {
    const support = await createUser('imp-support');
    await verifyMfa(support);
    await sys(`insert into public.platform_admins (user_id, role) values ($1, 'support')`, [support.id]);
    expect(await as({ ...support, aal: 'aal2' }, `select 1 from public.import_runs where organization_id = $1`, [org])).toHaveLength(0);
  });
});

describe('#130 dates and #131 stores', () => {
  it('rejects special, impossible and out-of-range dates before anything is posted', async () => {
    const bill = (k: string, d: string) => ({ key: k, vendor: 'Date Vendor', bill_number: k, bill_date: d, due_date: d, amount_cents: 100, account_role: 'inventory' });
    const r = await one('bill', [bill('d1', 'infinity'), bill('d2', '9999-12-31'), bill('d3', '0201-10-01'), bill('d4', '2026-02-30'), bill('d5', 'epoch')]);
    expect(r).toMatchObject({ imported: 0, failed: 5 });
    expect(r.errors.map((e) => e.error).join(' ')).toMatch(/outside|not a real date|date like/);
    expect(await sys(`select 1 from public.bills where organization_id = $1 and vendor_id in (select id from public.vendors where name = 'Date Vendor')`, [org])).toHaveLength(0);
    const p = await one('bill', [{ ...bill('d6', '2026-10-01'), payments: [{ date: 'infinity', amount_cents: 100 }] }]);
    expect(p.failed).toBe(1);
    const neg = await one('bill', [{ ...bill('d7', '2026-10-01'), payments: [{ date: '2026-10-02', amount_cents: -100 }] }]);
    expect(neg.errors[0].error).toMatch(/positive/);
    const s = await one('sales_day', [{ key: 'future', date: '2099-01-01', gross_sales_cents: 100, cash_cents: 100 }]);
    expect(s.failed).toBe(1);
    const bk = await one('bank_line', [{ date: 'infinity', description: 'X', amount_cents: -1 }]);
    expect(bk).toMatchObject({ imported: 0, failed: 1 });
  });

  it('an unmatched store is an error; sales need a store when there are several, and the store is part of the key', async () => {
    const u = await createUser('imp-2store');
    const o = await createOrg(u, 'Two Store Import Co', 'retail');
    await sys(`insert into public.support_access_grants (organization_id, granted_by, reason, expires_at) values ($1, $2, 'Import', now() + interval '1 hour')`, [o, u.id]);
    const [{ name: storeA }] = await sys<{ name: string }>(`select name from public.locations where organization_id = $1`, [o]);
    await as(u, `insert into public.locations (organization_id, name, kind) values ($1, 'Store B', 'store')`, [o]);
    const typo = await one('bill', [{ key: 't', vendor: 'V', bill_date: '2026-10-01', due_date: '2026-10-02', amount_cents: 100, account_role: 'inventory', location: 'Stroe B (typo)' }], o);
    expect(typo.errors[0].error).toMatch(/store "Stroe B \(typo\)" not found/);
    const day = { key: '2026-10-02|All registers', date: '2026-10-02', gross_sales_cents: 1000, cash_cents: 1000 };
    const none = await one('sales_day', [day], o);
    expect(none.errors[0].error).toMatch(/2 stores/);
    expect(await one('sales_day', [{ ...day, location: storeA }], o)).toMatchObject({ imported: 1 });
    expect(await one('sales_day', [{ ...day, location: 'Store B' }], o)).toMatchObject({ imported: 1, skipped: 0 });
    expect(await one('sales_day', [{ ...day, location: 'store b' }], o)).toMatchObject({ imported: 0, skipped: 1 });
  });

  it('rows without a key and very long keys work without colliding', async () => {
    const long = 'x'.repeat(300);
    const r = await one('vendor', [{ name: 'Keyless Vendor' }, { key: `${long}1`, name: 'Long Key A' }, { key: `${long}2`, name: 'Long Key B' }]);
    expect(r).toMatchObject({ imported: 3, failed: 0 });
  });
});

describe('#133 long keys never collide in derived ids', () => {
  it('a long key keeps two identical payments, and numberless bills with a shared key prefix both import', async () => {
    const k = 'k'.repeat(120);
    const r = await one('bill', [{ key: k, vendor: 'Long Key Vendor', bill_date: '2026-10-01', due_date: '2026-10-30', amount_cents: 1000, account_role: 'inventory',
      payments: [{ date: '2026-10-02', amount_cents: 300, source: 'bank' }, { date: '2026-10-02', amount_cents: 300, source: 'bank' }] }]);
    expect(r).toMatchObject({ imported: 1, failed: 0 });
    const [b] = await sys<{ id: string; paid_cents: string }>(`select id, paid_cents from public.bills where organization_id = $1 and vendor_id = (select id from public.vendors where organization_id = $1 and name = 'Long Key Vendor')`, [org]);
    expect(b.paid_cents).toBe('600');
    expect(await sys(`select 1 from public.bill_payments where bill_id = $1`, [b.id])).toHaveLength(2);
    const prefix = 'collision vendor with a long name|2026-10-0';
    const two = await one('bill', [1, 2].map((d) => ({ key: `${prefix}${d}|1000`, vendor: 'Coll V', bill_date: `2026-10-0${d}`, due_date: '2026-10-30', amount_cents: 1000, account_role: 'inventory' })));
    expect(two).toMatchObject({ imported: 2, failed: 0 });
  });
});
