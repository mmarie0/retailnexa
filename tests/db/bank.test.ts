import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, sys, createUser, createOrg, addMember, expectDenied, closeDb, type TestUser } from './helpers';

let owner: TestUser, acct: TestUser, mgr: TestUser, other: TestUser;
let org: string, otherOrg: string;
const role = async (o: string, r: string) =>
  (await sys<{ id: string }>(`select id from public.accounts where organization_id = $1 and role = $2`, [o, r]))[0].id;
const bal = async (r: string) => Number((await sys<{ b: string }>(
  `select coalesce(sum(l.debit_cents - l.credit_cents), 0) as b from public.journal_lines l join public.accounts a on a.id = l.account_id
    where l.organization_id = $1 and a.role = $2`, [org, r]))[0].b);
const line = (date: string, description: string, amount_cents: number, occurrence = 1) => ({ date, description, amount_cents, occurrence });
const imp = (u: TestUser, o: string, lines: object[]) =>
  as<{ batch_id: string; inserted: number; duplicates: number }>(u, `select * from public.import_bank_lines($1, 'stmt.csv', $2::jsonb)`, [o, JSON.stringify(lines)]);
const lineId = async (desc: string) => (await sys<{ id: string }>(`select id from public.bank_lines where organization_id = $1 and description = $2`, [org, desc]))[0].id;

beforeAll(async () => {
  owner = await createUser('bank-owner'); acct = await createUser('bank-acct'); mgr = await createUser('bank-mgr'); other = await createUser('bank-other');
  org = await createOrg(owner, 'Bank Co', 'retail');
  otherOrg = await createOrg(other, 'Other Bank Co', 'retail');
  await addMember(owner, org, acct, 'accountant');
  await addMember(owner, org, mgr, 'manager');
  // Existing books: a card deposit of $971 net on Nov 3 and a cash deposit of $500 on Nov 4.
  await as(acct, `select public.record_money_movement($1, 'card_deposit', '2026-11-03'::date, 100000, 'bk-card-0001', 2900)`, [org]);
  await as(acct, `select public.record_money_movement($1, 'cash_deposit', '2026-11-04'::date, 50000, 'bk-cash-0001')`, [org]);
});
afterAll(closeDb);

describe('import', () => {
  it('imports lines and skips duplicates on re-import (same-day identical lines kept apart by occurrence)', async () => {
    const lines = [
      line('2026-11-04', 'STRIPE TRANSFER', 97_100), line('2026-11-05', 'DEPOSIT', 50_000),
      line('2026-11-06', 'MONTHLY SERVICE FEE', -1_500), line('2026-11-07', 'ATM', -2_000, 1), line('2026-11-07', 'ATM', -2_000, 2),
    ];
    const [r1] = await imp(acct, org, lines);
    expect(r1).toMatchObject({ inserted: 5, duplicates: 0 });
    const [r2] = await imp(acct, org, [...lines, line('2026-11-08', 'NEW LINE', 100)]);
    expect(r2).toMatchObject({ inserted: 1, duplicates: 5 });
  });

  it('requires accounting.post to import; managers and outsiders are denied', async () => {
    await expectDenied(imp(mgr, org, [line('2026-11-09', 'X', 1)]));
    await expectDenied(imp(other, org, [line('2026-11-09', 'X', 1)]));
  });

  it('rejects zero amounts and empty descriptions', async () => {
    await expectDenied(imp(acct, org, [line('2026-11-09', 'Zero', 0)]), /non-zero/);
    await expectDenied(imp(acct, org, [line('2026-11-09', '  ', 5)]), /description/);
  });

  it('bank.view roles read lines; managers and outsiders see none; lines cannot be edited or deleted', async () => {
    expect((await as(acct, `select id from public.bank_lines where organization_id = $1`, [org])).length).toBe(6);
    expect(await as(mgr, `select id from public.bank_lines where organization_id = $1`, [org])).toHaveLength(0);
    expect(await as(other, `select id from public.bank_lines where organization_id = $1`, [org])).toHaveLength(0);
    await expectDenied(as(owner, `update public.bank_lines set status = 'ignored' where organization_id = $1`, [org]));
    await expect(sys(`update public.bank_lines set amount_cents = 1 where organization_id = $1`, [org])).rejects.toThrow(/cannot be edited/);
    await expect(sys(`delete from public.bank_lines where organization_id = $1`, [org])).rejects.toThrow(/immutable/);
  });
});

describe('matching', () => {
  it('suggests entries that moved the bank by the same signed amount within the window', async () => {
    const c = await as<{ line_id: string; source_type: string; day_diff: number }>(acct, `select * from public.bank_match_candidates($1)`, [org]);
    const stripe = await lineId('STRIPE TRANSFER');
    const dep = await lineId('DEPOSIT');
    expect(c.filter((x) => x.line_id === stripe).map((x) => x.source_type)).toEqual(['card_deposit']);
    expect(c.filter((x) => x.line_id === dep).map((x) => x.source_type)).toEqual(['cash_deposit']);
    expect(c.find((x) => x.line_id === stripe)!.day_diff).toBe(1);
  });

  it('matches a line; the entry cannot be matched twice or reversed while matched', async () => {
    const stripe = await lineId('STRIPE TRANSFER');
    const [{ entry_id }] = await as<{ entry_id: string }>(acct, `select entry_id from public.bank_match_candidates($1) where line_id = $2`, [org, stripe]);
    await as(acct, `select public.match_bank_line($1, $2)`, [stripe, entry_id]);
    const dep = await lineId('DEPOSIT');
    await expectDenied(as(acct, `select public.match_bank_line($1, $2)`, [dep, entry_id]), /did not move|already matched/);
    await expectDenied(as(acct, `select public.reverse_journal_entry($1, '2026-11-09'::date, 'oops undo')`, [entry_id]), /unmatch it first/);
  });

  it('refuses an entry with a different amount or from another business', async () => {
    const dep = await lineId('DEPOSIT');
    const [{ id: wrong }] = await sys<{ id: string }>(`select id from public.journal_entries where organization_id = $1 and source_type = 'card_deposit'`, [org]);
    await expectDenied(as(acct, `select public.match_bank_line($1, $2)`, [dep, wrong]), /did not move/);
    await as(other, `select public.record_money_movement($1, 'cash_deposit', '2026-11-04'::date, 50000, 'oth-cash-0001')`, [otherOrg]);
    const [{ id: theirs }] = await sys<{ id: string }>(`select id from public.journal_entries where organization_id = $1`, [otherOrg]);
    await expectDenied(as(acct, `select public.match_bank_line($1, $2)`, [dep, theirs]), /entry not found/);
  });
});

describe('categorize, ignore, unmatch', () => {
  it('categorizing a withdrawal posts Dr expense / Cr bank; uncategorizing reverses; re-categorizing works', async () => {
    const fee = await lineId('MONTHLY SERVICE FEE');
    const otherOp = await role(org, 'other_operating');
    const bankBefore = await bal('bank');
    await as(acct, `select public.categorize_bank_line($1, $2, 'Bank fee')`, [fee, otherOp]);
    expect(await bal('bank') - bankBefore).toBe(-1_500);
    expect(await bal('other_operating')).toBe(1_500);
    await as(acct, `select public.unmatch_bank_line($1)`, [fee]);
    expect(await bal('bank')).toBe(bankBefore);
    await as(acct, `select public.categorize_bank_line($1, $2, 'Bank fee')`, [fee, otherOp]);
    expect(await bal('other_operating')).toBe(1_500);
    const [{ e }] = await sys<{ e: string }>(`select journal_entry_id as e from public.bank_lines where id = $1`, [fee]);
    await expectDenied(as(acct, `select public.reverse_journal_entry($1, '2026-11-09'::date, 'manual undo')`, [e]), /uncategorize/);
  });

  it('categorizing a deposit posts Dr bank / Cr chosen account; the bank itself cannot be chosen', async () => {
    const newLine = await lineId('NEW LINE');
    await expectDenied(as(acct, `select public.categorize_bank_line($1, $2)`, [newLine, await role(org, 'bank')]), /other than the bank/);
    await as(acct, `select public.categorize_bank_line($1, $2)`, [newLine, await role(org, 'other_income')]);
    expect(await bal('other_income')).toBe(-100);
  });

  it('ignore needs a reason; resolved lines cannot be resolved again; managers cannot resolve', async () => {
    const [{ id: atm }] = await sys<{ id: string }>(`select id from public.bank_lines where organization_id = $1 and description = 'ATM' order by dedupe_key limit 1`, [org]);
    await expectDenied(as(mgr, `select public.ignore_bank_line($1, 'not ours')`, [atm]));
    await expectDenied(as(acct, `select public.ignore_bank_line($1, '')`, [atm]), /reason/);
    await as(acct, `select public.ignore_bank_line($1, 'Owner personal withdrawal, booked elsewhere')`, [atm]);
    await expectDenied(as(acct, `select public.ignore_bank_line($1, 'again please')`, [atm]), /already resolved/);
    await as(acct, `select public.unmatch_bank_line($1)`, [atm]);
    const [{ status }] = await sys<{ status: string }>(`select status from public.bank_lines where id = $1`, [atm]);
    expect(status).toBe('unmatched');
  });
});
