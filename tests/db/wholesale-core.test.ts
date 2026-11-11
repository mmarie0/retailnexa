import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, sys, createUser, createOrg, addMember, setSubscription, expectDenied, closeDb, type TestUser } from './helpers';

// Wholesale account type, batch W1: tiers, customers, items/stock, orders, invoices, payments, payment plans.
let owner: TestUser, acct: TestUser, mgr: TestUser, rep: TestUser, viewer: TestUser, outsider: TestUser, retailOwner: TestUser;
let org: string, retailOrg: string;
let std: string, vol: string, cust: string, exempt: string, item: string, item2: string;

const call = <T = Record<string, unknown>>(u: TestUser, fn: string, args: unknown[], casts: string[]) =>
  as<T>(u, `select public.${fn}(${casts.map((c, i) => `$${i + 1}::${c}`).join(', ')}) as r`, args);
const one = async (u: TestUser, fn: string, args: unknown[], casts: string[]) => (await call<{ r: string }>(u, fn, args, casts))[0].r;
const j = (v: unknown) => JSON.stringify(v);
const qty = async (id: string) => Number((await sys<{ q: string }>(`select qty as q from public.items where id = $1`, [id]))[0].q);

beforeAll(async () => {
  owner = await createUser('ws-owner'); acct = await createUser('ws-acct'); mgr = await createUser('ws-mgr'); rep = await createUser('ws-rep');
  viewer = await createUser('ws-viewer'); outsider = await createUser('ws-out'); retailOwner = await createUser('ws-retail');
  org = await createOrg(owner, 'Wholesale Co', 'wholesale');
  retailOrg = await createOrg(retailOwner, 'Retail Only Co', 'retail');
  await addMember(owner, org, acct, 'accountant');
  await addMember(owner, org, mgr, 'manager');
  await addMember(owner, org, rep, 'sales_rep');
  await addMember(owner, org, viewer, 'viewer');
});
afterAll(closeDb);

describe('wholesale core (W1)', () => {
  it('a Retail-only business can’t use wholesale writes', async () => {
    await expectDenied(call(retailOwner, 'save_customer', [retailOrg, null, j({ name: 'X' })], ['uuid', 'uuid', 'jsonb']), /Wholesale accounts/);
  });

  it('owners set price tiers and add customers; bad input is refused', async () => {
    await call(owner, 'save_price_tiers', [org, j([{ name: 'Standard', pct: 0 }, { name: 'Volume', pct: 5 }])], ['uuid', 'jsonb']);
    [{ id: std }, { id: vol }] = await sys<{ id: string }>(`select id from public.price_tiers where organization_id = $1 order by sort`, [org]);
    await expectDenied(call(owner, 'save_price_tiers', [org, j([{ name: 'A', pct: 95 }])], ['uuid', 'jsonb']), /0 to 90/);
    await expectDenied(call(owner, 'save_price_tiers', [org, j([{ name: 'A', pct: 1 }, { name: 'a', pct: 2 }])], ['uuid', 'jsonb']), /different name/);
    cust = await one(owner, 'save_customer', [org, null, j({ name: 'Corner Mart', email: 'buy@corner.test', terms: 30, tier_id: vol, credit_limit_cents: 500000 })], ['uuid', 'uuid', 'jsonb']);
    exempt = await one(owner, 'save_customer', [org, null, j({ name: 'Reseller LLC', terms: 0, tax_exempt: true, resale_cert: 'R-1' })], ['uuid', 'uuid', 'jsonb']);
    await expectDenied(call(owner, 'save_customer', [org, null, j({ name: ' ' })], ['uuid', 'uuid', 'jsonb']), /business name/);
    await expectDenied(call(owner, 'save_customer', [org, null, j({ name: 'Bad', email: 'nope' })], ['uuid', 'uuid', 'jsonb']), /email/);
    await expectDenied(call(owner, 'save_customer', [org, null, j({ name: 'Bad', tier_id: '00000000-0000-0000-0000-000000000001' })], ['uuid', 'uuid', 'jsonb']), /price tiers/);
    // A tier used by a customer can't be dropped.
    await expectDenied(call(owner, 'save_price_tiers', [org, j([{ id: std, name: 'Standard', pct: 0 }])], ['uuid', 'jsonb']), /still used/);
  });

  it('items start with a stock history row; on-hand only changes through adjustments', async () => {
    item = await one(owner, 'save_item', [org, null, j({ name: 'Shampoo 12oz', sku: 'SH-12', cost_cents: 250, price_cents: 450, case_pack: 12, qty: 48 })], ['uuid', 'uuid', 'jsonb']);
    item2 = await one(owner, 'save_item', [org, null, j({ name: 'Conditioner', sku: 'CO-1', cost_cents: 300, price_cents: 600 })], ['uuid', 'uuid', 'jsonb']);
    expect(await qty(item)).toBe(48);
    await expectDenied(call(owner, 'save_item', [org, null, j({ name: 'Dup', sku: 'sh-12' })], ['uuid', 'uuid', 'jsonb']), /duplicate|unique/);
    await call(owner, 'save_item', [org, item, j({ name: 'Shampoo 12oz', sku: 'SH-12', cost_cents: 250, price_cents: 450, qty: 9999 })], ['uuid', 'uuid', 'jsonb']);
    expect(await qty(item)).toBe(48);
    await call(mgr, 'adjust_stock', [org, item2, 24, 'Received'], ['uuid', 'uuid', 'numeric', 'text']);
    await call(mgr, 'adjust_stock', [org, item2, -2, 'Damaged'], ['uuid', 'uuid', 'numeric', 'text']);
    await expectDenied(call(mgr, 'adjust_stock', [org, item2, 1, 'because'], ['uuid', 'uuid', 'numeric', 'text']), /reason/);
    expect(await qty(item2)).toBe(22);
    expect((await sys(`select reason from public.stock_moves where item_id = $1 order by created_at`, [item2])).map((r) => r.reason)).toEqual(['adjust', 'adjust']);
  });

  let quote: string, order: string, inv1: string, inv2: string;
  it('reps create quotes and orders; the server prices cost, totals and numbers', async () => {
    quote = await one(rep, 'save_sales_order', [org, null, j({ kind: 'quote', customer_id: cust, tax_rate: 8, discount_cents: 100, shipping_cents: 500,
      lines: [{ item_id: item, qty: 12, price_cents: 428, cost_cents: 1 }, { name: 'Display rack', qty: 1, price_cents: 2000 }] })], ['uuid', 'uuid', 'jsonb']);
    const [q] = await sys(`select kind, number, subtotal_cents, cost_cents, tax_cents, total_cents from public.sales_orders where id = $1`, [quote]);
    // 12×428 + 2000 = 7136; tax 8% of 7036 = 563; total 7136 − 100 + 500 + 563 = 8099. Cost 12×250 (not the browser's 1).
    expect(q).toEqual({ kind: 'quote', number: 'SO-0001', subtotal_cents: '7136', cost_cents: '3000', tax_cents: '563', total_cents: '8099' });
    await expectDenied(call(rep, 'set_order_status', [org, quote, 'picking'], ['uuid', 'uuid', 'text']), /sales order first/);
    await call(rep, 'set_order_status', [org, quote, 'order'], ['uuid', 'uuid', 'text']);
    order = await one(rep, 'save_sales_order', [org, null, j({ customer_id: exempt, tax_rate: 8, lines: [{ item_id: item, qty: 6, price_cents: 450 }] })], ['uuid', 'uuid', 'jsonb']);
    expect((await sys(`select number, tax_cents from public.sales_orders where id = $1`, [order]))[0]).toEqual({ number: 'SO-0002', tax_cents: '0' });
    await expectDenied(call(rep, 'save_sales_order', [org, null, j({ customer_id: cust, lines: [] })], ['uuid', 'uuid', 'jsonb']), /1 to 300 lines/);
    await expectDenied(call(rep, 'save_sales_order', [org, null, j({ customer_id: cust, discount_cents: 99999, lines: [{ item_id: item, qty: 1, price_cents: 1 }] })], ['uuid', 'uuid', 'jsonb']), /discount/);
    const [line] = await sys<{ id: string }>(`select id from public.sales_order_lines where order_id = $1 and line_no = 1`, [order]);
    await call(rep, 'set_line_picked', [org, line.id, true], ['uuid', 'uuid', 'boolean']);
  });

  it('reps can’t invoice or see invoices; accountants invoice and stock goes out', async () => {
    await expectDenied(call(rep, 'invoice_order', [org, quote, '2026-11-05'], ['uuid', 'uuid', 'date']));
    inv1 = await one(acct, 'invoice_order', [org, quote, '2026-11-05'], ['uuid', 'uuid', 'date']);
    const [i] = await sys(`select number, total_cents, due_date::text from public.customer_invoices where id = $1`, [inv1]);
    expect(i).toEqual({ number: 'INV-1001', total_cents: '8099', due_date: '2026-12-05' });
    expect(await qty(item)).toBe(36);
    expect((await sys(`select status from public.sales_orders where id = $1`, [quote]))[0].status).toBe('invoiced');
    await expectDenied(call(acct, 'invoice_order', [org, quote, '2026-11-05'], ['uuid', 'uuid', 'date']), /closed/);
    expect(await as(rep, `select id from public.customer_invoices where organization_id = $1`, [org])).toEqual([]);
    inv2 = await one(acct, 'create_customer_invoice', [org, j({ customer_id: cust, invoice_date: '2026-10-01', terms: 15, lines: [{ item_id: item2, qty: 2, price_cents: 1000 }] })], ['uuid', 'jsonb']);
    expect((await sys(`select number, due_date::text, total_cents from public.customer_invoices where id = $1`, [inv2]))[0]).toEqual({ number: 'INV-1002', due_date: '2026-10-16', total_cents: '2000' });
    expect(await qty(item2)).toBe(20);
  });

  it('payments can’t exceed the balance; a plan payment goes to the oldest invoice first', async () => {
    await expectDenied(call(acct, 'record_customer_payment', [org, inv2, '2026-11-01', 2001, 'check', '#101', null, null], ['uuid', 'uuid', 'date', 'bigint', 'text', 'text', 'text', 'date']), /balance/);
    await expectDenied(call(acct, 'record_customer_payment', [org, inv2, '2099-01-01', 100, 'check', null, null, null], ['uuid', 'uuid', 'date', 'bigint', 'text', 'text', 'text', 'date']), /future/);
    await call(acct, 'record_customer_payment', [org, inv2, '2026-11-01', 500, 'check', '#101', 'Chase', null], ['uuid', 'uuid', 'date', 'bigint', 'text', 'text', 'text', 'date']);
    expect((await sys(`select check_no, deposit_date from public.customer_payments where invoice_id = $1`, [inv2]))[0]).toEqual({ check_no: '101', deposit_date: null });
    await call(acct, 'add_expected_payments', [org, cust, j([{ due_date: '2026-11-08', amount_cents: 3000, check_no: '102' }, { due_date: '2026-12-08', amount_cents: 7599 }])], ['uuid', 'uuid', 'jsonb']);
    const [e1, e2] = await sys<{ id: string }>(`select id from public.expected_payments where customer_id = $1 order by due_date`, [cust]);
    // 3000: 1500 closes INV-1002 (due Oct 16), 1500 goes on INV-1001.
    expect(await one(acct, 'receive_expected_payment', [org, e1.id, '2026-11-08', null, null, null, null], ['uuid', 'uuid', 'date', 'bigint', 'text', 'text', 'date'])).toBe(2);
    const paid = await sys(`select i.number, sum(p.amount_cents)::int as s from public.customer_payments p join public.customer_invoices i on i.id = p.invoice_id where i.customer_id = $1 group by 1 order by 1`, [cust]);
    expect(paid).toEqual([{ number: 'INV-1001', s: 1500 }, { number: 'INV-1002', s: 2000 }]);
    // Receiving more than is owed is refused and changes nothing.
    await expectDenied(call(acct, 'receive_expected_payment', [org, e2.id, '2026-11-09', 9000, null, null, null], ['uuid', 'uuid', 'date', 'bigint', 'text', 'text', 'date']), /more than this customer owes/);
    expect((await sys(`select status from public.expected_payments where id = $1`, [e2.id]))[0].status).toBe('expected');
    // Deposit the checks; a deposit date before receipt is refused.
    const ids = (await sys<{ id: string }>(`select p.id from public.customer_payments p join public.customer_invoices i on i.id = p.invoice_id where i.customer_id = $1`, [cust])).map((r) => r.id);
    await expectDenied(call(acct, 'mark_payments_deposited', [org, ids, '2026-10-01'], ['uuid', 'uuid[]', 'date']), /after that deposit date/);
    expect(Number(await one(acct, 'mark_payments_deposited', [org, ids, '2026-11-10'], ['uuid', 'uuid[]', 'date']))).toBe(3);
    // Removing the plan's last applied part reopens it.
    const planParts = await sys<{ id: string }>(`select id from public.customer_payments where expected_payment_id = $1`, [e1.id]);
    for (const p of planParts) await call(acct, 'delete_customer_payment', [org, p.id], ['uuid', 'uuid']);
    expect((await sys(`select status from public.expected_payments where id = $1`, [e1.id]))[0].status).toBe('expected');
  });

  it('an invoice with payments can’t be voided; voiding restocks and reopens the order', async () => {
    await expectDenied(call(acct, 'void_customer_invoice', [org, inv2, 'x'], ['uuid', 'uuid', 'text']), /payments first/);
    await call(acct, 'void_customer_invoice', [org, inv1, 'wrong customer'], ['uuid', 'uuid', 'text']);
    expect(await qty(item)).toBe(48);
    expect((await sys(`select status, invoice_id from public.sales_orders where id = $1`, [quote]))[0]).toEqual({ status: 'ready', invoice_id: null });
    await expectDenied(call(acct, 'record_customer_payment', [org, inv1, '2026-11-09', 1, 'cash', null, null, null], ['uuid', 'uuid', 'date', 'bigint', 'text', 'text', 'text', 'date']), /void/);
    // Re-invoicing gets the next number.
    const again = await one(acct, 'invoice_order', [org, quote, '2026-11-09'], ['uuid', 'uuid', 'date']);
    expect((await sys(`select number from public.customer_invoices where id = $1`, [again]))[0].number).toBe('INV-1003');
  });

  it('customers and items with history become inactive instead of deleted', async () => {
    expect(await one(owner, 'delete_customer', [org, cust], ['uuid', 'uuid'])).toBe('inactive');
    expect(await one(owner, 'delete_item', [org, item], ['uuid', 'uuid'])).toBe('inactive');
    const spare = await one(owner, 'save_item', [org, null, j({ name: 'Spare' })], ['uuid', 'uuid', 'jsonb']);
    expect(await one(owner, 'delete_item', [org, spare], ['uuid', 'uuid'])).toBe('deleted');
  });

  it('viewers, outsiders, anon and direct writes are refused; read access follows permissions', async () => {
    expect(await as(viewer, `select id from public.customers where organization_id = $1`, [org])).toEqual([]);
    expect(await as(outsider, `select id from public.items where organization_id = $1`, [org])).toEqual([]);
    expect((await as(rep, `select id from public.customers where organization_id = $1`, [org])).length).toBe(2);
    expect((await as(mgr, `select id from public.customer_invoices where organization_id = $1`, [org])).length).toBe(3);
    await expectDenied(call(viewer, 'save_customer', [org, null, j({ name: 'V' })], ['uuid', 'uuid', 'jsonb']));
    await expectDenied(call(outsider, 'save_item', [org, null, j({ name: 'O' })], ['uuid', 'uuid', 'jsonb']));
    await expectDenied(call(mgr, 'record_customer_payment', [org, inv2, '2026-11-01', 1, 'cash', null, null, null], ['uuid', 'uuid', 'date', 'bigint', 'text', 'text', 'text', 'date']));
    await expectDenied(as({ kind: 'anon' } as never, `select public.save_customer($1, null, '{}'::jsonb)`, [org]));
    await expectDenied(as(owner, `update public.items set qty = 1000 where id = $1`, [item2]));
    await expectDenied(as(owner, `insert into public.stock_moves (organization_id, item_id, qty, reason) values ($1, $2, 5, 'adjust')`, [org, item2]));
    await expectDenied(as(owner, `update public.customer_invoices set total_cents = 1 where id = $1`, [inv2]));
    await expectDenied(as(owner, `delete from public.customer_payments where invoice_id = $1`, [inv2]));
  });

  it('a read-only (canceled) business can’t write', async () => {
    await setSubscription(org, 'canceled', { products: ['wholesale'] });
    await expectDenied(call(owner, 'save_customer', [org, null, j({ name: 'Late' })], ['uuid', 'uuid', 'jsonb']));
    await setSubscription(org, 'active', { products: ['wholesale'] });
  });
});
