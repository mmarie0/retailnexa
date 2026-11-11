import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, sys, createUser, createOrg, addMember, expectDenied, closeDb, type TestUser } from './helpers';

// Batch D part 2: vendor statements (#110) and the payroll_by_month roll-up.
let owner: TestUser, mgrA: TestUser, acct: TestUser, emp: TestUser, outsider: TestUser;
let org: string, other: string, A: string, vendor: string, otherVendor: string, rent: string, bill: string, otherBill: string;

beforeAll(async () => {
  owner = await createUser('vs-owner'); mgrA = await createUser('vs-mgrA'); acct = await createUser('vs-acct'); emp = await createUser('vs-emp'); outsider = await createUser('vs-out');
  org = await createOrg(owner, 'Statements Co', 'retail');
  other = await createOrg(outsider, 'Other Statements Co', 'retail');
  [{ id: A }] = await sys<{ id: string }>(`select id from public.locations where organization_id = $1 limit 1`, [org]);
  await as(owner, `insert into public.locations (organization_id, name, kind) values ($1, 'VS B', 'store')`, [org]);
  const m = await addMember(owner, org, mgrA, 'manager');
  await as(owner, `select public.set_member_locations($1, $2::uuid[])`, [m, [A]]);
  await addMember(owner, org, acct, 'accountant');
  await addMember(owner, org, emp, 'employee');
  [{ id: vendor }] = await as<{ id: string }>(owner, `insert into public.vendors (organization_id, name) values ($1, 'Statement Vendor') returning id`, [org]);
  [{ id: otherVendor }] = await as<{ id: string }>(owner, `insert into public.vendors (organization_id, name) values ($1, 'Another Vendor') returning id`, [org]);
  [{ id: rent }] = await sys<{ id: string }>(`select id from public.accounts where organization_id = $1 and role = 'rent'`, [org]);
  const mk = (v: string, n: string) => as<{ id: string }>(owner, `select public.create_bill($1, $2, $3, '2026-10-02'::date, null, $4::jsonb, null, $5) as id`, [org, v, n, JSON.stringify([{ account_id: rent, amount_cents: 50000 }]), A]);
  [{ id: bill }] = await mk(vendor, 'INV-1');
  [{ id: otherBill }] = await mk(otherVendor, 'INV-9');
});
afterAll(closeDb);

const lines = [{ line_date: '2026-10-02', reference: 'INV-1', amount_cents: 50000 }, { line_date: '2026-10-05', reference: 'INV-2', description: 'Wigs', amount_cents: 12000 }, { line_date: '2026-10-09', reference: 'PMT', amount_cents: -20000 }];
const create = (u: TestUser, ls: object[] = lines, v = vendor) =>
  as<{ id: string }>(u, `select public.create_vendor_statement($1, $2, '2026-10-31', $3::jsonb, 'Oct') as id`, [org, v, JSON.stringify(ls)]);

describe('vendor statements (#110)', () => {
  let stmt: string;
  it('saves a statement with its lines; bad lines are refused', async () => {
    [{ id: stmt }] = await create(owner);
    expect((await sys<{ n: string }>(`select count(*) as n from public.vendor_statement_lines where statement_id = $1`, [stmt]))[0].n).toBe('3');
    await expectDenied(create(owner, [{ reference: 'x', amount_cents: 0 }]), /amount \(not zero\)/);
    await expectDenied(create(owner, []), /1 to 500/);
    await expectDenied(create(owner, [{ line_date: '2099-01-01', amount_cents: 1 }]), /real date/);
  });
  it('links lines only to the same vendor’s bills, and can set a line aside', async () => {
    const [{ id: line }] = await sys<{ id: string }>(`select id from public.vendor_statement_lines where statement_id = $1 and reference = 'INV-1'`, [stmt]);
    await as(owner, `select public.set_statement_line($1, $2, $3, false)`, [org, line, bill]);
    await expectDenied(as(owner, `select public.set_statement_line($1, $2, $3, false)`, [org, line, otherBill]), /same vendor/);
    await as(owner, `select public.set_statement_line($1, $2, null, true)`, [org, line]);
    expect(await sys(`select bill_id, dismissed from public.vendor_statement_lines where id = $1`, [line])).toEqual([{ bill_id: null, dismissed: true }]);
  });
  it('read and write need bills access and every store; outsiders and anon see nothing', async () => {
    expect((await as(acct, `select id from public.vendor_statements where organization_id = $1`, [org])).length).toBe(1);
    expect(await as(mgrA, `select id from public.vendor_statements where organization_id = $1`, [org])).toEqual([]);
    expect(await as(mgrA, `select id from public.vendor_statement_lines where organization_id = $1`, [org])).toEqual([]);
    await expectDenied(create(mgrA));
    expect(await as(emp, `select id from public.vendor_statements where organization_id = $1`, [org])).toEqual([]);
    await expectDenied(create(emp));
    expect(await as(outsider, `select id from public.vendor_statements where organization_id = $1`, [org])).toEqual([]);
    await expectDenied(as(outsider, `select public.create_vendor_statement($1, $2, '2026-10-31', $3::jsonb, null)`, [other, vendor, JSON.stringify(lines)]), /pick a vendor/);
    await expectDenied(as({ kind: 'anon' } as never, `select public.delete_vendor_statement($1, $2)`, [org, stmt]));
    await expectDenied(as(owner, `update public.vendor_statement_lines set dismissed = false where statement_id = $1`, [stmt]));
  });
  it('removing the statement removes its lines', async () => {
    const [{ id: s2 }] = await create(owner, [{ reference: 'INV-1', amount_cents: 50000 }]);
    const [{ id: l2 }] = await sys<{ id: string }>(`select id from public.vendor_statement_lines where statement_id = $1`, [s2]);
    await as(owner, `select public.set_statement_line($1, $2, $3, false)`, [org, l2, bill]);
    await as(owner, `select public.delete_vendor_statement($1, $2)`, [org, s2]);
    expect(await sys(`select 1 from public.vendor_statement_lines where id = $1`, [l2])).toEqual([]);
  });
});

describe('payroll_by_month', () => {
  it('sums paid payroll per month for payroll viewers only', async () => {
    const [{ id: e }] = await sys<{ id: string }>(`insert into public.employees (organization_id, location_id, name) values ($1, $2, 'PBM') returning id`, [org, A]);
    const run = async (d: string, voided = false) => {
      const [{ id }] = await sys<{ id: string }>(`insert into public.pay_runs (organization_id, pay_date, period_start, period_end, voided_at) values ($1, $2::date, $2::date - 6, $2::date, ${voided ? 'now()' : 'null'}) returning id`, [org, d]);
      await sys(`insert into public.pay_run_lines (organization_id, run_id, employee_id, pay_type, hours, rate_cents, regular_cents, gross_cents, net_cents, employer_tax_cents) values ($1, $2, $3, 'hourly', 10, 1000, 10000, 10000, 10000, 765)`, [org, id, e]);
    };
    await run('2026-09-05'); await run('2026-09-12'); await run('2026-10-03'); await run('2026-10-10', true);
    const rows = await as<{ month: string; cents: string; runs: number }>(owner, `select month::text, cents, runs from public.payroll_by_month($1, '2026-09-01', '2026-10-31') order by 1`, [org]);
    expect(rows.map((r) => [r.month, Number(r.cents), r.runs])).toEqual([['2026-09-01', 21530, 2], ['2026-10-01', 10765, 1]]);
    expect(await as(emp, `select * from public.payroll_by_month($1, '2026-09-01', '2026-10-31')`, [org])).toEqual([]);
    expect(await as(owner, `select * from public.payroll_by_month($1, '2020-01-01', '2026-10-31')`, [org])).toEqual([]);
    await expectDenied(as({ kind: 'anon' } as never, `select * from public.payroll_by_month($1, '2026-09-01', '2026-10-31')`, [org]));
  });
});
