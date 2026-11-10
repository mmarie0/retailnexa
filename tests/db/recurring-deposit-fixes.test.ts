import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, sys, createUser, createOrg, addMember, expectDenied, closeDb, type TestUser } from './helpers';

let owner: TestUser, mgrA: TestUser, mgrAll: TestUser;
let org: string, A: string, B: string, vendor: string, rent: string;
const scopeErr = /store you have access to|permission denied/;

beforeAll(async () => {
  owner = await createUser('rdf-owner'); mgrA = await createUser('rdf-mgrA'); mgrAll = await createUser('rdf-mgrAll');
  org = await createOrg(owner, 'Fixes Co', 'retail');
  [{ id: A }] = await sys<{ id: string }>(`select id from public.locations where organization_id = $1 limit 1`, [org]);
  [{ id: B }] = await as<{ id: string }>(owner, `insert into public.locations (organization_id, name, kind) values ($1, 'Store B', 'store') returning id`, [org]);
  const mA = await addMember(owner, org, mgrA, 'manager');
  await addMember(owner, org, mgrAll, 'manager');
  await as(owner, `select public.set_member_locations($1, $2::uuid[])`, [mA, [A]]);
  [{ id: vendor }] = await as<{ id: string }>(owner, `insert into public.vendors (organization_id, name) values ($1, 'Landlord') returning id`, [org]);
  [{ id: rent }] = await sys<{ id: string }>(`select id from public.accounts where organization_id = $1 and role = 'rent'`, [org]);
});
afterAll(closeDb);

const lines = () => JSON.stringify([{ account_id: rent, amount_cents: 100_000 }]);

describe('#65 editing a recurring bill keeps its day of month', () => {
  it('a month-end template stays on the 31st after an edit', async () => {
    const [{ id }] = await as<{ id: string }>(owner,
      `select public.save_recurring_bill($1, null, $2, 'EOM', $3::jsonb, 'monthly', '2026-08-31'::date, null, 0) as id`, [org, vendor, lines()]);
    await as(owner, `select public.create_due_recurring_bills($1, '2026-09-10'::date)`, [org]);
    // Save it again the way the form does (no day given, same next date).
    await as(owner, `select public.save_recurring_bill($1, $2, $3, 'EOM renamed', $4::jsonb, 'monthly', '2026-09-30'::date, null, 0)`, [org, id, vendor, lines()]);
    const [r] = await sys<{ day: number }>(`select day_of_month as day from public.recurring_bills where id = $1`, [id]);
    expect(r.day).toBe(31);
    await as(owner, `select public.create_due_recurring_bills($1, '2026-10-31'::date)`, [org]);
    const dates = await sys<{ d: string }>(`select to_char(bill_date,'YYYY-MM-DD') as d from public.bills where recurring_bill_id = $1 order by bill_date`, [id]);
    expect(dates.map((x) => x.d)).toEqual(['2026-08-31', '2026-09-30', '2026-10-31']);
  });

  it('moving the next bill date to another day changes the day of month', async () => {
    const [{ id }] = await as<{ id: string }>(owner,
      `select public.save_recurring_bill($1, null, $2, 'Moved', $3::jsonb, 'monthly', '2026-08-31'::date, null, 0) as id`, [org, vendor, lines()]);
    await as(owner, `select public.save_recurring_bill($1, $2, $3, 'Moved', $4::jsonb, 'monthly', '2026-09-15'::date, null, 0)`, [org, id, vendor, lines()]);
    const [r] = await sys<{ day: number }>(`select day_of_month as day from public.recurring_bills where id = $1`, [id]);
    expect(r.day).toBe(15);
    await sys(`update public.recurring_bills set is_active = false where organization_id = $1`, [org]);
  });
});

describe('#27 cash deposits respect store restrictions', () => {
  const deposit = (u: TestUser, loc: string | null, key: string) =>
    as(u, `select public.record_money_movement($1, 'cash_deposit', '2026-11-02'::date, 5000, $2, 0, 'bank', null, $3)`, [org, key, loc]);

  it('a member restricted to store A can deposit for A, not for B or the whole business', async () => {
    await deposit(mgrA, A, 'rdf-a-1');
    await expectDenied(deposit(mgrA, B, 'rdf-b-1'), scopeErr);
    await expectDenied(deposit(mgrA, null, 'rdf-null-1'), scopeErr);
  });

  it('unrestricted members are unchanged', async () => {
    await deposit(mgrAll, B, 'rdf-b-2');
    await deposit(mgrAll, null, 'rdf-null-2');
  });

  it('the restricted member only sees their store’s deposits', async () => {
    const mine = await as<{ id: string }>(mgrA, `select id from public.recent_money_movements($1)`, [org]);
    expect(mine).toHaveLength(1);
    const all = await as<{ id: string }>(mgrAll, `select id from public.recent_money_movements($1)`, [org]);
    expect(all).toHaveLength(3);
  });
});

describe('daily recurring-bills job', () => {
  it('only the service role can run it', async () => {
    await expectDenied(as(owner, `select public.run_recurring_bills_job()`));
    await expectDenied(as({ kind: 'anon' }, `select public.run_recurring_bills_job()`));
  });

  it('one broken template is skipped and flagged; the others still bill (#68)', async () => {
    const [{ id: gone }] = await as<{ id: string }>(owner, `insert into public.vendors (organization_id, name) values ($1, 'Gone Vendor') returning id`, [org]);
    const mk = (v: string, name: string) => sys<{ id: string }>(
      `insert into public.recurring_bills (organization_id, vendor_id, location_id, name, lines, frequency, day_of_month, next_date, due_days)
       values ($1, $2, $3, $4, $5::jsonb, 'weekly', null, private.org_today($1) - 1, 0) returning id`, [org, v, A, name, lines()]);
    const [{ id: good }] = await mk(vendor, 'Good weekly');
    const [{ id: bad }] = await mk(gone, 'Bad weekly');
    await sys(`update public.vendors set is_active = false where id = $1`, [gone]);
    const [{ r }] = await as<{ r: { made: number; failed: number } }>(owner, `select public.create_due_recurring_bills($1) as r`, [org]);
    expect(r).toEqual({ made: 1, failed: 1 });
    const [badRow] = await sys<{ last_error: string | null; next: string; today: string }>(
      `select last_error, next_date::text as next, private.org_today(organization_id)::text as today from public.recurring_bills where id = $1`, [bad]);
    expect(badRow.last_error).toMatch(/vendor not found/);
    expect(badRow.next < badRow.today).toBe(true);
    expect(await sys(`select 1 from public.bills where recurring_bill_id = $1`, [good])).toHaveLength(1);
    const [{ j }] = await as<{ j: { failed: number } }>({ kind: 'service' }, `select public.run_recurring_bills_job() as j`);
    expect(j.failed).toBe(1);
    await sys(`update public.recurring_bills set is_active = false where id in ($1, $2)`, [good, bad]);
  });

  it('creates due bills for every store and is idempotent', async () => {
    const [{ id }] = await sys<{ id: string }>(
      `insert into public.recurring_bills (organization_id, vendor_id, location_id, name, lines, frequency, day_of_month, next_date, due_days)
       values ($1, $2, $3, 'Store B fee', $4::jsonb, 'weekly', null, private.org_today($1) - 13, 0) returning id`, [org, vendor, B, lines()]);
    const [{ r1 }] = await as<{ r1: { bills: number; failed: number } }>({ kind: 'service' }, `select public.run_recurring_bills_job() as r1`);
    expect(r1.failed).toBe(0);
    const made = await sys<{ n: string; who: string | null }>(
      `select count(*) as n, max(created_by::text) as who from public.bills where recurring_bill_id = $1`, [id]);
    expect(made[0].n).toBe('2');
    expect(made[0].who).toBeNull();
    const [{ r2 }] = await as<{ r2: { bills: number } }>({ kind: 'service' }, `select public.run_recurring_bills_job() as r2`);
    expect(r2.bills).toBe(0);
  });
});
