import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, sys, createUser, createOrg, addMember, setSubscription, expectDenied, closeDb, type TestUser } from './helpers';

// Batch D part 1: location balances (#106) and profit partners (#104).
let owner: TestUser, admin: TestUser, mgrA: TestUser, acct: TestUser, emp: TestUser, outsider: TestUser;
let org: string, A: string, B: string;

beforeAll(async () => {
  owner = await createUser('pb-owner'); admin = await createUser('pb-admin'); mgrA = await createUser('pb-mgrA');
  acct = await createUser('pb-acct'); emp = await createUser('pb-emp'); outsider = await createUser('pb-out');
  org = await createOrg(owner, 'Partners Co', 'retail');
  [{ id: A }] = await sys<{ id: string }>(`select id from public.locations where organization_id = $1 limit 1`, [org]);
  [{ id: B }] = await as<{ id: string }>(owner, `insert into public.locations (organization_id, name, kind) values ($1, 'PB Store B', 'store') returning id`, [org]);
  await addMember(owner, org, admin, 'admin');
  const m = await addMember(owner, org, mgrA, 'manager');
  await as(owner, `select public.set_member_locations($1, $2::uuid[])`, [m, [A]]);
  // Give the store-A manager bills.pay so store limits (not the role) decide below.
  await as(owner, `select public.set_member_permission($1, 'bills.pay', true)`, [m]);
  await addMember(owner, org, acct, 'accountant');
  await addMember(owner, org, emp, 'employee');
});
afterAll(closeDb);

const bal = (u: TestUser, p: object, id: string | null = null) =>
  as<{ id: string }>(u, `select public.save_location_balance($1, $2, $3::jsonb) as id`, [org, id, JSON.stringify(p)]);
const base = { direction: 'owed_to_me', other_party: 'JLO Brandon', entry_date: '2026-10-28', due_date: '2026-11-05', amount_cents: 12500 };

describe('location balances (#106)', () => {
  let id: string;
  it('records a balance with lines that add up; the month defaults to the entry month', async () => {
    [{ id }] = await bal(owner, { ...base, location_id: A, lines: [{ description: 'Wigs', amount_cents: 10000 }, { description: 'Gel', amount_cents: 2500 }] });
    const [row] = await sys<{ count_month: string; amount_cents: string }>(`select count_month::text, amount_cents from public.location_balances where id = $1`, [id]);
    expect(row).toEqual({ count_month: '2026-10-01', amount_cents: '12500' });
    await expectDenied(bal(owner, { ...base, location_id: A, lines: [{ description: 'Wigs', amount_cents: 1 }] }), /add up to the total/);
    await expectDenied(bal(owner, { ...base, location_id: A, direction: 'sideways' }), /who owes whom/);
    await expectDenied(bal(owner, { ...base, location_id: A, amount_cents: 0 }), /over zero/);
  });
  it('payments never exceed what is left; the amount can’t drop below what was paid', async () => {
    await as(owner, `select public.add_location_balance_payment($1, $2, '2026-11-01', 10000, 'zelle', 'Z1')`, [org, id]);
    await expectDenied(as(owner, `select public.add_location_balance_payment($1, $2, '2026-11-01', 2501, 'cash', null)`, [org, id]), /no more than what is left/);
    await expectDenied(as(owner, `select public.add_location_balance_payment($1, $2, '2099-01-01', 1, 'cash', null)`, [org, id]), /future/);
    await expectDenied(bal(owner, { ...base, location_id: A, amount_cents: 9000 }, id), /less than what was already paid/);
    await expectDenied(as(owner, `select public.delete_location_balance($1, $2)`, [org, id]), /payments first/);
  });
  it('store limits: the store-A manager sees and changes only store A', async () => {
    const [{ id: bId }] = await bal(owner, { ...base, location_id: B, direction: 'i_owe' });
    const seen = await as<{ id: string }>(mgrA, `select id from public.location_balances where organization_id = $1`, [org]);
    expect(seen.map((r) => r.id)).toEqual([id]);
    expect((await as(mgrA, `select id from public.location_balance_payments where organization_id = $1`, [org])).length).toBe(1);
    await expectDenied(bal(mgrA, { ...base, location_id: B }), /store you don.t have access to/);
    await expectDenied(as(mgrA, `select public.add_location_balance_payment($1, $2, '2026-11-01', 1, 'cash', null)`, [org, bId]), /store you don.t have access to/);
    await as(mgrA, `select public.add_location_balance_payment($1, $2, '2026-11-02', 2500, 'cash', null)`, [org, id]);
  });
  it('roles without bills access, outsiders, anon and direct writes are refused', async () => {
    expect(await as(emp, `select id from public.location_balances where organization_id = $1`, [org])).toEqual([]);
    expect(await as(outsider, `select id from public.location_balances where organization_id = $1`, [org])).toEqual([]);
    await expectDenied(bal(emp, { ...base, location_id: A }));
    await expectDenied(bal(outsider, { ...base, location_id: A }));
    await expectDenied(as({ kind: 'anon' } as never, `select public.save_location_balance($1, null, '{}'::jsonb)`, [org]));
    await expectDenied(as(owner, `insert into public.location_balances (organization_id, direction, location_id, other_party, entry_date, count_month, amount_cents) values ($1, 'i_owe', $2, 'X', '2026-11-01', '2026-11-01', 1)`, [org, A]));
    await expectDenied(as(owner, `delete from public.location_balance_payments where organization_id = $1`, [org]));
  });
  it('a removed payment frees the balance; a read-only business can’t write', async () => {
    const [{ id: pid }] = await sys<{ id: string }>(`select id from public.location_balance_payments where balance_id = $1 order by created_at desc limit 1`, [id]);
    await as(owner, `select public.delete_location_balance_payment($1, $2)`, [org, pid]);
    const u = await createUser('pb-ro');
    const ro = await createOrg(u, 'RO Balances', 'retail');
    const [{ id: roLoc }] = await sys<{ id: string }>(`select id from public.locations where organization_id = $1 limit 1`, [ro]);
    await setSubscription(ro, 'canceled');
    await expectDenied(as(u, `select public.save_location_balance($1, null, $2::jsonb)`, [ro, JSON.stringify({ ...base, location_id: roLoc })]));
  });
});

describe('profit partners (#104)', () => {
  const partners = [{ name: 'Partner A', pct: 33.33 }, { name: 'Partner B', pct: 33.33 }, { name: 'Partner C', pct: 33.34 }];
  let dist: string;
  it('owners and admins set partners; active shares must total 100%', async () => {
    await expectDenied(as(owner, `select public.save_partners($1, $2::jsonb)`, [org, JSON.stringify([{ name: 'X', pct: 60 }])]), /100 percent/);
    await expectDenied(as(owner, `select public.save_partners($1, $2::jsonb)`, [org, JSON.stringify([{ name: 'X', pct: 100.001 }])]), /two decimals|0 to 100/);
    expect((await as<{ n: number }>(admin, `select public.save_partners($1, $2::jsonb) as n`, [org, JSON.stringify(partners)]))[0].n).toBe(3);
    await expectDenied(as(acct, `select public.save_partners($1, $2::jsonb)`, [org, JSON.stringify(partners)]));
    await expectDenied(as(mgrA, `select public.save_partners($1, $2::jsonb)`, [org, JSON.stringify(partners)]));
  });
  it('a distribution splits by % and the shares add up to the total exactly', async () => {
    [{ id: dist }] = await as<{ id: string }>(owner, `select public.create_distribution($1, '2026-10-01', '2026-11-05', 10000, 'Oct') as id`, [org]);
    const shares = await sys<{ name: string; share_cents: string }>(
      `select p.name, s.share_cents from public.distribution_shares s join public.partners p on p.id = s.partner_id where s.distribution_id = $1 order by p.name`, [dist]);
    expect(shares.map((s) => [s.name, Number(s.share_cents)])).toEqual([['Partner A', 3333], ['Partner B', 3333], ['Partner C', 3334]]);
    const [{ id: d2 }] = await as<{ id: string }>(owner, `select public.create_distribution($1, '2026-10-01', '2026-11-05', 1, null) as id`, [org]);
    expect((await sys<{ t: string }>(`select sum(share_cents) as t from public.distribution_shares where distribution_id = $1`, [d2]))[0].t).toBe('1');
    await as(owner, `select public.delete_distribution($1, $2)`, [org, d2]);
  });
  it('pays shares in parts, never more than the share', async () => {
    const [{ id: share }] = await sys<{ id: string }>(`select s.id from public.distribution_shares s join public.partners p on p.id = s.partner_id where s.distribution_id = $1 and p.name = 'Partner C'`, [dist]);
    await as(owner, `select public.add_distribution_payment($1, $2, '2026-11-05', 2000, 'check', '1001')`, [org, share]);
    await as(owner, `select public.add_distribution_payment($1, $2, '2026-11-05', 1334, 'check', '1002')`, [org, share]);
    await expectDenied(as(owner, `select public.add_distribution_payment($1, $2, '2026-11-05', 1, 'check', null)`, [org, share]), /no more than what is left/);
    await expectDenied(as(owner, `select public.delete_distribution($1, $2)`, [org, dist]), /payments first/);
  });
  it('dropping a partner with history makes them inactive; without history removes them; names match without ids', async () => {
    await as(owner, `select public.save_partners($1, $2::jsonb)`, [org, JSON.stringify([{ name: 'partner a', pct: 50 }, { name: 'Partner D', pct: 50 }, { name: 'Temp', pct: 0 }])]);
    await as(owner, `select public.save_partners($1, $2::jsonb)`, [org, JSON.stringify([{ name: 'Partner A', pct: 50 }, { name: 'Partner D', pct: 50 }])]);
    const rows = await sys<{ name: string; is_active: boolean; pct: string }>(`select name, is_active, pct from public.partners where organization_id = $1 order by name`, [org]);
    expect(rows.map((r) => [r.name, r.is_active, Number(r.pct)])).toEqual([
      ['Partner A', true, 50], ['Partner B', false, 33.33], ['Partner C', false, 33.34], ['Partner D', true, 50],
    ]);
  });
  it('read: profit.view and every store; others see nothing', async () => {
    expect((await as(acct, `select id from public.distributions where organization_id = $1`, [org])).length).toBe(1);
    expect(await as(mgrA, `select id from public.distributions where organization_id = $1`, [org])).toEqual([]);
    expect(await as(emp, `select id from public.partners where organization_id = $1`, [org])).toEqual([]);
    expect(await as(outsider, `select id from public.partners where organization_id = $1`, [org])).toEqual([]);
    await expectDenied(as({ kind: 'anon' } as never, `select public.create_distribution($1, '2026-10-01', '2026-11-01', 1, null)`, [org]));
  });
  it('manual profit months: set, replace, clear; future months refused', async () => {
    await as(owner, `select public.save_profit_months($1, $2::jsonb)`, [org, JSON.stringify([{ month: '2026-09-15', profit_cents: 500000 }, { month: '2026-08-01', profit_cents: -2000 }])]);
    await as(owner, `select public.save_profit_months($1, $2::jsonb)`, [org, JSON.stringify([{ month: '2026-09-01', profit_cents: 600000, note: 'CPA' }, { month: '2026-08-01', profit_cents: null }])]);
    expect(await as(acct, `select month::text, profit_cents, note from public.profit_months where organization_id = $1`, [org])).toEqual([{ month: '2026-09-01', profit_cents: '600000', note: 'CPA' }]);
    await expectDenied(as(owner, `select public.save_profit_months($1, $2::jsonb)`, [org, JSON.stringify([{ month: '2099-01-01', profit_cents: 1 }])]), /started/);
    await expectDenied(as(acct, `select public.save_profit_months($1, $2::jsonb)`, [org, JSON.stringify([{ month: '2026-09-01', profit_cents: 1 }])]));
  });
});
