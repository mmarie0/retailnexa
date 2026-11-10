import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { balanceSheet, incomeStatement } from '../../src/lib/accounting/statements';
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

describe('account_activity_detail', () => {
  it('returns every account with its movement in the range', async () => {
    const rows = await as<{ code: string; role: string | null; net_cents: string }>(acct,
      `select * from public.account_activity_detail($1, '2026-11-01'::date, '2026-11-30'::date)`, [org]);
    expect(rows.length).toBeGreaterThanOrEqual(25);
    expect(Number(rows.find((r) => r.role === 'sales')!.net_cents)).toBe(-30_000);
    expect(Number(rows.find((r) => r.role === 'rent')!.net_cents)).toBe(0);
  });
  it('is denied to managers and outsiders', async () => {
    await expectDenied(as(mgr, `select * from public.account_activity_detail($1, '2026-11-01'::date, '2026-11-30'::date)`, [org]));
    await expectDenied(as(other, `select * from public.account_activity_detail($1, '2026-11-01'::date, '2026-11-30'::date)`, [org]));
  });
});

describe('statements from real ledger data', () => {
  it('balance sheet balances and P&L net income equals equity growth', async () => {
    // Add a bill (expense) and a payment so liabilities and cash both move.
    const [{ id: v }] = await as<{ id: string }>(owner, `insert into public.vendors (organization_id, name) values ($1, 'Landlord') returning id`, [org]);
    const [{ id: rent }] = await sys<{ id: string }>(`select id from public.accounts where organization_id = $1 and role = 'rent'`, [org]);
    const [{ id: bill }] = await as<{ id: string }>(acct, `select public.create_bill($1, $2, 'NOV-RENT', '2026-11-01'::date, null, $3::jsonb) as id`,
      [org, v, JSON.stringify([{ account_id: rent, amount_cents: 15_000 }])]);
    await as(acct, `select public.approve_bill($1)`, [bill]);
    await as(owner, `select public.record_bill_payment($1, '2026-11-05'::date, 5_000, 'cash_on_hand', 'dash-pay-0001')`, [bill]);

    const tb = await as<{ account_id: string; code: string; name: string; type: 'asset'; balance_cents: string }>(acct,
      `select * from public.trial_balance($1, '2026-11-30'::date)`, [org]);
    const b = balanceSheet(tb.map((r) => ({ id: r.account_id, code: r.code, name: r.name, type: r.type, role: null, net: Number(r.balance_cents) })));
    expect(b.balanced).toBe(true);

    const act = await as<{ account_id: string; code: string; name: string; type: 'asset'; role: string | null; net_cents: string }>(acct,
      `select * from public.account_activity_detail($1, '2026-10-01'::date, '2026-11-30'::date)`, [org]);
    const p = incomeStatement(act.map((r) => ({ id: r.account_id, code: r.code, name: r.name, type: r.type, role: r.role, net: Number(r.net_cents) })));
    expect(p.revenue.total).toBe(80_000);
    expect(p.operatingExpenses.total).toBe(15_000);
    expect(p.netIncome).toBe(b.currentEarnings);
  });
});
