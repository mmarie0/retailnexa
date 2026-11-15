import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, sys, createUser, createOrg, addMember, expectDenied, closeDb, type TestUser } from './helpers';

// Sales reps and commission: rep records, who's credited, earned (invoiced or as paid), payouts and balances.
let owner: TestUser, mgr: TestUser, acct: TestUser, repUser: TestUser, rep2User: TestUser, viewer: TestUser, outsider: TestUser;
let org: string, other: string, cust: string, item: string, rA: string, rB: string;
const j = (v: unknown) => JSON.stringify(v);
const one = async (u: TestUser, sql: string, args: unknown[]) => (await as<{ r: string }>(u, sql, args))[0].r;
const summary = (u: TestUser, from = '2026-01-01', to = '2026-12-31') =>
  as<{ name: string; earned_cents: string; paid_out_cents: string; balance_cents: string; invoiced_sales_cents: string }>(u,
    `select name, earned_cents, paid_out_cents, balance_cents, invoiced_sales_cents from public.rep_commission_summary($1, $2::date, $3::date)`, [org, from, to]);

beforeAll(async () => {
  owner = await createUser('rep-owner'); mgr = await createUser('rep-mgr'); acct = await createUser('rep-acct'); repUser = await createUser('rep-a');
  rep2User = await createUser('rep-b'); viewer = await createUser('rep-viewer'); outsider = await createUser('rep-out');
  org = await createOrg(owner, 'Reps Wholesale', 'wholesale');
  other = await createOrg(outsider, 'Other Co', 'wholesale');
  await addMember(owner, org, mgr, 'manager');
  await addMember(owner, org, acct, 'accountant');
  await addMember(owner, org, repUser, 'sales_rep');
  await addMember(owner, org, rep2User, 'sales_rep');
  await addMember(owner, org, viewer, 'viewer');
  cust = await one(owner, `select public.save_customer($1, null, $2::jsonb) as r`, [org, j({ name: 'Corner Mart', terms: 30 })]);
  item = await one(owner, `select public.save_item($1, null, $2::jsonb) as r`, [org, j({ name: 'Braid', cost_cents: 100, price_cents: 300, qty: 1000 })]);
});
afterAll(closeDb);

describe('sales reps and commission', () => {
  it('only commission managers add reps; logins must be on the team, once', async () => {
    rA = await one(owner, `select public.save_sales_rep($1, null, $2::jsonb) as r`, [org, j({ name: 'Ana', user_id: repUser.id, rate_pct: 10, basis: 'sales', earn_on: 'invoiced', monthly_target_cents: 1000000 })]);
    rB = await one(owner, `select public.save_sales_rep($1, null, $2::jsonb) as r`, [org, j({ name: 'Ben', user_id: rep2User.id, rate_pct: 20, basis: 'profit', earn_on: 'paid' })]);
    await expectDenied(as(mgr, `select public.save_sales_rep($1, null, $2::jsonb)`, [org, j({ name: 'X' })]));
    await expectDenied(as(repUser, `select public.save_sales_rep($1, null, $2::jsonb)`, [org, j({ name: 'X' })]));
    await expectDenied(as(owner, `select public.save_sales_rep($1, null, $2::jsonb)`, [org, j({ name: 'X', user_id: outsider.id })]), /isn't on your team/);
    await expectDenied(as(owner, `select public.save_sales_rep($1, null, $2::jsonb)`, [org, j({ name: 'X', user_id: repUser.id })]), /already linked/);
    await expectDenied(as(owner, `select public.save_sales_rep($1, null, $2::jsonb)`, [org, j({ name: 'X', rate_pct: 120 })]), /0 to 100/);
    await expectDenied(as(owner, `select public.set_customer_rep($1, $2, $3)`, [other, cust, rA]));
  });

  it('credit: a rep’s own orders are theirs; otherwise the customer’s rep; invoices follow the order', async () => {
    await as(owner, `select public.set_customer_rep($1, $2, $3)`, [org, cust, rB]);
    const byRep = await one(repUser, `select public.save_sales_order($1, null, $2::jsonb) as r`, [org, j({ customer_id: cust, order_date: '2026-03-02', lines: [{ item_id: item, qty: 10, price_cents: 300 }] })]);
    const byOwner = await one(owner, `select public.save_sales_order($1, null, $2::jsonb) as r`, [org, j({ customer_id: cust, order_date: '2026-03-03', lines: [{ item_id: item, qty: 20, price_cents: 300 }] })]);
    expect((await sys(`select rep_id from public.sales_orders where id = $1`, [byRep]))[0].rep_id).toBe(rA);
    expect((await sys(`select rep_id from public.sales_orders where id = $1`, [byOwner]))[0].rep_id).toBe(rB);
    const i1 = await one(acct, `select public.invoice_order($1, $2, '2026-03-05') as r`, [org, byRep]);
    const i2 = await one(acct, `select public.invoice_order($1, $2, '2026-03-06') as r`, [org, byOwner]);
    expect((await sys(`select rep_id from public.customer_invoices where id = any($1) order by invoice_date`, [[i1, i2]])).map((r) => r.rep_id)).toEqual([rA, rB]);
    // Reps can't move credit; managers can.
    await expectDenied(as(repUser, `select public.set_order_rep($1, $2, $3)`, [org, byOwner, rA]));
    // Ben (20% of profit, as paid): invoice 2 is $60 sales, $40 profit; half paid in April.
    await as(acct, `select public.record_customer_payment($1, $2, '2026-04-10', 3000, 'check', null, null, null)`, [org, i2]);
  });

  it('earned, paid out and balance; reps see only their own', async () => {
    const all = await summary(owner);
    // Ana: 10% of $30 sales when invoiced = 300c. Ben: 20% of $40 profit × half paid = 400c.
    expect(all.map((r) => [r.name, Number(r.earned_cents), Number(r.invoiced_sales_cents)])).toEqual([['Ana', 300, 3000], ['Ben', 400, 6000]]);
    const march = await summary(owner, '2026-03-01', '2026-03-31');
    expect(march.map((r) => [r.name, Number(r.earned_cents)])).toEqual([['Ana', 300], ['Ben', 0]]);
    await as(owner, `select public.record_commission_payout($1, $2, '2026-04-30', 250, 'check', '1001', null)`, [org, rA]);
    await expectDenied(as(mgr, `select public.record_commission_payout($1, $2, '2026-04-30', 250, 'check', null, null)`, [org, rA]));
    await expectDenied(as(owner, `select public.record_commission_payout($1, $2, '2099-01-01', 250, 'check', null, null)`, [org, rA]), /future/);
    expect((await summary(owner)).map((r) => [r.name, Number(r.paid_out_cents), Number(r.balance_cents)])).toEqual([['Ana', 250, 50], ['Ben', 0, 400]]);
    // Ana sees only Ana, everywhere.
    expect((await summary(repUser)).map((r) => r.name)).toEqual(['Ana']);
    expect((await as(repUser, `select name from public.sales_reps where organization_id = $1`, [org])).map((r) => r.name)).toEqual(['Ana']);
    expect((await as(repUser, `select amount_cents from public.commission_payouts where organization_id = $1`, [org])).length).toBe(1);
    expect(await as(rep2User, `select amount_cents from public.commission_payouts where organization_id = $1`, [org])).toEqual([]);
    expect(await as(repUser, `select * from public.rep_commission_lines($1, $2, '2026-01-01', '2026-12-31')`, [org, rB])).toEqual([]);
    expect((await as(repUser, `select number from public.rep_commission_lines($1, $2, '2026-01-01', '2026-12-31')`, [org, rA])).length).toBe(1);
    // Viewers and outsiders see nothing.
    expect(await summary(viewer)).toEqual([]);
    expect(await as(outsider, `select * from public.rep_commission_summary($1, '2026-01-01', '2026-12-31')`, [org])).toEqual([]);
    expect(await as(viewer, `select id from public.sales_reps where organization_id = $1`, [org])).toEqual([]);
  });

  it('payouts are voided with a reason, never edited or deleted', async () => {
    const [{ id }] = await sys<{ id: string }>(`select id from public.commission_payouts where rep_id = $1`, [rA]);
    await expectDenied(as(owner, `update public.commission_payouts set amount_cents = 1 where id = $1`, [id]));
    await expectDenied(as(owner, `delete from public.commission_payouts where id = $1`, [id]));
    await expectDenied(as(owner, `select public.void_commission_payout($1, $2, ' ')`, [org, id]), /say why/);
    await as(owner, `select public.void_commission_payout($1, $2, 'wrong amount')`, [org, id]);
    await expectDenied(as(owner, `select public.void_commission_payout($1, $2, 'again')`, [org, id]), /already void/);
    expect((await summary(owner)).find((r) => r.name === 'Ana')!.balance_cents).toBe('300');
  });
});
