import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { as, sys, createUser, createOrg, addMember, setSubscription, expectDenied, closeDb, adminUrl, TEST_DB, type TestUser } from './helpers';

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
    await expectDenied(as(owner, `select public.create_pay_run($1, '2026-11-14', '2026-11-08', '2026-11-14', $2::jsonb)`, [org, JSON.stringify([line])]), /already in a pay run|already repaid/);
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

  describe('#153 #154 #156 payroll audit fixes', () => {
    const run = (u: TestUser, lines: object[], key: string | null = null, period = ['2026-10-04', '2026-10-10']) =>
      as<{ id: string }>(u, `select public.create_pay_run($1, '2026-10-12', $2, $3, $4::jsonb, null, $5) as id`, [org, period[0], period[1], JSON.stringify(lines), key]);

    it('#156 pay is computed from the stored rate, not the request', async () => {
      const [{ id }] = await run(owner, [{ employee_id: ana, hours: 1, overtime_hours: 0, regular_cents: 99000, overtime_cents: 1000, bonus_cents: 500, employer_tax_cents: 0 }]);
      const [l] = await sys<{ regular_cents: string; gross_cents: string; employer_tax_cents: string; rate_cents: string }>(
        `select regular_cents, gross_cents, employer_tax_cents, rate_cents from public.pay_run_lines where run_id = $1`, [id]);
      expect(l).toEqual({ regular_cents: '1500', gross_cents: '2000', employer_tax_cents: '150', rate_cents: '1500' });
      await expectDenied(run(owner, [{ employee_id: ben, hours: 1, overtime_hours: 2 }], null, ['2026-09-06', '2026-09-12']), /overtime no more than hours/);
      await expectDenied(run(owner, [{ employee_id: ben, hours: 1, bonus_cents: 2_000_000 }], null, ['2026-09-06', '2026-09-12']), /bonus/);
    });

    it('#156 nobody is paid twice for the same days; a retry with the same key returns the first run', async () => {
      await expectDenied(run(owner, [{ employee_id: ana, hours: 2 }], null, ['2026-10-08', '2026-10-14']), /already in a pay run/);
      const [{ id: a }] = await run(owner, [{ employee_id: ben, hours: 0 }], 'retry-key-0001', ['2026-08-02', '2026-08-08']);
      const [{ id: b }] = await run(owner, [{ employee_id: ben, hours: 0 }], 'retry-key-0001', ['2026-08-02', '2026-08-08']);
      expect(b).toBe(a);
      // Salary: 7 of 365 days of $36,500.
      expect((await sys<{ g: string }>(`select gross_cents as g from public.pay_run_lines where run_id = $1`, [a]))[0].g).toBe('70000');
    });

    it('#154 two overlapping pay runs can’t take back the same advance', async () => {
      const [{ id: adv }] = await as<{ id: string }>(owner, `select public.add_advance($1, $2, '2026-07-01', 1000) as id`, [org, ana]);
      const open = async () => {
        const c = new Client({ connectionString: adminUrl(TEST_DB) });
        await c.connect();
        await c.query('begin');
        await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: owner.id, role: 'authenticated', aal: 'aal1' })]);
        await c.query('set local role authenticated');
        return c;
      };
      const c1 = await open(), c2 = await open();
      const call = (c: Client, period: [string, string]) => c.query(`select public.create_pay_run($1, '2026-07-10', $2, $3, $4::jsonb)`,
        [org, period[0], period[1], JSON.stringify([{ employee_id: ana, hours: 5, advance_ids: [adv] }])]);
      await call(c1, ['2026-06-28', '2026-07-04']);
      const second = call(c2, ['2026-07-05', '2026-07-11']).then(() => 'ok', (e: Error) => e.message);
      await c1.query('commit');
      const r2 = await second;
      await c2.query('rollback').catch(() => {});
      await c1.end(); await c2.end();
      expect(r2).toMatch(/already repaid/);
      const runs = await sys<{ n: string }>(`select count(*) as n from public.pay_run_lines l join public.pay_runs r on r.id = l.run_id where l.advance_cents > 0 and r.pay_date = '2026-07-10'`);
      expect(runs[0].n).toBe('1');
    });

    it('#153 a store-limited payroll manager can’t see or void another store’s run', async () => {
      // Owners and admins always see every store, so use a manager given payroll rights and limited to store A.
      const adminA = await createUser('st-adminA');
      const m = await addMember(owner, org, adminA, 'manager');
      await as(owner, `select public.set_member_locations($1, $2::uuid[])`, [m, [A]]);
      await sys(`insert into public.member_permission_overrides (organization_id, membership_id, permission, granted) values ($1, $2, 'payroll.view', true), ($1, $2, 'payroll.manage', true)`, [org, m]);
      const [{ id: benRun }] = await run(owner, [{ employee_id: ben, hours: 0 }], null, ['2026-05-03', '2026-05-09']);
      expect(await as(adminA, `select 1 from public.pay_runs where id = $1`, [benRun])).toHaveLength(0);
      await expectDenied(as(adminA, `select public.void_pay_run($1)`, [benRun]), /store you don.t have access to/);
      expect((await sys<{ v: string | null }>(`select voided_at as v from public.pay_runs where id = $1`, [benRun]))[0].v).toBeNull();
    });

    it('deleting a business with payroll works', async () => {
      const u = await createUser('st-del');
      const o = await createOrg(u, 'Delete Me Payroll Co', 'retail');
      const [{ id: e }] = await as<{ id: string }>(u, `select public.save_employee($1, null, 'Zed', null, null, null, null, true, null, null, $2::jsonb) as id`, [o, JSON.stringify({ pay_type: 'hourly', rate_cents: 1000 })]);
      const [{ id: adv }] = await as<{ id: string }>(u, `select public.add_advance($1, $2, '2026-11-01', 500) as id`, [o, e]);
      await as(u, `select public.create_pay_run($1, '2026-11-08', '2026-11-01', '2026-11-07', $2::jsonb)`, [o, JSON.stringify([{ employee_id: e, hours: 10, advance_ids: [adv] }])]);
      await sys(`delete from public.organizations where id = $1`, [o]);
      expect(await sys(`select 1 from public.pay_runs where organization_id = $1`, [o])).toHaveLength(0);
    });
  });

  describe('#157 Lows', () => {
    const run = (lines: object[], key: string | null, period: [string, string], note: string | null = null) =>
      as<{ id: string }>(owner, `select public.create_pay_run($1, '2026-04-20', $2, $3, $4::jsonb, $5, $6) as id`, [org, period[0], period[1], JSON.stringify(lines), note, key]);

    it('overtime hours are paid at the regular rate while overtime is off; on, they get the multiplier', async () => {
      await as(owner, `select public.save_staff_settings($1, true, false, 40, 1.5, 0, 1, 12)`, [org]);
      const [{ id: off }] = await run([{ employee_id: ana, hours: 10, overtime_hours: 4 }], null, ['2026-04-05', '2026-04-11']);
      expect((await sys<{ o: string; r: string; g: string }>(`select overtime_hours as o, regular_cents as r, gross_cents as g from public.pay_run_lines where run_id = $1`, [off]))[0])
        .toEqual({ o: '0.00', r: '15000', g: '15000' });
      await as(owner, `select public.save_staff_settings($1, true, true, 40, 1.5, 0, 1, 12)`, [org]);
      const [{ id: on }] = await run([{ employee_id: ana, hours: 10, overtime_hours: 4 }], null, ['2026-04-12', '2026-04-18']);
      expect((await sys<{ g: string }>(`select gross_cents as g from public.pay_run_lines where run_id = $1`, [on]))[0].g).toBe(String(6 * 1500 + 4 * 2250));
    });

    it('a request key only replays the same request; the overlap error isn’t a unique-violation code', async () => {
      await run([{ employee_id: ben, hours: 0 }], 'low-key-0001', ['2026-03-01', '2026-03-07'], 'first');
      await expectDenied(run([{ employee_id: ben, hours: 0 }], 'low-key-0001', ['2026-03-01', '2026-03-07'], 'changed'), /already saved with different details/);
      const err = await run([{ employee_id: ben, hours: 0 }], null, ['2026-03-05', '2026-03-11']).catch((e: { code?: string; message: string }) => e);
      expect(err).toMatchObject({ code: '22023' });
      expect((err as Error).message).toMatch(/^Ben is already in a pay run for these dates; void that run first$/);
    });
  });
});