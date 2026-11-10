import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, sys, createUser, createOrg, addMember, expectDenied, closeDb, type TestUser } from './helpers';

let owner: TestUser, acct: TestUser, mgr: TestUser, other: TestUser;
let org: string, store: string;

beforeAll(async () => {
  owner = await createUser('dash-owner');
  acct = await createUser('dash-acct');
  mgr = await createUser('dash-mgr');
  other = await createUser('dash-other');
  org = await createOrg(owner, 'Dash Co', 'retail');
  await createOrg(other, 'Other Dash Co', 'retail');
  await addMember(owner, org, acct, 'accountant');
  await addMember(owner, org, mgr, 'manager');
  [{ id: store }] = await sys<{ id: string }>(`select id from public.locations where organization_id = $1 limit 1`, [org]);
  const day = (date: string, gross: number, tax: number) =>
    as(mgr, `select public.record_sales_day($1, $2, $3::date, $4, 0, $5, $6, 0, 0, 'R1')`, [org, store, date, gross, tax, gross + tax]);
  await day('2026-10-31', 50_000, 3_500);
  await day('2026-11-02', 10_000, 700);
  await day('2026-11-03', 20_000, 1_400);
});
afterAll(closeDb);

const activity = (u: TestUser, from: string, to: string) =>
  as<{ role: string; net_cents: string }>(u, `select * from public.account_activity($1, $2::date, $3::date)`, [org, from, to]);

describe('account_activity', () => {
  it('sums movement by role inside the range only', async () => {
    const rows = await activity(acct, '2026-11-01', '2026-11-30');
    const by = Object.fromEntries(rows.map((r) => [r.role, Number(r.net_cents)]));
    expect(by.sales).toBe(-30_000);
    expect(by.sales_tax_payable).toBe(-2_100);
    expect(by.cash_on_hand).toBe(32_100);
  });

  it('is limited to accounting/profit roles; managers and outsiders are denied', async () => {
    expect((await activity(owner, '2026-11-01', '2026-11-30')).length).toBeGreaterThan(0);
    await expectDenied(activity(mgr, '2026-11-01', '2026-11-30'));
    await expectDenied(activity(other, '2026-11-01', '2026-11-30'));
  });

  it('rejects inverted or huge ranges', async () => {
    await expectDenied(activity(acct, '2026-11-30', '2026-11-01'), /invalid date range/);
    await expectDenied(activity(acct, '2000-01-01', '2026-11-01'), /too long/);
  });
});
