import { describe, expect, it } from 'vitest';
import { addDays, aging, agingBucket, committed, invoiceStatus, orderTotals, reorderSuggestion, scheduleGroups, splitPlan, standing, stockValue, tierPrice, withBalances } from './ledger';

const inv = (id: string, due: string, total: number, extra: Partial<{ voided_at: string; customer_id: string }> = {}) => ({
  id, number: id, customer_id: extra.customer_id ?? 'c1', invoice_date: '2026-10-01', due_date: due, total_cents: total, cost_cents: 0, subtotal_cents: total, discount_cents: 0, voided_at: extra.voided_at ?? null,
});
const pay = (invoice_id: string, amount_cents: number) => ({ id: `p-${invoice_id}-${amount_cents}`, invoice_id, paid_on: '2026-11-01', amount_cents, method: 'check', check_no: null, bank: null, deposit_date: null, expected_payment_id: null });

describe('wholesale ledger rules', () => {
  it('order totals match the database: tax on subtotal less discount', () => {
    expect(orderTotals([{ qty: 12, price_cents: 428, cost_cents: 250 }, { qty: 1, price_cents: 2000 }], 100, 500, 8))
      .toEqual({ subtotal: 7136, cost: 3000, tax: 563, total: 8099 });
    expect(orderTotals([], 0, 0, 8).total).toBe(0);
    expect(tierPrice(450, 5)).toBe(428);
  });

  it('invoice status, balances and aging', () => {
    const today = '2026-11-11';
    expect(invoiceStatus({ voided_at: 'x', due_date: today, total_cents: 1 }, 0, today)).toBe('void');
    expect(invoiceStatus({ voided_at: null, due_date: '2026-11-01', total_cents: 100 }, 100, today)).toBe('paid');
    expect(invoiceStatus({ voided_at: null, due_date: '2026-11-01', total_cents: 100 }, 50, today)).toBe('overdue');
    expect(invoiceStatus({ voided_at: null, due_date: today, total_cents: 100 }, 0, today)).toBe('due_today');
    expect([agingBucket('2026-11-20', today), agingBucket('2026-11-10', today), agingBucket('2026-09-12', today), agingBucket('2026-08-01', today)]).toEqual([0, 1, 2, 4]);
    const rows = withBalances([inv('a', '2026-11-20', 1000), inv('b', '2026-10-01', 500), inv('v', '2026-10-01', 900, { voided_at: 'x' })], [pay('b', 200)], today);
    expect(rows.map((r) => [r.balance, r.status])).toEqual([[1000, 'open'], [300, 'overdue'], [0, 'void']]);
    expect(aging(rows, today)).toEqual([1000, 0, 300, 0, 0]);
  });

  it('customer warnings: overdue, over limit, expired certificate, hold', () => {
    const today = '2026-11-11';
    const rows = withBalances([inv('a', '2026-10-01', 6000)], [], today);
    const s = standing({ id: 'c1', credit_limit_cents: 5000, cert_expiry: '2026-01-01', tax_exempt: true, on_hold: true }, rows, today);
    expect(s).toMatchObject({ balance: 6000, overdue: 6000, overLimit: true, certExpired: true });
    expect(s.warnings).toEqual(['On hold', 'Overdue invoices', 'Over credit limit', 'Resale certificate expired']);
    expect(standing({ id: 'c2', credit_limit_cents: null, cert_expiry: null, tax_exempt: false, on_hold: false }, rows, today).warnings).toEqual([]);
  });

  it('stock: committed by open orders, reorder in case packs, value at cost and price', () => {
    const held = committed([{ item_id: 'i', qty: 10 }, { item_id: 'i', qty: 4 }, { item_id: null, qty: 3 }]);
    expect(held.get('i')).toBe(14);
    const it = { id: 'i', qty: 20, case_pack: 12, reorder_at: 10, reorder_qty: 30, cost_cents: 250, price_cents: 450, is_active: true };
    expect(reorderSuggestion(it, 14)).toBe(36);
    expect(reorderSuggestion(it, 0)).toBeNull();
    expect(reorderSuggestion({ ...it, reorder_qty: null, case_pack: null }, 14)).toBe(4);
    expect(reorderSuggestion({ ...it, reorder_at: null }, 14)).toBeNull();
    expect(stockValue([it, { ...it, qty: -2 }, { ...it, is_active: false }])).toEqual({ cost: 5000, price: 9000 });
  });

  it('payment plans: grouped by due date, split so cents add up', () => {
    const today = '2026-11-11';
    const g = scheduleGroups([
      { id: '1', customer_id: 'c', due_date: '2026-11-01', amount_cents: 1, status: 'expected' },
      { id: '2', customer_id: 'c', due_date: '2026-11-15', amount_cents: 1, status: 'expected' },
      { id: '3', customer_id: 'c', due_date: '2026-12-15', amount_cents: 1, status: 'expected' },
      { id: '4', customer_id: 'c', due_date: '2026-11-15', amount_cents: 1, status: 'received' },
    ], today);
    expect([g.late, g.soon, g.later].map((x) => x.map((e) => e.id))).toEqual([['1'], ['2'], ['3']]);
    const plan = splitPlan(10000, 3, '2026-11-30', 14);
    expect(plan).toEqual([{ due_date: '2026-11-30', amount_cents: 3334 }, { due_date: '2026-12-14', amount_cents: 3333 }, { due_date: '2026-12-28', amount_cents: 3333 }]);
    expect(splitPlan(2, 3, today, 7)).toEqual([]);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});
