import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, sys, createUser, createOrg, addMember, expectDenied, closeDb, type TestUser } from './helpers';

let owner: TestUser, mgr: TestUser, emp: TestUser, other: TestUser;
let org: string, vendor: string, rent: string, util: string;

beforeAll(async () => {
  owner = await createUser('rb-owner'); mgr = await createUser('rb-mgr'); emp = await createUser('rb-emp'); other = await createUser('rb-other');
  org = await createOrg(owner, 'Recurring Co', 'retail');
  await createOrg(other, 'Other Recurring', 'retail');
  await addMember(owner, org, mgr, 'manager');
  await addMember(owner, org, emp, 'employee');
  [{ id: vendor }] = await as<{ id: string }>(owner, `insert into public.vendors (organization_id, name) values ($1, 'Landlord LLC') returning id`, [org]);
  [{ id: rent }] = await sys<{ id: string }>(`select id from public.accounts where organization_id = $1 and role = 'rent'`, [org]);
  [{ id: util }] = await sys<{ id: string }>(`select id from public.accounts where organization_id = $1 and role = 'utilities'`, [org]);
});
afterAll(closeDb);

const save = (u: TestUser, name: string, freq: string, next: string, opts: { day?: number; end?: string; due?: number; lines?: object[] } = {}) =>
  as<{ id: string }>(u, `select public.save_recurring_bill($1, null, $2, $3, $4::jsonb, $5::public.recurrence, $6::date, $7, $8, $9::date) as id`,
    [org, vendor, name, JSON.stringify(opts.lines ?? [{ account_id: rent, amount_cents: 350_000, description: 'Store rent' }]), freq, next, opts.day ?? null, opts.due ?? 5, opts.end ?? null]);
const run = (u: TestUser, through: string) => as<{ n: number }>(u, `select public.create_due_recurring_bills($1, $2::date) as n`, [org, through]);
const billsOf = (id: string) => sys<{ bill_date: string; due_date: string; status: string; total_cents: string }>(
  `select to_char(bill_date,'YYYY-MM-DD') as bill_date, to_char(due_date,'YYYY-MM-DD') as due_date, status, total_cents from public.bills where recurring_bill_id = $1 order by bill_date`, [id]);

describe('next occurrence', () => {
  it('handles month ends and frequencies', async () => {
    const q = async (d: string, f: string, day: number | null) =>
      (await sys<{ d: string }>(`select to_char(private.next_occurrence($1::date, $2::public.recurrence, $3), 'YYYY-MM-DD') as d`, [d, f, day]))[0].d;
    expect(await q('2026-01-31', 'monthly', 31)).toBe('2026-02-28');
    expect(await q('2026-02-28', 'monthly', 31)).toBe('2026-03-31');
    expect(await q('2026-11-01', 'quarterly', 1)).toBe('2027-02-01');
    expect(await q('2026-11-03', 'weekly', null)).toBe('2026-11-10');
    expect(await q('2028-02-29', 'yearly', 29)).toBe('2029-02-28');
  });
});

describe('recurring bills', () => {
  let rentId: string;
  it('managers create templates; employees and outsiders cannot', async () => {
    [{ id: rentId }] = await save(mgr, 'Rent', 'monthly', '2026-09-01');
    await expectDenied(save(emp, 'Nope', 'monthly', '2026-09-01'));
    await expectDenied(as(other, `select public.save_recurring_bill($1, null, $2, 'X', $3::jsonb, 'monthly', '2026-09-01'::date)`, [org, vendor, JSON.stringify([{ account_id: rent, amount_cents: 1 }])]));
  });

  it('catches up every due period as draft bills with due dates from the template', async () => {
    const [{ n }] = await run(mgr, '2026-11-10');
    expect(n).toBe(3);
    const b = await billsOf(rentId);
    expect(b.map((x) => x.bill_date)).toEqual(['2026-09-01', '2026-10-01', '2026-11-01']);
    expect(b.every((x) => x.status === 'draft' && x.total_cents === '350000')).toBe(true);
    expect(b[2].due_date).toBe('2026-11-06');
    const [{ next }] = await sys<{ next: string }>(`select to_char(next_date,'YYYY-MM-DD') as next from public.recurring_bills where id = $1`, [rentId]);
    expect(next).toBe('2026-12-01');
  });

  it('is idempotent: running again creates nothing', async () => {
    const [{ n }] = await run(owner, '2026-11-10');
    expect(n).toBe(0);
    expect(await billsOf(rentId)).toHaveLength(3);
  });

  it('stops at the end date and deactivates the template', async () => {
    const [{ id }] = await save(mgr, 'Power', 'monthly', '2026-10-15', { end: '2026-11-15', lines: [{ account_id: util, amount_cents: 21_000 }] });
    await run(mgr, '2026-12-10');
    expect((await billsOf(id)).map((x) => x.bill_date)).toEqual(['2026-10-15', '2026-11-15']);
    const [{ is_active }] = await sys<{ is_active: boolean }>(`select is_active from public.recurring_bills where id = $1`, [id]);
    expect(is_active).toBe(false);
  });

  it('created bills follow the normal approval rules', async () => {
    const [{ id }] = await sys<{ id: string }>(`select id from public.bills where recurring_bill_id = $1 order by bill_date limit 1`, [rentId]);
    await expectDenied(as(mgr, `select public.approve_bill($1)`, [id]));
    await as(owner, `select public.approve_bill($1)`, [id]);
  });

  it('rejects bad lines, far-future runs, and reading by outsiders', async () => {
    await expectDenied(save(mgr, 'Bad', 'monthly', '2026-11-01', { lines: [{ account_id: rent, amount_cents: 0 }] }), /positive/);
    await expectDenied(run(mgr, '2027-06-01'), /month ahead/);
    expect(await as(other, `select id from public.recurring_bills where organization_id = $1`, [org])).toHaveLength(0);
    expect((await as(mgr, `select id from public.recurring_bills where organization_id = $1`, [org])).length).toBe(2);
  });

  it('clients cannot write templates directly', async () => {
    await expectDenied(as(owner, `update public.recurring_bills set next_date = '2020-01-01' where organization_id = $1`, [org]));
    await expectDenied(as(owner, `delete from public.recurring_bills where organization_id = $1`, [org]));
  });
});
