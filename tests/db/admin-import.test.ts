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
});
afterAll(closeDb);

const run = (kind: string, rows: object[], dry = false, who: Actor = adminS()) =>
  as<{ r: { imported: number; skipped: number; failed: number; errors: { error: string }[] } }>(who,
    `select public.admin_import_rows($1, $2, $3::jsonb, $4, 'retailnexa_backup', 'test.json') as r`, [org, kind, JSON.stringify(rows), dry]);

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
    expect(b).toMatchObject({ status: 'approved', paid_cents: '100000', created_by: owner.id });
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
    await expectDenied(as(adminS(), `select public.admin_import_rows($1, 'vendor', '[{"key":"x","name":"Y"}]'::jsonb, true)`, [o2]), /read-only/);
  });
});
