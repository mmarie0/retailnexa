import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, sys, createUser, createOrg, addMember, expectDenied, closeDb, type TestUser } from './helpers';

let owner: TestUser, acct: TestUser, mgr: TestUser, emp: TestUser, other: TestUser;
let org: string;
const bal = async (r: string) => Number((await sys<{ b: string }>(
  `select coalesce(sum(l.debit_cents - l.credit_cents), 0) as b from public.journal_lines l join public.accounts a on a.id = l.account_id
    where l.organization_id = $1 and a.role = $2`, [org, r]))[0].b);
const mm = (u: TestUser, kind: string, amount: number, key: string, fees = 0, account = 'bank', date = '2026-11-08') =>
  as<{ id: string }>(u, `select public.record_money_movement($1, $2, $3::date, $4, $5, $6, $7) as id`, [org, kind, date, amount, key, fees, account]);

beforeAll(async () => {
  owner = await createUser('mm-owner'); acct = await createUser('mm-acct'); mgr = await createUser('mm-mgr');
  emp = await createUser('mm-emp'); other = await createUser('mm-other');
  org = await createOrg(owner, 'Money Co', 'retail');
  await createOrg(other, 'Other Money Co', 'retail');
  await addMember(owner, org, acct, 'accountant');
  await addMember(owner, org, mgr, 'manager');
  await addMember(owner, org, emp, 'employee');
});
afterAll(closeDb);

describe('record_money_movement', () => {
  it('card deposit: bank gets gross − fees, fees expensed, card clearing reduced', async () => {
    await mm(acct, 'card_deposit', 100_000, 'card-dep-0001', 2_900);
    expect(await bal('bank')).toBe(97_100);
    expect(await bal('card_fees')).toBe(2_900);
    expect(await bal('card_clearing')).toBe(-100_000);
  });

  it('is idempotent on the key', async () => {
    const [{ id: a }] = await mm(acct, 'card_deposit', 100_000, 'card-dep-0001', 2_900);
    const [{ id: b }] = await mm(acct, 'card_deposit', 100_000, 'card-dep-0001', 2_900);
    expect(a).toBe(b);
    expect(await bal('bank')).toBe(97_100);
  });

  it('cash deposit moves cash to bank; managers and employees with cash.create may record it', async () => {
    await mm(mgr, 'cash_deposit', 50_000, 'cash-dep-0001');
    await mm(emp, 'cash_deposit', 1_000, 'cash-dep-0002');
    expect(await bal('cash_on_hand')).toBe(-51_000);
    expect(await bal('bank')).toBe(97_100 + 51_000);
  });

  it('managers cannot record tax payments, draws or card deposits; outsiders nothing', async () => {
    await expectDenied(mm(mgr, 'sales_tax_payment', 100, 'mgr-tax-0001'));
    await expectDenied(mm(mgr, 'owner_draw', 100, 'mgr-draw-001'));
    await expectDenied(mm(mgr, 'card_deposit', 100, 'mgr-card-001'));
    await expectDenied(as(other, `select public.record_money_movement($1, 'cash_deposit', '2026-11-08'::date, 100, 'out-cash-001')`, [org]));
  });

  it('sales tax payment reduces the liability; owner draw is equity, never an expense', async () => {
    await mm(owner, 'sales_tax_payment', 7_000, 'tax-pay-0001');
    expect(await bal('sales_tax_payable')).toBe(7_000);
    await mm(owner, 'owner_draw', 20_000, 'draw-00001', 0, 'cash_on_hand');
    expect(await bal('owner_draws')).toBe(20_000);
    const exp = await sys<{ b: string }>(`select coalesce(sum(l.debit_cents - l.credit_cents),0) as b from public.journal_lines l join public.accounts a on a.id = l.account_id where l.organization_id = $1 and a.type = 'expense' and a.role <> 'card_fees'`, [org]);
    expect(Number(exp[0].b)).toBe(0);
  });

  it('owner contribution adds to equity', async () => {
    await mm(owner, 'owner_contribution', 500_000, 'contrib-0001');
    expect(await bal('owner_equity')).toBe(-500_000);
  });

  it('validates amounts, fees and accounts', async () => {
    await expectDenied(mm(acct, 'card_deposit', 0, 'bad-zero-001'), /positive/);
    await expectDenied(mm(acct, 'card_deposit', 100, 'bad-fees-001', 100), /less than/);
    await expectDenied(mm(acct, 'cash_deposit', 100, 'bad-fees-002', 5), /only apply/);
    await expectDenied(mm(acct, 'sales_tax_payment', 100, 'bad-acct-001', 0, 'cash_on_hand'), /invalid account/);
    await expectDenied(mm(acct, 'refund_everything', 100, 'bad-kind-001'), /unknown kind/);
  });
});

describe('recent_money_movements', () => {
  it('accountants see all guided entries; managers only cash deposits; outsiders denied', async () => {
    const all = await as<{ kind: string }>(acct, `select * from public.recent_money_movements($1)`, [org]);
    expect(new Set(all.map((r) => r.kind))).toEqual(new Set(['card_deposit', 'cash_deposit', 'sales_tax_payment', 'owner_draw', 'owner_contribution']));
    const mine = await as<{ kind: string }>(mgr, `select * from public.recent_money_movements($1)`, [org]);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((r) => r.kind === 'cash_deposit')).toBe(true);
    await expectDenied(as(other, `select * from public.recent_money_movements($1)`, [org]));
  });
});

describe('sales_tax_summary', () => {
  it('splits opening, collected, paid and closing', async () => {
    const [{ id: store }] = await sys<{ id: string }>(`select id from public.locations where organization_id = $1 limit 1`, [org]);
    // October: collect 300; November: collect 700 (+ the 7,000 paid on Nov 8 above).
    await as(mgr, `select public.record_sales_day($1, $2, '2026-10-20'::date, 5000, 0, 300, 5300, 0, 0, 'R1')`, [org, store]);
    await as(mgr, `select public.record_sales_day($1, $2, '2026-11-02'::date, 10000, 0, 700, 10700, 0, 0, 'R1')`, [org, store]);
    const [s] = await as<Record<string, string>>(acct, `select * from public.sales_tax_summary($1, '2026-11-01'::date, '2026-11-30'::date)`, [org]);
    expect(Number(s.opening_cents)).toBe(300);
    expect(Number(s.collected_cents)).toBe(700);
    expect(Number(s.paid_cents)).toBe(7_000);
    expect(Number(s.closing_cents)).toBe(300 + 700 - 7_000);
    await expectDenied(as(mgr, `select * from public.sales_tax_summary($1, '2026-11-01'::date, '2026-11-30'::date)`, [org]));
  });
});
