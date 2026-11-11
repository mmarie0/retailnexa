import { describe, expect, it } from 'vitest';
import { avgSale, compareCategories, monthTotals, parseCategorySheet, parseMonth, parseMonthSheet, share } from './history';

const day = (d: string, loc = 'A', o: Partial<Record<string, number | null>> = {}) => ({
  business_date: d, location_id: loc, gross_sales_cents: 10000, discounts_cents: 500, sales_tax_cents: 700, cash_cents: 4000, card_cents: 6200,
  customer_credit_cents: 0, transaction_count: 20, ...o,
}) as never;

describe('monthTotals', () => {
  it('rolls days up by month; a store’s uploaded report replaces its daily roll-up for that month', () => {
    const days = [day('2026-10-01'), day('2026-10-02', 'A', { transaction_count: null }), day('2026-10-01', 'B'), day('2026-09-30')];
    const reports = [{ location_id: 'B', month: '2026-10-01', sales_cents: 50000, gross_cents: null, tax_cents: 3500, cash_cents: 20000, card_cents: 33500, store_card_cents: 0, points_cents: 1000, transactions: 90 }];
    const [oct, sep] = monthTotals(days, reports);
    expect(oct).toMatchObject({ ym: '2026-10', sales: 9500 * 2 + 50000, gross: 20000 + 51000, transactions: 20 + 90, source: 'mixed', points: 1000 + 1000 });
    expect(sep).toMatchObject({ ym: '2026-09', sales: 9500, transactions: 20, source: 'daily', days: 1 });
    expect(avgSale(oct)).toBe(Math.round(69000 / 110));
    expect(share(4000, 10000)).toBe(40);
  });
});

describe('sheets', () => {
  it('months in many spellings', () => {
    expect(['2026-10', '10/2026', 'Oct 2026', 'October 2026', '10/15/2026', 'Sept 2026'].map(parseMonth)).toEqual(['2026-10', '2026-10', '2026-10', '2026-10', '2026-10', '2026-09']);
    expect(parseMonth('13/2026')).toBeNull();
  });
  it('monthly report sheet', () => {
    const { rows, errors } = parseMonthSheet([
      ['Month', 'Sales', 'Tax', 'Cash', 'Card', 'Store card', 'Points', 'Transactions'],
      ['Oct 2026', '$70,000.00', '4,900', '30000', '44900', '0', '12', '2,140'],
      ['2099-01', '1', '', '', '', '', '', ''],
      ['Sep 2026', 'abc', '', '', '', '', '', ''],
    ], '2026-11-10');
    expect(rows).toEqual([{ month: '2026-10', sales_cents: 7_000_000, gross_cents: null, tax_cents: 490_000, cash_cents: 3_000_000, card_cents: 4_490_000, store_card_cents: 0, points_cents: 1200, transactions: 2140 }]);
    expect(errors.map((e) => e.line)).toEqual([3, 4]);
  });
  it('category sheet skips totals; compare with last month and last year', () => {
    const { rows } = parseCategorySheet([['Department', 'Net Sales', 'Qty'], ['Wigs', '1,000.00', '10'], ['Braiding hair', '500', ''], ['Total', '1500', '']]);
    expect(rows).toEqual([{ category: 'Wigs', sales_cents: 100000, quantity: 10 }, { category: 'Braiding hair', sales_cents: 50000, quantity: null }]);
    const cmp = compareCategories(rows, [{ category: 'wigs', sales_cents: 80000, quantity: null }], [{ category: 'Lace fronts', sales_cents: 9000, quantity: null }]);
    expect(cmp.map((c) => [c.category, c.cents, c.vsPrevPct, c.lastYearCents])).toEqual([
      ['Wigs', 100000, 25, null], ['Braiding hair', 50000, null, null], ['Lace fronts', 0, null, 9000],
    ]);
    expect(cmp[0].sharePct).toBeCloseTo(66.666, 2);
  });
});
