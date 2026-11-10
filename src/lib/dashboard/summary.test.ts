import { describe, expect, it } from 'vitest';
import { salesWindows, summarizeBills, summarizeSales } from './summary';

const d = (date: string, net: number, tx: number | null = null) => ({ date, netCents: net, transactions: tx });

describe('summarizeSales', () => {
  const today = '2026-11-10';
  const days = [
    d('2026-11-10', 1_000, 10), d('2026-11-10', 500, 5), // two registers today
    d('2026-11-09', 2_000, 20),
    d('2026-11-01', 3_000, 30),
    d('2026-10-31', 9_999, 1), // previous month, inside the 14-day window
    d('2026-11-02', 700), // comparable for 2025? no — last year rows below
    d('2025-11-02', 4_000), // comparable of 2026-11-01 (364 days earlier)
    d('2025-11-11', 1_000), // comparable of 2026-11-10
  ];
  const s = summarizeSales(days, today);

  it('totals today and yesterday across registers; null when nothing recorded', () => {
    expect(s.today.netCents).toBe(1_500);
    expect(s.yesterday.netCents).toBe(2_000);
    expect(summarizeSales([], today).today.netCents).toBeNull();
  });

  it('month to date excludes last month and compares with the same weekdays last year', () => {
    expect(s.monthToDate.netCents).toBe(1_500 + 2_000 + 3_000 + 700);
    expect(s.monthToDate.lastYearCents).toBe(5_000);
    expect(s.monthToDate.changePct).toBe(44);
    expect(s.monthToDate.avgTicketCents).toBe(Math.round(7_200 / 65));
  });

  it('daily series is 14 days, oldest first, null for missing days', () => {
    expect(s.daily).toHaveLength(14);
    expect(s.daily[0].date).toBe('2026-10-28');
    expect(s.daily[13]).toEqual({ date: today, netCents: 1_500 });
    expect(s.daily.find((x) => x.date === '2026-10-31')?.netCents).toBe(9_999);
    expect(s.daily.find((x) => x.date === '2026-11-05')?.netCents).toBeNull();
  });

  it('week-over-week change is null when the prior week has no sales', () => {
    expect(s.last7.netCents).toBe(1_500 + 2_000);
    expect(summarizeSales([d('2026-11-10', 100)], today).last7.changePct).toBeNull();
  });
});

describe('salesWindows', () => {
  it('covers the month and the last 14 days, plus last year’s comparable month to date', () => {
    expect(salesWindows('2026-11-20')).toEqual({ recent: { from: '2026-11-01', to: '2026-11-20' }, lastYear: { from: '2025-11-02', to: '2025-11-21' } });
    expect(salesWindows('2026-11-03').recent.from).toBe('2026-10-21');
  });
});

describe('summarizeBills', () => {
  it('splits unpaid into overdue and due within a week; drafts counted separately', () => {
    const r = summarizeBills([
      { status: 'approved', dueDate: '2026-11-01', openCents: 100 },
      { status: 'approved', dueDate: '2026-11-15', openCents: 200 },
      { status: 'approved', dueDate: '2026-12-30', openCents: 400 },
      { status: 'draft', dueDate: '2026-11-01', openCents: 999 },
      { status: 'paid', dueDate: '2026-11-01', openCents: 0 },
    ], '2026-11-10');
    expect(r).toEqual({ unpaidCents: 700, overdueCents: 100, overdueCount: 1, dueNext7Cents: 200, drafts: 1 });
  });
});
