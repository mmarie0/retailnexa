import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, sys, createUser, createOrg, addMember, setSubscription, expectDenied, closeDb, type TestUser } from './helpers';

// Batch B (#102): employees, pay, schedule, payroll.
let owner: TestUser, mgrA: TestUser, acct: TestUser, emp: TestUser, outsider: TestUser;
let org: string, other: string, A: string, B: string;
const week = (d = '2026-11-08') => d; // a Sunday
const reg = JSON.stringify([null, { in: '09:00', out: '17:00', lunch: 30 }, { in: '09:00', out: '17:00', lunch: 30 }, null, null, null, null]);

beforeAll(async () => {
  owner = await createUser('st-owner'); mgrA = await createUser('st-mgrA'); acct = await createUser('st-acct'); emp = await createUser('st-emp'); outsider = await createUser('st-out');
  org = await createOrg(owner, 'Staff Co', 'retail');
  other = await createOrg(outsider, 'Other Staff Co', 'retail');
  [{ id: A }] = await sys<{ id: string }>(`select id from public.locations where organization_id = $1 limit 1`, [org]);
  [{ id: B }] = await as<{ id: string }>(owner, `insert into public.locations (organization_id, name, kind) values ($1, 'Staff Store B', 'store') returning id`, [org]);
  const m = await addMember(owner, org, mgrA, 'manager');
  await as(owner, `select public.set_member_locations($1, $2::uuid[])`, [m, [A]]);
  await addMember(owner, org, acct, 'accountant');
  await addMember(owner, org, emp, 'employee');
});
afterAll(closeDb);

const save = (u: TestUser, o: { id?: string | null; name: string; loc?: string | null; pay?: object | null; regular?: string | null; active?: boolean }) =>
  as<{ id: string }>(u, `select public.save_employee($1, $2, $3, 'Cashier', $4, '2026-01-01', null, $5, $6::jsonb, null, $7::jsonb) as id`,
    [org, o.id ?? null, o.name, o.loc ?? null, o.active ?? true, o.regular ?? null, o.pay ? JSON.stringify(o.pay) : null]);

describe('#102 staff', () => {
  let ana: string, ben: string;
  it('owner adds employees with pay; pay is visible only with payroll.view; names follow store access', async () => {
    [{ id: ana }] = await save(owner, { name: 'Ana', loc: A, regular: reg, pay: { pay_type: 'hourly', rate_cents: 1500, burden_pct: 10, pay_method: 'cash', tax_type: 'w2' } });
    [{ id: ben }] = await save(owner, { name: 'Ben', loc: B, pay: { pay_type: 'salary', rate_cents: 3_650_000, burden_pct: 8, pay_method: 'check' } });
    expect((await as<{ name: string }>(owner, `select name from public.employees where organization_id = $1 order by name`, [org])).map((r) => r.name)).toEqual(['Ana', 'Ben']);
    expect((await as<{ name: string }>(mgrA, `select name from public.employees where organization_id = $1`, [org])).map((r) => r.name)).toEqual(['Ana']);
    expect(await as(mgrA, `select 1 from public.employee_pay where organization_id = $1`, [org])).toHaveLength(0); // no payroll.view
    expect(await as(acct, `select 1 from public.employee_pay where organization_id = $1`, [org])).toHaveLength(2);
    // employees see coworkers' names for the schedule (schedule.view), never pay
    expect(await as(emp, `select 1 from public.employees where organization_id = $1`, [org])).toHaveLength(2);
    expect(await as(emp, `select 1 from public.employee_pay where organization_id = $1`, [org])).toHaveLength(0);
    expect(await as(outsider, `select 1 from public.employees where organization_id = $1`, [org])).toHaveLength(0);
  });

  it('only employees.manage saves employees; pay changes need payroll.manage; bad schedules and other-business stores are refused', async () => {
    await expectDenied(save(mgrA, { name: 'X', loc: A }));
    await expectDenied(save(emp, { name: 'X' }));
    await expectDenied(save(outsider, { name: 'X' }));
    await expectDenied(save(owner, { name: 'Bad', regular: JSON.stringify([{ in: '9am', out: '17:00' }, null, null, null, null, null, null]) }), /start and end time/);
    const [{ id: otherStore }] = await sys<{ id: string }>(`select id from public.locations where organization_id = $1 limit 1`, [other]);
    await expectDenied(save(owner, { name: 'X', loc: otherStore }), /store not found/);
    await expectDenied(as(owner, `insert into public.employees (organization_id, name) values ($1, 'Direct')`, [org]));
  });

  it('schedule: set a week, copy last week; schedule.manage only; store-scoped', async () => {
    const days = JSON.stringify([null, { in: '10:00', out: '18:00', lunch: 30 }, { off: true }, null, null, null, null]);
    await as(owner, `select public.set_week_shifts($1, $2, $3, $4::jsonb)`, [org, ana, week(), days]);
    const rows = await as<{ work_date: string; off: boolean }>(mgrA, `select to_char(work_date, 'YYYY-MM-DD') as work_date, off from public.shifts where employee_id = $1 order by work_date`, [ana]);
    expect(rows).toEqual([{ work_date: '2026-11-09', off: false }, { work_date: '2026-11-10', off: true }]);
    await expectDenied(as(mgrA, `select public.set_week_shifts($1, $2, $3, $4::jsonb)`, [org, ben, week(), days]), /not found/); // Ben is in store B
    await expectDenied(as(emp, `select public.set_week_shifts($1, $2, $3, $4::jsonb)`, [org, ana, week(), days]));
    await expectDenied(as(owner, `select public.set_week_shifts($1, $2, $3, $4::jsonb)`, [org, ana, week(), JSON.stringify([{ in: '25:00', out: '1' }, null, null, null, null, null, null])]), /times look like/);
    const [{ n }] = await as<{ n: number }>(mgrA, `select public.copy_week($1, '2026-11-15') as n`, [org]);
    expect(n).toBe(2);
    expect(await as(emp, `select 1 from public.shifts where organization_id = $1`, [org])).toHaveLength(4); // employees have schedule.view
  });

  it('pay runs: database recomputes gross, takes back chosen advances once, and void reopens them', async () => {
    const [{ id: adv }] = await as<{ id: string }>(owner, `select public.add_advance($1, $2, '2026-11-03', 5000, 'Rent help') as id`, [org, ana]);
    const line = { employee_id: ana, pay_type: 'hourly', hours: 15, rate_cents: 1500, regular_cents: 22500, bonus_cents: 1000, employer_tax_cents: 2250, pay_method: 'cash', advance_ids: [adv] };
    const [{ id: run }] = await as<{ id: string }>(owner, `select public.create_pay_run($1, '2026-11-14', '2026-11-08', '2026-11-14', $2::jsonb) as id`, [org, JSON.stringify([line])]);
    const [l] = await sys<{ gross_cents: string; advance_cents: string; net_cents: string }>(`select gross_cents, advance_cents, net_cents from public.pay_run_lines where run_id = $1`, [run]);
    expect(l).toEqual({ gross_cents: '23500', advance_cents: '5000', net_cents: '18500' });
    await expectDenied(as(owner, `select public.create_pay_run($1, '2026-11-14', '2026-11-08', '2026-11-14', $2::jsonb)`, [org, JSON.stringify([line])]), /already repaid/);
    await expectDenied(as(mgrA, `select public.create_pay_run($1, '2026-11-14', '2026-11-08', '2026-11-14', $2::jsonb)`, [org, JSON.stringify([{ ...line, advance_ids: [] }])]));
    await expectDenied(as(owner, `select public.create_pay_run($1, 'infinity', '2026-11-08', '2026-11-14', $2::jsonb)`, [org, JSON.stringify([{ ...line, advance_ids: [] }])]), /pay date/);
    await expectDenied(as(owner, `select public.create_pay_run($1, '2026-11-14', '2026-10-01', '2026-11-14', $2::jsonb)`, [org, JSON.stringify([{ ...line, advance_ids: [] }])]), /up to a month/);
    expect(await as(mgrA, `select 1 from public.pay_runs where organization_id = $1`, [org])).toHaveLength(0);
    expect(await as(acct, `select 1 from public.pay_runs where organization_id = $1`, [org])).toHaveLength(1);
    await expectDenied(as(acct, `select public.void_pay_run($1)`, [run])); // accountant has payroll.view, not manage
    await as(owner, `select public.void_pay_run($1)`, [run]);
    expect((await sys<{ r: string | null }>(`select repaid_run_id as r from public.employee_advances where id = $1`, [adv]))[0].r).toBeNull();
  });

  it('settings: payroll.manage only, with sane ranges; read-only businesses can’t write', async () => {
    await as(owner, `select public.save_staff_settings($1, false, true, 40, 1.5, 0, 2, 11.5)`, [org]);
    expect((await as<{ paid_lunch: boolean; labor_target_pct: string }>(mgrA, `select paid_lunch, labor_target_pct from public.staff_settings where organization_id = $1`, [org]))[0])
      .toEqual({ paid_lunch: false, labor_target_pct: '11.50' });
    await expectDenied(as(mgrA, `select public.save_staff_settings($1, true, false, 40, 1.5, 0, 1, 12)`, [org]));
    await expect(as(owner, `select public.save_staff_settings($1, true, false, 40, 9, 0, 1, 12)`, [org])).rejects.toThrow(/check constraint/);
    const u = await createUser('st-ro');
    const ro = await createOrg(u, 'RO Staff Co', 'retail');
    await setSubscription(ro, 'canceled');
    await expectDenied(as(u, `select public.save_employee($1, null, 'X')`, [ro]));
  });
});
