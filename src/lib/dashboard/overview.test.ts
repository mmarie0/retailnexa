import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT, cleanLayout, dailyAverage, editLayout, isDate, lastYearOf, pct, profitOf, projectMonth, rangeFor, salesByMonth, spendVsLastYear, trend12 } from './overview';

const today = '2026-11-11'; // a Wednesday

describe('date ranges', () => {
  it('presets', () => {
    expect(rangeFor('week', today)).toEqual({ key: 'week', from: '2026-11-08', to: today });
    expect(rangeFor('lweek', today)).toEqual({ key: 'lweek', from: '2026-11-01', to: '2026-11-07' });
    expect(rangeFor('30', today)).toEqual({ key: '30', from: '2026-10-13', to: today });
    expect(rangeFor('ytd', today)).toEqual({ key: 'ytd', from: '2026-01-01', to: today });
    expect(rangeFor('lyear', today)).toEqual({ key: 'lyear', from: '2025-01-01', to: '2025-12-31' });
    expect(rangeFor(undefined, today)).toBeNull();
    expect(rangeFor('nope', today)).toBeNull();
  });
  it('custom: swaps, ignores impossible dates, caps at about two years', () => {
    expect(rangeFor('custom', today, '2026-10-31', '2026-10-01')).toEqual({ key: 'custom', from: '2026-10-01', to: '2026-10-31' });
    expect(rangeFor('custom', today, '2026-02-30', 'x')).toEqual({ key: 'custom', from: '2026-10-13', to: today });
    expect(rangeFor('custom', today, '2020-01-01', '2026-01-01')!.from).toBe('2024-01-01');
    expect(isDate('2026-02-30')).toBe(false);
    expect(isDate('2028-02-29')).toBe(true);
  });
  it('last year: same weekdays up to ~2 months, calendar dates beyond', () => {
    expect(lastYearOf({ from: '2026-11-01', to: '2026-11-07' })).toEqual({ from: '2025-11-02', to: '2025-11-08', sameWeekdays: true });
    expect(lastYearOf({ from: '2028-01-01', to: '2028-02-29' })).toEqual({ from: '2027-01-02', to: '2027-03-02', sameWeekdays: true });
    expect(lastYearOf({ from: '2028-01-01', to: '2028-12-31' })).toEqual({ from: '2027-01-01', to: '2027-12-31', sameWeekdays: false });
  });
});

const roll = (loc: string, period: string, net: number, tax = 0, last_day = period) => ({ location_id: loc, period, net_cents: net, tax_cents: tax, days: 1, last_day });

describe('sales by month and projection', () => {
  it('a store’s monthly report replaces its daily roll-up', () => {
    const m = salesByMonth([roll('A', '2026-10-01', 1000, 70), roll('B', '2026-10-01', 500)], [{ location_id: 'A', month: '2026-10-01', sales_cents: 9000, tax_cents: 630 }]);
    expect(m.get('2026-10')).toEqual({ net: 9500, tax: 630, reported: true });
  });
  it('projects each store by its own last recorded day; reports are taken as-is', () => {
    // A: 10 days recorded, 30-day month → ×3. B: report.
    const p = projectMonth('2026-11', [roll('A', '2026-11-01', 10_000, 700, '2026-11-10'), roll('B', '2026-11-01', 99, 0, '2026-11-10')], [{ location_id: 'B', month: '2026-11-01', sales_cents: 50_000, tax_cents: 3500 }]);
    expect(p).toEqual({ net: 30_000 + 50_000, tax: 2100 + 3500, reported: true });
    expect(projectMonth('2026-11', [], [])).toBeNull();
  });
  it('daily average counts shared calendar days once', () => {
    const r = [{ ...roll('A', '2026-10-01', 3000), days: 10 }, { ...roll('B', '2026-10-01', 1000), days: 8 }, { ...roll('A', '2026-11-01', 600), days: 2 }];
    expect(dailyAverage(r)).toEqual({ cents: Math.round(4600 / 12), days: 12 });
    expect(dailyAverage([])).toEqual({ cents: null, days: 0 });
  });
  it('profit = sales + tax − bills − payroll', () => {
    expect(profitOf({ net: 80_000, tax: 5_600 }, 40_000, 20_000)).toBe(25_600);
    expect(profitOf(null, 1, 1)).toBeNull();
  });
  it('12-month trend with last year and the projected month', () => {
    const months = new Map([['2025-11', { net: 70, tax: 0, reported: false }], ['2026-10', { net: 90, tax: 0, reported: false }], ['2026-11', { net: 30, tax: 0, reported: false }]]);
    const t = trend12('2026-11', months, { net: 100, tax: 0, reported: false });
    expect(t).toHaveLength(12);
    expect(t[0].ym).toBe('2025-12');
    expect(t[10]).toEqual({ ym: '2026-10', cents: 90, lastYearCents: null, projected: false });
    expect(t[11]).toEqual({ ym: '2026-11', cents: 100, lastYearCents: 70, projected: true });
  });
  it('spend vs last year', () => {
    const by = new Map([['2026-01', 100], ['2026-02', 200], ['2025-01', 50], ['2025-02', 50], ['2025-03', 400]]);
    expect(spendVsLastYear('2026-03', by, 300)).toEqual({ month: 300, lastYearMonth: 400, ytd: 600, lastYtd: 500 });
    expect(pct(600, 500)).toBe(20);
    expect(pct(1, 0)).toBeNull();
  });
});

describe('layout', () => {
  it('cleans saved layouts', () => {
    expect(cleanLayout(null)).toEqual(DEFAULT_LAYOUT);
    expect(cleanLayout(['trend', 'cash', 'trend', 'quick'])).toEqual(['trend', 'quick']);
    expect(cleanLayout([])).toEqual([]);
  });
  it('edits', () => {
    const l = cleanLayout(['quick', 'sales', 'bills']);
    expect(editLayout(l, 'up', 'sales')).toEqual(['sales', 'quick', 'bills']);
    expect(editLayout(l, 'up', 'quick')).toBe(l);
    expect(editLayout(l, 'down', 'bills')).toBe(l);
    expect(editLayout(l, 'remove', 'sales')).toEqual(['quick', 'bills']);
    expect(editLayout(l, 'add', 'trend')).toEqual(['quick', 'sales', 'bills', 'trend']);
    expect(editLayout(l, 'add', 'cashOut')).toBe(l);
  });
});
