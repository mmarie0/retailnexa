import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, sys, createUser, createOrg, addMember, setSubscription, expectDenied, closeDb, type TestUser } from './helpers';

// Parity batch A: monthly bill budgets (#101) and vendor payment method (#107).
let owner: TestUser, manager: TestUser, accountant: TestUser, viewer: TestUser, outsider: TestUser;
let org: string, other: string;

beforeAll(async () => {
  owner = await createUser('due-owner'); manager = await createUser('due-mgr'); accountant = await createUser('due-acct');
  viewer = await createUser('due-viewer'); outsider = await createUser('due-outsider');
  org = await createOrg(owner, 'Due View Co', 'retail');
  other = await createOrg(outsider, 'Other Due Co', 'retail');
  await addMember(owner, org, manager, 'manager');
  await addMember(owner, org, accountant, 'accountant');
  await addMember(owner, org, viewer, 'viewer');
});
afterAll(closeDb);

const budgets = (actor: TestUser, o = org) =>
  as<{ month: string | null; amount_cents: string }>(actor, `select to_char(month, 'YYYY-MM-DD') as month, amount_cents from public.bill_budgets where organization_id = $1 order by month nulls first`, [o]);

describe('bill_budgets', () => {
  it('owner sets a default and a month budget; any day in the month is stored as the 1st; saving again updates', async () => {
    await as(owner, `select public.set_bill_budget($1, null, 300000)`, [org]);
    await as(owner, `select public.set_bill_budget($1, '2026-12-17', 400000)`, [org]);
    await as(owner, `select public.set_bill_budget($1, '2026-12-01', 450000)`, [org]);
    expect(await budgets(owner)).toEqual([{ month: null, amount_cents: '300000' }, { month: '2026-12-01', amount_cents: '450000' }]);
  });

  it('bills.view can read; no bills.view or another business cannot', async () => {
    expect(await budgets(manager)).toHaveLength(2);
    expect(await budgets(viewer)).toEqual([]);
    expect(await budgets(outsider)).toEqual([]);
    expect(await budgets(owner, other)).toEqual([]);
  });

  it('only bills.approve can set a budget, and only through the RPC', async () => {
    await expectDenied(as(manager, `select public.set_bill_budget($1, null, 1)`, [org]));
    await expectDenied(as(outsider, `select public.set_bill_budget($1, null, 1)`, [org]));
    await as(accountant, `select public.set_bill_budget($1, '2027-01-01', 500000)`, [org]);
    await expectDenied(as(owner, `insert into public.bill_budgets (organization_id, month, amount_cents) values ($1, '2027-02-01', 1)`, [org]));
    await expectDenied(as(owner, `update public.bill_budgets set amount_cents = 1 where organization_id = $1`, [org]));
    await expectDenied(as(owner, `delete from public.bill_budgets where organization_id = $1`, [org]));
    expect((await budgets(owner)).find((b) => b.month === '2027-01-01')?.amount_cents).toBe('500000');
  });

  it('rejects zero/negative amounts; null clears only that budget', async () => {
    await expectDenied(as(owner, `select public.set_bill_budget($1, null, 0)`, [org]), /between/);
    await expectDenied(as(owner, `select public.set_bill_budget($1, null, -5)`, [org]), /between/);
    await as(owner, `select public.set_bill_budget($1, '2027-01-09', null)`, [org]);
    expect((await budgets(owner)).map((b) => b.month)).toEqual([null, '2026-12-01']);
    await as(owner, `select public.set_bill_budget($1, null, null)`, [org]);
    expect((await budgets(owner)).map((b) => b.month)).toEqual(['2026-12-01']);
  });

  it('a read-only (canceled) business cannot change budgets but can still read them', async () => {
    const u = await createUser('due-ro');
    const ro = await createOrg(u, 'Read Only Due Co', 'retail');
    await as(u, `select public.set_bill_budget($1, null, 1000)`, [ro]);
    await setSubscription(ro, 'canceled');
    await expectDenied(as(u, `select public.set_bill_budget($1, null, 2000)`, [ro]));
    expect(await budgets(u, ro)).toEqual([{ month: null, amount_cents: '1000' }]);
  });

  it('every budget change is audited', async () => {
    const rows = await sys(`select 1 from public.audit_logs where organization_id = $1 and target_type = 'bill_budgets'`, [org]);
    expect(rows.length).toBeGreaterThan(0);
  });
});

describe('vendors.pay_method', () => {
  it('vendors.manage can set it on insert and update; unknown values are rejected', async () => {
    const [{ id }] = await as<{ id: string }>(owner, `insert into public.vendors (organization_id, name, pay_method) values ($1, 'Pay Method Co', 'ach') returning id`, [org]);
    await as(owner, `update public.vendors set pay_method = 'check' where id = $1`, [id]);
    const [v] = await sys<{ pay_method: string }>(`select pay_method from public.vendors where id = $1`, [id]);
    expect(v.pay_method).toBe('check');
    await expect(as(owner, `update public.vendors set pay_method = 'bitcoin' where id = $1`, [id])).rejects.toThrow(/check constraint/);
    // Managers have vendors.view only: the update matches no rows.
    await as(manager, `update public.vendors set pay_method = 'cash' where id = $1`, [id]);
    expect((await sys<{ pay_method: string }>(`select pay_method from public.vendors where id = $1`, [id]))[0].pay_method).toBe('check');
  });
});
