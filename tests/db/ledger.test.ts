import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, sys, createUser, createOrg, addMember, expectDenied, closeDb, setSubscription, type TestUser } from './helpers';

let owner: TestUser, acct: TestUser, mgr: TestUser, other: TestUser;
let org: string, otherOrg: string;
const role = async (o: string, r: string) =>
  (await sys<{ id: string }>(`select id from public.accounts where organization_id = $1 and role = $2`, [o, r]))[0].id;

let cash: string, sales: string, inventory: string, ap: string, otherCash: string;

beforeAll(async () => {
  owner = await createUser('led-owner');
  acct = await createUser('led-acct');
  mgr = await createUser('led-mgr');
  other = await createUser('led-other');
  org = await createOrg(owner, 'Ledger Co', 'retail');
  otherOrg = await createOrg(other, 'Other Ledger Co', 'retail');
  await addMember(owner, org, acct, 'accountant');
  await addMember(owner, org, mgr, 'manager');
  [cash, sales, inventory, ap, otherCash] = await Promise.all([
    role(org, 'cash_on_hand'), role(org, 'sales'), role(org, 'inventory'), role(org, 'accounts_payable'), role(otherOrg, 'cash_on_hand'),
  ]);
});
afterAll(closeDb);

const lines = (debitAcct: string, creditAcct: string, cents: number) =>
  JSON.stringify([{ account_id: debitAcct, debit_cents: cents }, { account_id: creditAcct, credit_cents: cents }]);
const post = (u: TestUser, o: string, l: string, key: string, date = '2026-11-05') =>
  as<{ id: string }>(u, `select public.post_journal_entry($1, $2::date, 'Test entry', $3::jsonb, $4) as id`, [o, date, l, key]);

describe('chart of accounts', () => {
  it('every new organization gets a default chart with one account per role', async () => {
    const rows = await sys<{ n: number }>(`select count(*)::int as n from public.accounts where organization_id = $1 and is_system`, [org]);
    expect(rows[0].n).toBeGreaterThanOrEqual(20);
    expect(cash).toBeTruthy();
  });

  it('only accounting roles can see the chart; managers and outsiders cannot', async () => {
    expect((await as(acct, `select id from public.accounts where organization_id = $1`, [org])).length).toBeGreaterThan(10);
    expect(await as(mgr, `select id from public.accounts where organization_id = $1`, [org])).toHaveLength(0);
    expect(await as(other, `select id from public.accounts where organization_id = $1`, [org])).toHaveLength(0);
  });

  it('system accounts cannot be renamed or deactivated', async () => {
    const r = await as(owner, `update public.accounts set is_active = false where id = $1 returning id`, [cash]);
    expect(r).toHaveLength(0);
  });
});

describe('posting', () => {
  it('posts a balanced entry and is idempotent on the key', async () => {
    const [{ id }] = await post(acct, org, lines(cash, sales, 12_500), 'sale-2026-11-05-reg1');
    const [{ id: again }] = await post(acct, org, lines(cash, sales, 12_500), 'sale-2026-11-05-reg1');
    expect(again).toBe(id);
    expect((await sys(`select 1 from public.journal_entries where organization_id = $1 and idempotency_key = 'sale-2026-11-05-reg1'`, [org]))).toHaveLength(1);
  });

  it('rejects reuse of a key with different data', async () => {
    await expectDenied(post(acct, org, lines(cash, sales, 99), 'sale-2026-11-05-reg1'), /idempotency key reused/);
  });

  it('rejects unbalanced, single-line, zero and mixed lines', async () => {
    const unbalanced = JSON.stringify([{ account_id: cash, debit_cents: 100 }, { account_id: sales, credit_cents: 90 }]);
    await expectDenied(post(acct, org, unbalanced, 'bad-unbalanced-1'), /does not balance/);
    await expectDenied(post(acct, org, JSON.stringify([{ account_id: cash, debit_cents: 100 }]), 'bad-single-1'), /at least two lines/);
    const both = JSON.stringify([{ account_id: cash, debit_cents: 100, credit_cents: 100 }, { account_id: sales, credit_cents: 0, debit_cents: 0 }]);
    await expectDenied(post(acct, org, both, 'bad-mixed-01'), /check constraint|zero/);
  });

  it('rejects another business’s account (cross-tenant)', async () => {
    await expectDenied(post(acct, org, lines(otherCash, sales, 100), 'xt-account-1'), /active account of this business/);
  });

  it('requires accounting.post: managers and outsiders cannot post', async () => {
    await expectDenied(post(mgr, org, lines(cash, sales, 100), 'mgr-post-001'));
    await expectDenied(post(other, org, lines(cash, sales, 100), 'out-post-001'));
  });

  it('read-only (unpaid) businesses cannot post', async () => {
    const u = await createUser('led-unpaid');
    const o = await createOrg(u, 'Unpaid Ledger', 'retail');
    await setSubscription(o, 'unpaid', { extraLocations: 5 });
    await expectDenied(post(u, o, lines(await role(o, 'cash_on_hand'), await role(o, 'sales'), 100), 'unpaid-post-1'));
  });
});

describe('immutability and reversal', () => {
  it('posted entries and lines cannot be changed or deleted, even by the superuser', async () => {
    const [{ id }] = await post(acct, org, lines(inventory, ap, 50_000), 'bill-inv-001');
    await expect(sys(`update public.journal_lines set debit_cents = 1 where entry_id = $1`, [id])).rejects.toThrow(/immutable/);
    await expect(sys(`delete from public.journal_entries where id = $1`, [id])).rejects.toThrow(/immutable/);
    await expectDenied(as(owner, `delete from public.journal_entries where id = $1`, [id]), /permission denied/);
  });

  it('reverses an entry exactly once with mirrored lines', async () => {
    const [{ id }] = await post(acct, org, lines(cash, sales, 3_000), 'to-reverse-01');
    const [{ r }] = await as<{ r: string }>(acct, `select public.reverse_journal_entry($1, '2026-11-06', 'Rang twice') as r`, [id]);
    const rl = await sys<{ account_id: string; debit_cents: string; credit_cents: string }>(
      `select account_id, debit_cents, credit_cents from public.journal_lines where entry_id = $1 order by id`, [r]);
    expect(rl).toEqual([
      { account_id: cash, debit_cents: '0', credit_cents: '3000' },
      { account_id: sales, debit_cents: '3000', credit_cents: '0' },
    ]);
    await expectDenied(as(acct, `select public.reverse_journal_entry($1, '2026-11-06', 'Again')`, [id]), /already been reversed/);
    await expectDenied(as(acct, `select public.reverse_journal_entry($1, '2026-11-06', 'Reverse the reversal')`, [r]), /cannot itself be reversed/);
  });
});

describe('closing periods', () => {
  it('blocks postings on or before the closed date, and only accounting.close can close', async () => {
    await expectDenied(as(mgr, `select public.close_books_through($1, '2026-10-31')`, [org]));
    await as(acct, `select public.close_books_through($1, '2026-10-31', 'October closed')`, [org]);
    await expectDenied(post(acct, org, lines(cash, sales, 100), 'late-oct-01', '2026-10-31'), /closed through/);
    await post(acct, org, lines(cash, sales, 100), 'early-nov-01', '2026-11-01');
    await expectDenied(as(acct, `select public.close_books_through($1, '2026-10-15')`, [org]), /already closed/);
  });
});

describe('trial balance', () => {
  it('always balances and is scoped by permission', async () => {
    const rows = await as<{ debit_cents: string; credit_cents: string }>(acct, `select * from public.trial_balance($1, '2026-12-31')`, [org]);
    const d = rows.reduce((a, r) => a + Number(r.debit_cents), 0);
    const c = rows.reduce((a, r) => a + Number(r.credit_cents), 0);
    expect(d).toBe(c);
    expect(d).toBeGreaterThan(0);
    await expectDenied(as(mgr, `select * from public.trial_balance($1, '2026-12-31')`, [org]));
    await expectDenied(as(other, `select * from public.trial_balance($1, '2026-12-31')`, [org]));
  });

  it('system posting is service-role only', async () => {
    await expectDenied(as(owner, `select public.system_post_journal_entry($1, '2026-11-07', 'x', $2::jsonb, 'sys-key-0001', 'pos_import')`, [org, lines(cash, sales, 100)]), /permission denied/);
    const [{ id }] = await as<{ id: string }>({ kind: 'service' }, `select public.system_post_journal_entry($1, '2026-11-07', 'POS day', $2::jsonb, 'sys-key-0001', 'pos_import') as id`, [org, lines(cash, sales, 100)]);
    const [e] = await sys(`select posted_by_system from public.journal_entries where id = $1`, [id]);
    expect(e).toEqual({ posted_by_system: true });
  });
});
