import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openAsOf } from '../../src/lib/accounting/aging';
import { as, sys, createUser, createOrg, addMember, expectDenied, closeDb, type TestUser } from './helpers';

let owner: TestUser, acct: TestUser, mgr: TestUser;
let org: string, store: string;
const role = async (r: string) => (await sys<{ id: string }>(`select id from public.accounts where organization_id = $1 and role = $2`, [org, r]))[0].id;
const bal = async (r: string) => Number((await sys<{ b: string }>(
  `select coalesce(sum(l.debit_cents - l.credit_cents), 0) as b from public.journal_lines l join public.accounts a on a.id = l.account_id
    where l.organization_id = $1 and a.role = $2`, [org, r]))[0].b);

beforeAll(async () => {
  owner = await createUser('qa2-owner'); acct = await createUser('qa2-acct'); mgr = await createUser('qa2-mgr');
  org = await createOrg(owner, 'QA2 Co', 'retail');
  await addMember(owner, org, acct, 'accountant');
  await addMember(owner, org, mgr, 'manager');
  [{ id: store }] = await sys<{ id: string }>(`select id from public.locations where organization_id = $1 limit 1`, [org]);
});
afterAll(closeDb);

describe('void a bill payment (#36)', () => {
  it('reverses the payment, restores the open balance and AP, and keeps the record', async () => {
    const [{ id: v }] = await as<{ id: string }>(owner, `insert into public.vendors (organization_id, name) values ($1, 'Vendor A') returning id`, [org]);
    const [{ id: bill }] = await as<{ id: string }>(mgr, `select public.create_bill($1, $2, 'INV-1002', '2026-11-01'::date, '2026-11-15'::date, $3::jsonb) as id`,
      [org, v, JSON.stringify([{ account_id: await role('inventory'), amount_cents: 45_050 }])]);
    await as(acct, `select public.approve_bill($1)`, [bill]);
    const [{ id: pay }] = await as<{ id: string }>(owner, `select public.record_bill_payment($1, '2026-11-10'::date, 20000, 'bank', 'qa2-pay-0001') as id`, [bill]);
    expect(await bal('accounts_payable')).toBe(-25_050);

    await expectDenied(as(acct, `select public.void_bill_payment($1, 'typo')`, [pay])); // accountant lacks bills.pay
    await expectDenied(as(owner, `select public.void_bill_payment($1, '')`, [pay]), /reason/);
    await as(owner, `select public.void_bill_payment($1, 'Entered 200 instead of 20')`, [pay]);

    expect(await bal('accounts_payable')).toBe(-45_050);
    expect(await bal('bank')).toBe(0);
    const [b] = await sys<{ status: string; paid_cents: string }>(`select status, paid_cents from public.bills where id = $1`, [bill]);
    expect(b).toMatchObject({ status: 'approved', paid_cents: '0' });
    expect(await sys(`select 1 from public.bill_payments where id = $1`, [pay])).toHaveLength(1);
    await expectDenied(as(owner, `select public.void_bill_payment($1, 'again please')`, [pay]), /already voided/);

    // The correct payment can now be recorded, and the bill can still be paid in full.
    await as(owner, `select public.record_bill_payment($1, '2026-11-10'::date, 2000, 'bank', 'qa2-pay-0002')`, [bill]);
    await as(owner, `select public.record_bill_payment($1, '2026-11-11'::date, 43050, 'bank', 'qa2-pay-0003')`, [bill]);
    const [b2] = await sys<{ status: string }>(`select status from public.bills where id = $1`, [bill]);
    expect(b2.status).toBe('paid');
  });

  it('payment entries still cannot be reversed directly from the journal', async () => {
    const [{ e }] = await sys<{ e: string }>(`select journal_entry_id as e from public.bill_payments where idempotency_key like '%qa2-pay-0002'`);
    await expectDenied(as(owner, `select public.reverse_journal_entry($1, '2026-11-12'::date, 'manual undo')`, [e]), /void the bill or the payment/);
  });
});

describe('one whole-store report or per-register reports, not both (#45)', () => {
  const day = (reg: string, date = '2026-11-05') =>
    as(mgr, `select public.record_sales_day($1, $2, $3::date, 10892, 5199, 399, 1817, 4275, 0, $4)`, [org, store, date, reg]);

  it('refuses a whole-store report after a per-register one, and the reverse', async () => {
    await day('Reg 1');
    await expectDenied(day('All registers'), /already recorded/);
    await day('All registers', '2026-11-06');
    await expectDenied(day('Register 2', '2026-11-06'), /already recorded/);
  });

  it('treats "Reg 1", "Register #1" and "register1" as the same register', async () => {
    await expectDenied(day('Register #1'), /already recorded/);
    await expectDenied(day('register1'), /already recorded/);
    await day('Reg 2');
    expect(Number((await sys<{ n: string }>(`select count(*) as n from public.sales_days where organization_id = $1 and business_date = '2026-11-05'`, [org]))[0].n)).toBe(2);
  });

  it('a voided whole-store day can be replaced by per-register reports', async () => {
    const [{ id }] = await sys<{ id: string }>(`select id from public.sales_days where organization_id = $1 and business_date = '2026-11-06'`, [org]);
    await as(owner, `select public.void_sales_day($1, 'switch to per register')`, [id]);
    await day('Reg 1', '2026-11-06');
  });
});

describe('aging as of a past date ties to balance-sheet AP (#37)', () => {
  it('matches trial-balance Accounts payable on several dates', async () => {
    const u = await createUser('aging-owner');
    const o = await createOrg(u, 'Aging Co', 'retail');
    const acc = async (r: string) => (await sys<{ id: string }>(`select id from public.accounts where organization_id = $1 and role = $2`, [o, r]))[0].id;
    const [{ id: v }] = await as<{ id: string }>(u, `insert into public.vendors (organization_id, name) values ($1, 'V') returning id`, [o]);
    const mk = async (num: string, date: string, due: string, cents: number) => {
      const [{ id }] = await as<{ id: string }>(u, `select public.create_bill($1, $2, $3, $4::date, $5::date, $6::jsonb) as id`,
        [o, v, num, date, due, JSON.stringify([{ account_id: await acc('rent'), amount_cents: cents }])]);
      await as(u, `select public.approve_bill($1)`, [id]);
      return id;
    };
    await mk('INV-1001', '2026-11-01', '2026-11-30', 120_000);
    const b2 = await mk('INV-1002', '2026-11-01', '2026-11-15', 45_050);
    await mk('RENT', '2026-11-01', '2026-11-01', 350_000);
    await mk('UTIL', '2026-11-05', '2026-11-05', 31_000);
    await as(u, `select public.record_bill_payment($1, '2026-11-10'::date, 20000, 'bank', 'aging-pay-001')`, [b2]);
    const [{ id: p2 }] = await as<{ id: string }>(u, `select public.record_bill_payment($1, '2026-11-03'::date, 5000, 'bank', 'aging-pay-002') as id`, [b2]);
    await as(u, `select public.void_bill_payment($1, 'wrong amount')`, [p2]);

    const bills = await sys<{ id: string; bill_date: string; total_cents: string }>(`select id, to_char(bill_date,'YYYY-MM-DD') as bill_date, total_cents from public.bills where organization_id = $1`, [o]);
    const pays = await sys<{ id: string; bill_id: string; paid_on: string; amount_cents: string }>(`select id, bill_id, to_char(paid_on,'YYYY-MM-DD') as paid_on, amount_cents from public.bill_payments where organization_id = $1`, [o]);
    const voided = new Set((await sys<{ payment_id: string }>(`select payment_id from public.bill_payment_voids where organization_id = $1`, [o])).map((r) => r.payment_id));
    for (const asOf of ['2026-11-02', '2026-11-05', '2026-11-12']) {
      const aging = bills.reduce((a, b) => a + openAsOf({ billDate: b.bill_date, totalCents: Number(b.total_cents), posted: true, voidedOn: null,
        payments: pays.filter((p) => p.bill_id === b.id).map((p) => ({ paidOn: p.paid_on, amountCents: Number(p.amount_cents), voided: voided.has(p.id) })) }, asOf), 0);
      const [tb] = await sys<{ b: string }>(`select balance_cents as b from public.trial_balance($1, $2::date) where code = '2000'`, [o, asOf]).catch(async () =>
        sys<{ b: string }>(`select coalesce(sum(l.debit_cents - l.credit_cents),0) as b from public.journal_lines l join public.journal_entries e on e.id = l.entry_id join public.accounts a on a.id = l.account_id where l.organization_id = $1 and a.role = 'accounts_payable' and e.entry_date <= $2::date`, [o, asOf]));
      expect(aging).toBe(-Number(tb.b));
    }
  });
});
