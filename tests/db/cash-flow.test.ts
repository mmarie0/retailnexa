import { afterAll, describe, expect, it } from 'vitest';
import { cashFlow, type BalanceRow } from '../../src/lib/accounting/cash-flow';
import { as, sys, createUser, createOrg, closeDb } from './helpers';

afterAll(closeDb);

describe('cash flow from real postings', () => {
  it('ties to the change in cash and bank across sales, bills, deposits, tax and draws', async () => {
    const u = await createUser('cf-owner');
    const o = await createOrg(u, 'Cash Flow Co', 'retail');
    const [{ id: store }] = await sys<{ id: string }>(`select id from public.locations where organization_id = $1 limit 1`, [o]);
    const acc = async (r: string) => (await sys<{ id: string }>(`select id from public.accounts where organization_id = $1 and role = $2`, [o, r]))[0].id;
    // Before the period: owner puts in $10,000.
    await as(u, `select public.record_money_movement($1, 'owner_contribution', '2026-10-15'::date, 1000000, 'cf-contrib-01')`, [o]);
    // During November.
    const [{ id: v }] = await as<{ id: string }>(u, `insert into public.vendors (organization_id, name) values ($1, 'Supplier') returning id`, [o]);
    const [{ id: bill }] = await as<{ id: string }>(u, `select public.create_bill($1, $2, 'B-1', '2026-11-02'::date, null, $3::jsonb) as id`,
      [o, v, JSON.stringify([{ account_id: await acc('inventory'), amount_cents: 300_000 }])]);
    await as(u, `select public.approve_bill($1)`, [bill]);
    await as(u, `select public.record_bill_payment($1, '2026-11-05'::date, 200000, 'bank', 'cf-pay-0001')`, [bill]);
    await as(u, `select public.record_sales_day($1, $2, '2026-11-03'::date, 100000, 5000, 7125, 30000, 72125, 0, 'Reg 1')`, [o, store]);
    await as(u, `select public.record_money_movement($1, 'card_deposit', '2026-11-04'::date, 72125, 'cf-card-0001', 2100)`, [o]);
    await as(u, `select public.record_money_movement($1, 'sales_tax_payment', '2026-11-20'::date, 7125, 'cf-tax-00001')`, [o]);
    await as(u, `select public.record_money_movement($1, 'owner_draw', '2026-11-25'::date, 10000, 'cf-draw-0001')`, [o]);

    const roles = new Map((await sys<{ id: string; role: string | null }>(`select id, role from public.accounts where organization_id = $1`, [o])).map((a) => [a.id, a.role]));
    const tb = async (d: string) => (await as<{ account_id: string; code: string; name: string; type: BalanceRow['type']; balance_cents: string }>(u,
      `select * from public.trial_balance($1, $2::date)`, [o, d])).map((r) => ({ id: r.account_id, code: r.code, name: r.name, type: r.type, role: roles.get(r.account_id) ?? null, balance: Number(r.balance_cents) }));
    const cf = cashFlow(await tb('2026-10-31'), await tb('2026-11-30'));
    expect(cf.ties).toBe(true);
    expect(cf.cashStart).toBe(1_000_000);
    expect(cf.netIncome).toBe(95_000 - 2_100);
    expect(cf.financingTotal).toBe(-10_000);
    expect(cf.cashEnd).toBe(1_000_000 - 200_000 + 30_000 + 70_025 - 7_125 - 10_000);
  });
});
