import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, sys, createUser, createOrg, addMember, expectDenied, closeDb, setSubscription, type TestUser } from './helpers';

let owner: TestUser, acct: TestUser, mgr: TestUser, emp: TestUser, other: TestUser;
let org: string, otherOrg: string;
let vendor: string, otherVendor: string;
let rent: string, inventory: string, ap: string, bank: string, cash: string, sales: string;

const role = async (o: string, r: string) =>
  (await sys<{ id: string }>(`select id from public.accounts where organization_id = $1 and role = $2`, [o, r]))[0].id;
const balance = async (o: string, accountId: string) =>
  Number((await sys<{ b: string }>(
    `select coalesce(sum(debit_cents - credit_cents), 0) as b from public.journal_lines where organization_id = $1 and account_id = $2`,
    [o, accountId]))[0].b);

const createBill = (u: TestUser, o: string, v: string, num: string, lines: object[], date = '2026-11-03', due: string | null = null) =>
  as<{ id: string }>(u,
    `select public.create_bill($1, $2, $3, $4::date, $5::date, $6::jsonb) as id`,
    [o, v, num, date, due, JSON.stringify(lines)]);
const approve = (u: TestUser, b: string) => as<{ id: string }>(u, `select public.approve_bill($1) as id`, [b]);
const pay = (u: TestUser, b: string, cents: number, key: string, source = 'bank', date = '2026-11-08') =>
  as<{ id: string }>(u, `select public.record_bill_payment($1, $2::date, $3, $4::public.payment_source, $5) as id`,
    [b, date, cents, source, key]);
const voidBill = (u: TestUser, b: string, reason = 'Entered twice') =>
  as(u, `select public.void_bill($1, $2)`, [b, reason]);
const bill = async (b: string) =>
  (await sys<{ status: string; paid_cents: string; total_cents: string; due_date: string; journal_entry_id: string | null }>(
    `select status, paid_cents, total_cents, to_char(due_date, 'YYYY-MM-DD') as due_date, journal_entry_id from public.bills where id = $1`, [b]))[0];

beforeAll(async () => {
  owner = await createUser('ap-owner');
  acct = await createUser('ap-acct');
  mgr = await createUser('ap-mgr');
  emp = await createUser('ap-emp');
  other = await createUser('ap-other');
  org = await createOrg(owner, 'AP Co', 'retail');
  otherOrg = await createOrg(other, 'Other AP Co', 'retail');
  await addMember(owner, org, acct, 'accountant');
  await addMember(owner, org, mgr, 'manager');
  await addMember(owner, org, emp, 'employee');
  [rent, inventory, ap, bank, cash, sales] = await Promise.all(
    ['rent', 'inventory', 'accounts_payable', 'bank', 'cash_on_hand', 'sales'].map((r) => role(org, r)));
  [{ id: vendor }] = await as<{ id: string }>(owner,
    `insert into public.vendors (organization_id, name, payment_terms_days) values ($1, 'Acme Supply', 15) returning id`, [org]);
  [{ id: otherVendor }] = await as<{ id: string }>(other,
    `insert into public.vendors (organization_id, name) values ($1, 'Their Vendor') returning id`, [otherOrg]);
});
afterAll(closeDb);

describe('vendors', () => {
  it('vendors.view roles can read; employees and outsiders cannot', async () => {
    expect(await as(mgr, `select id from public.vendors where organization_id = $1`, [org])).toHaveLength(1);
    expect(await as(acct, `select id from public.vendors where organization_id = $1`, [org])).toHaveLength(1);
    expect(await as(emp, `select id from public.vendors where organization_id = $1`, [org])).toHaveLength(0);
    expect(await as(other, `select id from public.vendors where organization_id = $1`, [org])).toHaveLength(0);
  });

  it('only vendors.manage can create or edit (managers cannot)', async () => {
    await expectDenied(as(mgr, `insert into public.vendors (organization_id, name) values ($1, 'Mgr Vendor')`, [org]));
    await expectDenied(as(other, `insert into public.vendors (organization_id, name) values ($1, 'Intruder')`, [org]));
    expect(await as(mgr, `update public.vendors set name = 'Hijacked' where id = $1 returning id`, [vendor])).toHaveLength(0);
  });

  it('vendor names are unique per business, case-insensitively', async () => {
    await expect(as(owner, `insert into public.vendors (organization_id, name) values ($1, ' acme supply ')`, [org]))
      .rejects.toThrow(/duplicate|unique/);
  });

  it('a vendor default account must belong to the same business', async () => {
    await expect(as(other, `update public.vendors set default_account_id = $1 where id = $2`, [rent, otherVendor]))
      .rejects.toThrow(/foreign key/);
  });

  it('vendors cannot be deleted or moved to another business by clients', async () => {
    await expectDenied(as(owner, `delete from public.vendors where id = $1`, [vendor]));
    await expectDenied(as(owner, `update public.vendors set organization_id = $1 where id = $2`, [otherOrg, vendor]));
  });
});

describe('creating bills', () => {
  it('creates a draft with the total from its lines and due date from vendor terms', async () => {
    const [{ id }] = await createBill(mgr, org, vendor, 'INV-100', [
      { account_id: inventory, amount_cents: 40_000, description: 'Case goods' },
      { account_id: rent, amount_cents: 2_500 },
    ]);
    const b = await bill(id);
    expect(b.status).toBe('draft');
    expect(Number(b.total_cents)).toBe(42_500);
    expect(b.due_date).toBe('2026-11-18');
    expect(b.journal_entry_id).toBeNull();
  });

  it('rejects a duplicate vendor invoice number', async () => {
    await expectDenied(createBill(mgr, org, vendor, ' inv-100 ', [{ account_id: rent, amount_cents: 1 }]), /already exists/);
  });

  it('rejects non-expense accounts, other businesses’ accounts and vendors, and bad amounts', async () => {
    await expectDenied(createBill(mgr, org, vendor, 'BAD-1', [{ account_id: sales, amount_cents: 100 }]), /expense or inventory/);
    await expectDenied(createBill(mgr, org, vendor, 'BAD-2', [{ account_id: await role(otherOrg, 'rent'), amount_cents: 100 }]), /expense or inventory/);
    await expectDenied(createBill(mgr, org, otherVendor, 'BAD-3', [{ account_id: rent, amount_cents: 100 }]), /vendor not found/);
    await expectDenied(createBill(mgr, org, vendor, 'BAD-4', [{ account_id: rent, amount_cents: 0 }]), /positive/);
    await expectDenied(createBill(mgr, org, vendor, 'BAD-5', []), /1 to 100 lines/);
  });

  it('requires bills.create and a writable business', async () => {
    await expectDenied(createBill(emp, org, vendor, 'EMP-1', [{ account_id: rent, amount_cents: 100 }]));
    await expectDenied(createBill(other, org, vendor, 'OUT-1', [{ account_id: rent, amount_cents: 100 }]));
    const u = await createUser('ap-unpaid');
    const o = await createOrg(u, 'Unpaid AP', 'retail');
    const [{ id: v }] = await as<{ id: string }>(u, `insert into public.vendors (organization_id, name) values ($1, 'V') returning id`, [o]);
    await setSubscription(o, 'unpaid', { extraLocations: 5 });
    await expectDenied(createBill(u, o, v, 'U-1', [{ account_id: await role(o, 'rent'), amount_cents: 100 }]));
  });

  it('clients cannot write bills, lines or payments directly', async () => {
    await expectDenied(as(owner, `insert into public.bills (organization_id, vendor_id, bill_number, bill_date, due_date, total_cents) values ($1, $2, 'X', '2026-11-01', '2026-11-02', 1)`, [org, vendor]));
    await expectDenied(as(owner, `update public.bills set status = 'paid', paid_cents = total_cents where organization_id = $1`, [org]));
    await expectDenied(as(owner, `delete from public.bills where organization_id = $1`, [org]));
  });
});

describe('approving and paying', () => {
  let b: string;
  beforeAll(async () => {
    [{ id: b }] = await createBill(mgr, org, vendor, 'INV-200', [
      { account_id: inventory, amount_cents: 30_000 },
      { account_id: rent, amount_cents: 20_000 },
    ]);
  });

  it('managers cannot approve; accountants can, which posts Dr expense/inventory, Cr AP', async () => {
    await expectDenied(approve(mgr, b));
    const apBefore = await balance(org, ap);
    const [{ id: entry }] = await approve(acct, b);
    expect((await bill(b)).status).toBe('approved');
    expect((await bill(b)).journal_entry_id).toBe(entry);
    expect(await balance(org, ap) - apBefore).toBe(-50_000);
    const lines = await sys<{ d: string; c: string }>(
      `select sum(debit_cents) as d, sum(credit_cents) as c from public.journal_lines where entry_id = $1`, [entry]);
    expect(Number(lines[0].d)).toBe(50_000);
    expect(Number(lines[0].c)).toBe(50_000);
  });

  it('cannot approve twice', async () => {
    await expectDenied(approve(acct, b), /only draft/);
  });

  it('accountants cannot pay (bills.pay is owner/admin); owners can, partially', async () => {
    await expectDenied(pay(acct, b, 10_000, 'pay-acct-0001'));
    const bankBefore = await balance(org, bank);
    await pay(owner, b, 20_000, 'pay-200-part-1');
    expect(await balance(org, bank) - bankBefore).toBe(-20_000);
    const s = await bill(b);
    expect(s.status).toBe('approved');
    expect(Number(s.paid_cents)).toBe(20_000);
  });

  it('payment retries are idempotent; key reuse with other data is rejected', async () => {
    const [{ id: first }] = await sys<{ id: string }>(`select id from public.bill_payments where idempotency_key = 'pay-200-part-1'`);
    const [{ id: again }] = await pay(owner, b, 20_000, 'pay-200-part-1');
    expect(again).toBe(first);
    await expectDenied(pay(owner, b, 1, 'pay-200-part-1'), /different payment data/);
    expect(Number((await bill(b)).paid_cents)).toBe(20_000);
  });

  it('cannot overpay, pay before the bill date, or pay zero', async () => {
    await expectDenied(pay(owner, b, 30_001, 'pay-200-over'), /open balance/);
    await expectDenied(pay(owner, b, 100, 'pay-200-early', 'bank', '2026-11-01'), /before the bill date/);
    await expectDenied(pay(owner, b, 0, 'pay-200-zero1'), /positive/);
  });

  it('paying the remainder from cash marks the bill paid and clears AP for it', async () => {
    const cashBefore = await balance(org, cash);
    await pay(owner, b, 30_000, 'pay-200-part-2', 'cash_on_hand');
    expect(await balance(org, cash) - cashBefore).toBe(-30_000);
    expect((await bill(b)).status).toBe('paid');
    await expectDenied(pay(owner, b, 1, 'pay-200-after'), /only approved/);
  });

  it('bills with payments cannot be voided; payment rows are immutable', async () => {
    await expectDenied(voidBill(owner, b), /payments cannot be voided/);
    await expect(sys(`update public.bill_payments set amount_cents = 1 where bill_id = $1`, [b])).rejects.toThrow(/immutable/);
    await expect(sys(`delete from public.bill_lines where bill_id = $1`, [b])).rejects.toThrow(/immutable/);
  });

  it('outsiders cannot see the bill, its lines or payments', async () => {
    expect(await as(other, `select id from public.bills where id = $1`, [b])).toHaveLength(0);
    expect(await as(other, `select id from public.bill_lines where bill_id = $1`, [b])).toHaveLength(0);
    expect(await as(other, `select id from public.bill_payments where bill_id = $1`, [b])).toHaveLength(0);
    expect(await as(emp, `select id from public.bills where id = $1`, [b])).toHaveLength(0);
  });
});

describe('voiding', () => {
  it('voids a draft without touching the ledger, and frees its invoice number', async () => {
    const [{ id }] = await createBill(mgr, org, vendor, 'INV-300', [{ account_id: rent, amount_cents: 999 }]);
    await expectDenied(voidBill(mgr, id));
    await expectDenied(voidBill(acct, id, ''), /reason/);
    await voidBill(acct, id);
    expect((await bill(id)).status).toBe('void');
    await expectDenied(voidBill(acct, id), /already void/);
    await createBill(mgr, org, vendor, 'INV-300', [{ account_id: rent, amount_cents: 999 }]);
  });

  it('voiding an approved bill posts a reversing entry that nets AP back to zero', async () => {
    const [{ id }] = await createBill(mgr, org, vendor, 'INV-400', [{ account_id: rent, amount_cents: 7_000 }]);
    const apBefore = await balance(org, ap);
    const [{ id: entry }] = await approve(acct, id);
    expect(await balance(org, ap) - apBefore).toBe(-7_000);
    await voidBill(acct, id);
    expect(await balance(org, ap)).toBe(apBefore);
    expect(await sys(`select 1 from public.journal_entries where reverses_entry_id = $1`, [entry])).toHaveLength(1);
  });

  it('bill entries cannot be reversed directly through the ledger', async () => {
    const [{ id }] = await createBill(mgr, org, vendor, 'INV-500', [{ account_id: rent, amount_cents: 1_000 }]);
    const [{ id: entry }] = await approve(acct, id);
    await expectDenied(as(acct, `select public.reverse_journal_entry($1, '2026-11-09'::date, 'manual undo')`, [entry]), /void the bill/);
    expect((await bill(id)).status).toBe('approved');
  });
});

describe('bill account options', () => {
  it('managers (no accounting.view) get expense + inventory accounts only; outsiders are denied', async () => {
    const rows = await as<{ id: string; type: string }>(mgr, `select * from public.bill_account_options($1)`, [org]);
    expect(rows.map((r) => r.id)).toContain(rent);
    expect(rows.map((r) => r.id)).toContain(inventory);
    expect(rows.map((r) => r.id)).not.toContain(sales);
    expect(rows.every((r) => r.type === 'expense' || r.type === 'asset')).toBe(true);
    await expectDenied(as(other, `select * from public.bill_account_options($1)`, [org]));
    await expectDenied(as(emp, `select * from public.bill_account_options($1)`, [org]));
  });
});
