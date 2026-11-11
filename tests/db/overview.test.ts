import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, sys, createUser, createOrg, addMember, expectDenied, closeDb, type TestUser } from './helpers';

// #108 Overview: per-user layout table + the two SECURITY INVOKER roll-ups.
let owner: TestUser, mgrA: TestUser, emp: TestUser, outsider: TestUser;
let org: string, other: string, A: string, B: string, vendor: string, rent: string;

beforeAll(async () => {
  owner = await createUser('ov-owner'); mgrA = await createUser('ov-mgrA'); emp = await createUser('ov-emp'); outsider = await createUser('ov-out');
  org = await createOrg(owner, 'Overview Co', 'retail');
  other = await createOrg(outsider, 'Other Co', 'retail');
  [{ id: A }] = await sys<{ id: string }>(`select id from public.locations where organization_id = $1 limit 1`, [org]);
  [{ id: B }] = await as<{ id: string }>(owner, `insert into public.locations (organization_id, name, kind) values ($1, 'OV Store B', 'store') returning id`, [org]);
  const m = await addMember(owner, org, mgrA, 'manager');
  await as(owner, `select public.set_member_locations($1, $2::uuid[])`, [m, [A]]);
  await addMember(owner, org, emp, 'employee');
  [{ id: vendor }] = await as<{ id: string }>(owner, `insert into public.vendors (organization_id, name) values ($1, 'OV Vendor') returning id`, [org]);
  [{ id: rent }] = await sys<{ id: string }>(`select id from public.accounts where organization_id = $1 and role = 'rent'`, [org]);
  const day = (loc: string, date: string, gross: number) =>
    as(owner, `select public.record_sales_day($1, $2, $3::date, $4::bigint, 0, 70, $5::bigint, 0, 0, 'Reg 1')`, [org, loc, date, gross, gross + 70]);
  await day(A, '2026-10-01', 1000); await day(A, '2026-10-02', 2000); await day(B, '2026-10-01', 5000); await day(A, '2026-11-01', 400);
  const bill = (num: string, due: string, cents: number) => as<{ id: string }>(owner, `select public.create_bill($1, $2, $3, $4::date, $4::date, $5::jsonb, null, $6) as id`,
    [org, vendor, num, due, JSON.stringify([{ account_id: rent, amount_cents: cents }]), A]);
  await bill('OV-1', '2026-10-05', 10000); await bill('OV-2', '2026-10-20', 2500); await bill('OV-3', '2026-11-03', 700);
});
afterAll(closeDb);

describe('overview_layouts', () => {
  it('each person saves and reads only their own layout', async () => {
    await as(owner, `select public.save_overview_layout($1, $2::text[])`, [org, ['trend', 'quick']]);
    await as(mgrA, `select public.save_overview_layout($1, $2::text[])`, [org, ['sales']]);
    expect(await as(owner, `select layout from public.overview_layouts where organization_id = $1`, [org])).toEqual([{ layout: ['trend', 'quick'] }]);
    expect(await as(mgrA, `select layout from public.overview_layouts where organization_id = $1`, [org])).toEqual([{ layout: ['sales'] }]);
    await as(owner, `select public.save_overview_layout($1, $2::text[])`, [org, ['bills']]);
    expect(await as(owner, `select layout from public.overview_layouts where organization_id = $1`, [org])).toEqual([{ layout: ['bills'] }]);
  });
  it('an empty layout resets to the default (row removed)', async () => {
    await as(owner, `select public.save_overview_layout($1, '{}'::text[])`, [org]);
    expect(await as(owner, `select layout from public.overview_layouts where organization_id = $1`, [org])).toEqual([]);
  });
  it('outsiders, bad ids, direct writes and anon are refused', async () => {
    await expectDenied(as(outsider, `select public.save_overview_layout($1, $2::text[])`, [org, ['quick']]), /not a member/);
    expect(await as(outsider, `select * from public.overview_layouts where organization_id = $1`, [org])).toEqual([]);
    await expectDenied(as(owner, `select public.save_overview_layout($1, $2::text[])`, [org, ['bad id!']]), /isn.t valid/);
    await expectDenied(as(owner, `select public.save_overview_layout($1, $2::text[])`, [org, Array(41).fill('quick')]), /isn.t valid/);
    await expectDenied(as(owner, `insert into public.overview_layouts (user_id, organization_id, layout) values ($1, $2, '{quick}')`, [owner.id, org]));
    await expectDenied(as(owner, `update public.overview_layouts set layout = '{x}'`));
    await expectDenied(as({ kind: 'anon' } as never, `select public.save_overview_layout($1, '{quick}'::text[])`, [org]));
  });
  it('deleting the business removes its layouts', async () => {
    await as(outsider, `select public.save_overview_layout($1, $2::text[])`, [other, ['quick']]);
    await sys(`delete from public.organizations where id = $1`, [other]);
    expect(await sys(`select 1 from public.overview_layouts where organization_id = $1`, [other])).toEqual([]);
  });
});

describe('sales_rollup', () => {
  it('rolls up per store by month or day, net and tax', async () => {
    const m = await as<{ location_id: string; period: string; net_cents: string; tax_cents: string; days: number; last_day: string }>(owner,
      `select location_id, period::text, net_cents, tax_cents, days, last_day::text from public.sales_rollup($1, '2026-10-01', '2026-11-30', 'month') order by period, net_cents`, [org]);
    expect(m.map((r) => [r.location_id === A ? 'A' : 'B', r.period, Number(r.net_cents), Number(r.tax_cents), r.days, r.last_day])).toEqual([
      ['A', '2026-10-01', 3000, 140, 2, '2026-10-02'], ['B', '2026-10-01', 5000, 70, 1, '2026-10-01'], ['A', '2026-11-01', 400, 70, 1, '2026-11-01'],
    ]);
    const d = await as(owner, `select period::text from public.sales_rollup($1, '2026-10-01', '2026-10-31', 'day') where location_id = $2 order by 1`, [org, A]);
    expect(d).toEqual([{ period: '2026-10-01' }, { period: '2026-10-02' }]);
  });
  it('runs as the caller: store limits, permissions and other businesses apply', async () => {
    const mine = await as<{ location_id: string }>(mgrA, `select location_id from public.sales_rollup($1, '2026-10-01', '2026-11-30', 'month')`, [org]);
    expect(new Set(mine.map((r) => r.location_id))).toEqual(new Set([A]));
    expect(await as(outsider, `select * from public.sales_rollup($1, '2026-10-01', '2026-11-30', 'month')`, [org])).toEqual([]);
    expect(await as(emp, `select * from public.sales_rollup($1, '2026-10-01', '2026-11-30', 'month')`, [org])).toEqual([]);
    await expectDenied(as({ kind: 'anon' } as never, `select * from public.sales_rollup($1, '2026-10-01', '2026-11-30', 'month')`, [org]));
  });
  it('bad grouping or huge/inverted ranges return nothing', async () => {
    expect(await as(owner, `select * from public.sales_rollup($1, '2026-10-01', '2026-11-30', 'year')`, [org])).toEqual([]);
    expect(await as(owner, `select * from public.sales_rollup($1, '2020-01-01', '2026-11-30', 'month')`, [org])).toEqual([]);
    expect(await as(owner, `select * from public.sales_rollup($1, '2026-11-30', '2026-10-01', 'month')`, [org])).toEqual([]);
  });
});

describe('bill_month_totals', () => {
  it('sums bills by due month, without void bills; other businesses and roles without bills see nothing', async () => {
    const [{ id: v }] = await sys<{ id: string }>(`select id from public.bills where organization_id = $1 and bill_number = 'OV-2'`, [org]);
    await sys(`update public.bills set status = 'void' where id = $1`, [v]);
    const rows = await as<{ month: string; total_cents: string; bills: number }>(owner,
      `select month::text, total_cents, bills from public.bill_month_totals($1, '2026-10-01', '2026-11-30') order by 1`, [org]);
    expect(rows.map((r) => [r.month, Number(r.total_cents), r.bills])).toEqual([['2026-10-01', 10000, 1], ['2026-11-01', 700, 1]]);
    expect(await as(outsider, `select * from public.bill_month_totals($1, '2026-10-01', '2026-11-30')`, [org])).toEqual([]);
    expect(await as(emp, `select * from public.bill_month_totals($1, '2026-10-01', '2026-11-30')`, [org])).toEqual([]);
  });
});

describe('payroll_paid (#168)', () => {
  it('sums every line of non-void runs in the database, past the 1,000-row API cap; RLS decides who sees it', async () => {
    // 21 employees × 52 weekly runs = 1,092 lines of $100 gross + $7.65 employer tax.
    await sys(`insert into public.employees (organization_id, location_id, name) select $1, $2, 'PP ' || g from generate_series(1, 21) g`, [org, A]);
    await sys(`insert into public.pay_runs (organization_id, pay_date, period_start, period_end)
               select $1, d::date, (d - interval '6 days')::date, d::date from generate_series('2025-01-04'::date, '2025-12-27'::date, interval '7 days') d`, [org]);
    await sys(`insert into public.pay_run_lines (organization_id, run_id, employee_id, pay_type, hours, rate_cents, regular_cents, gross_cents, net_cents, employer_tax_cents)
               select $1, r.id, e.id, 'hourly', 10, 1000, 10000, 10000, 10000, 765
                 from public.pay_runs r cross join public.employees e
                where r.organization_id = $1 and e.organization_id = $1 and e.name like 'PP %'`, [org]);
    const [{ n }] = await sys<{ n: string }>(`select count(*) as n from public.pay_run_lines where organization_id = $1`, [org]);
    expect(Number(n)).toBe(1092);
    const [{ id: voidRun }] = await sys<{ id: string }>(`select id from public.pay_runs where organization_id = $1 order by pay_date desc limit 1`, [org]);
    await sys(`update public.pay_runs set voided_at = now() where id = $1`, [voidRun]);
    const [row] = await as<{ cents: string; runs: number }>(owner, `select cents, runs from public.payroll_paid($1, '2025-01-01', '2025-12-31')`, [org]);
    expect([Number(row.cents), row.runs]).toEqual([51 * 21 * 10765, 51]);
    expect(await as(emp, `select cents, runs from public.payroll_paid($1, '2025-01-01', '2025-12-31')`, [org])).toEqual([{ cents: '0', runs: 0 }]);
    expect(await as(outsider, `select cents, runs from public.payroll_paid($1, '2025-01-01', '2025-12-31')`, [org])).toEqual([{ cents: '0', runs: 0 }]);
    expect(await as(owner, `select cents, runs from public.payroll_paid($1, '2020-01-01', '2025-12-31')`, [org])).toEqual([{ cents: '0', runs: 0 }]);
    await expectDenied(as({ kind: 'anon' } as never, `select * from public.payroll_paid($1, '2025-01-01', '2025-12-31')`, [org]));
  });
});
