import { describe, expect, it } from 'vitest';
import { averageTicketCents, comparableDate, computeProfit, pctChange, projectMonthEnd, type DailySale } from './finance/metrics';
import { stepQuantity, validateQuantity, assertValidRule } from './wholesale/quantity';

describe('computeProfit', () => {
  it('separates gross, operating and net profit', () => {
    const r = computeProfit({
      netSalesCents: 100_000, cogsCents: 55_000,
      operatingExpensesCents: { payroll: 15_000, rent: 8_000, utilities: 1_000, cardFees: 2_000, other: 1_000 },
      otherIncomeCents: 500, otherExpensesCents: 0, interestCents: 300, taxesCents: 4_000,
    });
    expect(r.grossProfitCents).toBe(45_000);
    expect(r.grossMarginPct).toBe(45);
    expect(r.operatingProfitCents).toBe(18_000);
    expect(r.netIncomeCents).toBe(14_200);
    expect(r.netIncomeComplete).toBe(true);
  });
  it('never claims complete net income when only payroll is known', () => {
    const r = computeProfit({ netSalesCents: 100_000, cogsCents: 55_000, operatingExpensesCents: { payroll: 15_000 } });
    expect(r.netIncomeComplete).toBe(false);
    expect(r.missing).toContain('operating expense: rent');
    expect(r.missing).toContain('taxes');
  });
});

describe('sales comparisons', () => {
  it('compares to the same weekday last year', () => {
    expect(comparableDate('2026-11-09')).toBe('2025-11-10');
    expect(new Date('2026-11-09').getUTCDay()).toBe(new Date('2025-11-10').getUTCDay());
  });
  it('handles zero baselines and empty tickets', () => {
    expect(pctChange(100, 0)).toBeNull();
    expect(pctChange(110, 100)).toBe(10);
    expect(averageTicketCents(1000, 0)).toBeNull();
  });
  it('projects month-end from weekday averages, and refuses with too little data', () => {
    const days: DailySale[] = [];
    for (let d = 1; d <= 10; d++) days.push({ date: `2026-11-${String(d).padStart(2, '0')}`, salesCents: 100_00, transactions: 10 });
    const p = projectMonthEnd(days, '2026-11-10');
    expect(p).toEqual({ projectedCents: 30 * 100_00, basisDays: 10 });
    expect(projectMonthEnd(days.slice(0, 5), '2026-11-05')).toBeNull();
  });
});

describe('wholesale quantity rules', () => {
  it('defaults to minimum 6 in steps of 6', () => {
    expect(validateQuantity(6)).toEqual({ ok: true });
    expect(validateQuantity(4)).toMatchObject({ ok: false, suggestion: 6 });
    expect(validateQuantity(13)).toMatchObject({ ok: false, suggestion: 18 });
    expect(validateQuantity(0)).toEqual({ ok: true });
    expect(validateQuantity(2.5)).toMatchObject({ ok: false });
  });
  it('supports 12/24/48 case packs and maximums', () => {
    const rule = { min: 24, increment: 24, max: 96 };
    expect(validateQuantity(48, rule)).toEqual({ ok: true });
    expect(validateQuantity(120, rule)).toMatchObject({ ok: false, suggestion: 96 });
    expect(stepQuantity(0, 1, rule)).toBe(24);
    expect(stepQuantity(96, 1, rule)).toBe(96);
    expect(stepQuantity(24, -1, rule)).toBe(0);
    expect(stepQuantity(30, -1, { min: 6, increment: 6 })).toBe(24);
  });
  it('rejects inconsistent rules', () => {
    expect(() => assertValidRule({ min: 10, increment: 6 })).toThrow();
    expect(() => assertValidRule({ min: 0, increment: 6 })).toThrow();
  });
});
