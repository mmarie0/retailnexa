import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RULES, dayHours, indexShifts, laborDay, laborMonth, payPeriod, periodLines, shiftHours, t12, weekStart, weeklyCost,
  type Employee, type Pay, type Shift,
} from './payroll';

const nine5 = { in: '09:00', out: '17:00', lunch: 30 };
const emp = (o: Partial<Employee> = {}): Employee => ({ id: 'e1', name: 'Ana', role_title: null, location_id: null, start_date: null, end_date: null, is_active: true,
  regular: [null, nine5, nine5, nine5, nine5, nine5, null], ...o });
const pay = (o: Partial<Pay> = {}): Pay => ({ employee_id: 'e1', pay_type: 'hourly', rate_cents: 1500, weekly_hours: null, burden_pct: 10, tax_type: 'w2', pay_method: 'cash', ...o });
const shift = (d: string, o: Partial<Shift> = {}): Shift => ({ employee_id: 'e1', work_date: d, off: false, start_time: '10:00:00', end_time: '14:00:00', lunch_min: 0, actual_in: null, actual_out: null, ...o });
const unpaid = { ...DEFAULT_RULES, paid_lunch: false };

describe('hours', () => {
  it('shift hours: overnight wraps, unpaid lunch comes out', () => {
    expect(shiftHours(nine5, true)).toBe(8);
    expect(shiftHours(nine5, false)).toBe(7.5);
    expect(shiftHours({ in: '22:00', out: '02:00' }, true)).toBe(4);
    expect(shiftHours(null, true)).toBe(0);
  });
  it('a week’s own shift beats the regular schedule; a day off is zero; clock times win; inactive is zero', () => {
    const idx = indexShifts([shift('2026-11-10'), shift('2026-11-11', { off: true }), shift('2026-11-12', { actual_in: '09:30', actual_out: '12:00' })]);
    expect(dayHours(emp(), pay(), '2026-11-09', idx, unpaid)).toBe(7.5); // Monday, regular
    expect(dayHours(emp(), pay(), '2026-11-10', idx, unpaid)).toBe(4);
    expect(dayHours(emp(), pay(), '2026-11-11', idx, unpaid)).toBe(0);
    expect(dayHours(emp(), pay(), '2026-11-12', idx, unpaid)).toBe(2.5);
    expect(dayHours(emp(), pay(), '2026-11-08', idx, unpaid)).toBe(0); // Sunday off
    expect(dayHours(emp({ end_date: '2026-11-01', is_active: false }), pay(), '2026-11-09', idx, unpaid)).toBe(0);
    expect(dayHours(emp({ regular: null }), pay({ weekly_hours: 35 }), '2026-11-09', new Map(), unpaid)).toBe(5);
  });
});

describe('costs', () => {
  it('weekly cost includes employer taxes; salary is 1/52', () => {
    expect(weeklyCost(emp(), pay(), DEFAULT_RULES)).toBe(Math.round(40 * 1500 * 1.1));
    expect(weeklyCost(emp(), pay({ pay_type: 'salary', rate_cents: 5_200_000, burden_pct: 0 }), DEFAULT_RULES)).toBe(100_000);
  });
  it('labor day and labor month against sales', () => {
    const pays = new Map([['e1', pay()]]);
    const d = laborDay('2026-11-09', [emp()], pays, new Map(), DEFAULT_RULES);
    expect(d).toMatchObject({ hours: 8, costCents: 13200 });
    const sales = new Map([['2026-11-02', 100_000], ['2026-11-09', 132_000]]);
    const m = laborMonth('2026-11', '2026-11-10', sales, [emp()], pays, new Map(), DEFAULT_RULES);
    expect(m.days).toHaveLength(10);
    expect(m.n).toBe(2);
    expect(m.costCents).toBe(26400);
    expect(m.pct).toBeCloseTo((26400 / 232_000) * 100, 5);
    expect(m.weekdays[1]).toMatchObject({ n: 2, hours: 8 });
  });
});

describe('pay runs', () => {
  it('suggests lines with weekly overtime and employer tax; salary is per day', () => {
    const long = emp({ regular: [null, { in: '08:00', out: '18:00' }, { in: '08:00', out: '18:00' }, { in: '08:00', out: '18:00' }, { in: '08:00', out: '18:00' }, { in: '08:00', out: '18:00' }, null] });
    const rules = { ...DEFAULT_RULES, overtime: true };
    const lines = periodLines('2026-11-08', '2026-11-14', [long, emp({ id: 'e2', name: 'Ben', regular: null })],
      new Map([['e1', pay()], ['e2', pay({ employee_id: 'e2', pay_type: 'salary', rate_cents: 3_650_000, burden_pct: 8 })]]), new Map(), rules);
    expect(lines.map((l) => [l.name, l.hours, l.overtime_hours, l.regular_cents, l.overtime_cents, l.employer_tax_cents])).toEqual([
      ['Ana', 50, 10, 60_000, 22_500, 8_250],
      ['Ben', 0, 0, 70_000, 0, 5_600],
    ]);
  });
  it('pay periods: weekly or every 2 weeks from the chosen weekday', () => {
    expect(weekStart('2026-11-10', 0)).toBe('2026-11-08');
    expect(weekStart('2026-11-10', 1)).toBe('2026-11-09');
    expect(payPeriod('2026-11-10', DEFAULT_RULES)).toEqual({ start: '2026-11-08', end: '2026-11-14' });
    const two = payPeriod('2026-11-10', { ...DEFAULT_RULES, pay_every_weeks: 2 });
    expect(two.end).toBe(new Date(Date.parse(`${two.start}T00:00:00Z`) + 13 * 86_400_000).toISOString().slice(0, 10));
    expect(two.start <= '2026-11-10' && two.end >= '2026-11-10').toBe(true);
  });
  it('12-hour labels', () => {
    expect([t12('09:00'), t12('17:30'), t12('00:00'), t12('12:00')]).toEqual(['9a', '5:30p', '12a', '12p']);
  });
});
