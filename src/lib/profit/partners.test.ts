import { describe, expect, it } from 'vitest';
import { cashYouCanTake, monthProfit, parseProfitSheet, splitByPct, yearSummary } from './partners';

describe('profit', () => {
  const parts = { sales: 80_000_00, tax: 5_600_00, bills: 40_000_00, payroll: 20_000_00, balancesIn: 1_000_00, balancesOut: 600_00 };
  it('formula, manual wins, no sales → no profit', () => {
    expect(monthProfit('2026-10', parts).profit).toBe(26_000_00);
    expect(monthProfit('2026-10', parts, { profit_cents: 1, note: 'CPA' })).toMatchObject({ formula: 26_000_00, manual: 1, profit: 1, note: 'CPA' });
    expect(monthProfit('2026-10', { ...parts, sales: null }).profit).toBeNull();
  });
  it('year summary', () => {
    const ms = [monthProfit('2026-01', parts), monthProfit('2026-02', { ...parts, sales: null })];
    expect(yearSummary(ms)).toEqual({ total: 26_000_00, months: 1, average: 26_000_00, sales: 80_000_00, margin: 32.5 });
  });
  it('split matches the database rounding', () => {
    const p = [{ id: 'a', name: 'A', pct: 33.33 }, { id: 'b', name: 'B', pct: 33.33 }, { id: 'c', name: 'C', pct: 33.34 }];
    expect(splitByPct(10000, p).map((x) => x.share)).toEqual([3333, 3333, 3334]);
    expect(splitByPct(1, p).map((x) => x.share)).toEqual([0, 0, 1]);
    expect(splitByPct(2, p).map((x) => x.share)).toEqual([1, 0, 1]);
  });
  it('cash you can take', () => {
    expect(cashYouCanTake({ safe: 10_000_00, bank: 60_000_00, reserve: 50_000_00, nextMonthEarlyBills: 30_000_00, unpaidThisMonth: 5_000_00, unrunPayroll: 3_000_00, owedToStores: 1_000_00 }))
      .toEqual({ cash: 70_000_00, hold: 50_000_00, take: 11_000_00, short: 0 });
    expect(cashYouCanTake({ safe: 0, bank: 1, reserve: 5, nextMonthEarlyBills: 0, unpaidThisMonth: 0, unrunPayroll: 0, owedToStores: 0 })).toMatchObject({ take: 0, short: 4 });
  });
  it('bulk profit import', () => {
    const { rows, errors } = parseProfitSheet([['Month', 'Net Profit', 'Note'], ['Oct 2026', '$12,000.50', 'CPA'], ['2026-09', '(500)', ''], ['2099-01', '1', ''], ['Oct 2026', '1', ''], ['2026-08', 'abc', '']], '2026-11-11');
    expect(rows).toEqual([{ month: '2026-10-01', profit_cents: 1_200_050, note: 'CPA' }, { month: '2026-09-01', profit_cents: -50_000, note: null }]);
    expect(errors.map((e) => e.line)).toEqual([4, 5, 6]);
  });
});
