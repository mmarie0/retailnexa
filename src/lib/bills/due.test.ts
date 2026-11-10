import { describe, expect, it } from 'vitest';
import { budgetFor, dotFor, forecast, kindOf, monthItems, nextOccurrence, repSchedule, suggestRecurring, totals, ymAdd, type BillRow, type TemplateRow } from './due';

const names = new Map([['v1', 'Beauty Wholesale'], ['v2', 'City Power & Light'], ['v3', 'Landlord LLC']]);
const bill = (o: Partial<BillRow>): BillRow => ({
  id: 'b', vendor_id: 'v1', bill_number: '100', bill_date: '2026-11-01', due_date: '2026-11-15',
  status: 'approved', total_cents: 10000, paid_cents: 0, recurring_bill_id: null, ...o,
});
const tpl = (o: Partial<TemplateRow>): TemplateRow => ({
  id: 't1', vendor_id: 'v3', name: 'Rent', frequency: 'monthly', day_of_month: 1, next_date: '2026-12-01',
  end_date: null, due_days: 0, is_active: true, amount_cents: 250000, ...o,
});

describe('dates', () => {
  it('steps months and clamps the day like the database', () => {
    expect(ymAdd('2026-11', 2)).toBe('2027-01');
    expect(ymAdd('2026-01', -1)).toBe('2025-12');
    expect(nextOccurrence('2026-01-31', 'monthly', 31)).toBe('2026-02-28');
    expect(nextOccurrence('2026-02-28', 'monthly', 31)).toBe('2026-03-31');
    expect(nextOccurrence('2026-11-03', 'weekly', null)).toBe('2026-11-10');
    expect(nextOccurrence('2026-11-15', 'quarterly', 15)).toBe('2027-02-15');
  });
  it('colours dots by how close the due date is', () => {
    expect(dotFor('2026-11-09', 100, '2026-11-10')).toBe('late');
    expect(dotFor('2026-11-17', 100, '2026-11-10')).toBe('soon');
    expect(dotFor('2026-11-18', 100, '2026-11-10')).toBe('upcoming');
    expect(dotFor('2026-11-01', 0, '2026-11-10')).toBe('paid');
  });
});

describe('kindOf', () => {
  it('splits orders from fixed bills', () => {
    expect(kindOf('Beauty Wholesale', false)).toBe('order');
    expect(kindOf('City Power & Light', false)).toBe('bill');
    expect(kindOf('Anything', true)).toBe('bill');
    // The vendor's own setting wins (#136): "Acme Supply" sends a monthly service bill.
    expect(kindOf('Acme Supply', false, 'bill')).toBe('bill');
    expect(kindOf('City Power & Light', false, 'order')).toBe('order');
  });
});

describe('monthItems', () => {
  const today = '2026-11-10';
  it('lists the month’s bills, skips void and other months, and projects recurring bills', () => {
    const bills = [
      bill({ id: 'a', due_date: '2026-11-05', paid_cents: 10000, status: 'paid' }),
      bill({ id: 'b', due_date: '2026-11-20', status: 'draft' }),
      bill({ id: 'c', due_date: '2026-11-21', status: 'void' }),
      bill({ id: 'd', due_date: '2026-12-02' }),
    ];
    const items = monthItems('2026-11', bills, [tpl({ next_date: '2026-11-25' })], names, today);
    expect(items.map((i) => [i.id, i.stage, i.kind])).toEqual([
      ['a', 'paid', 'order'], ['b', 'draft', 'order'], ['tpl:t1:2026-11-25', 'scheduled', 'bill'],
    ]);
    expect(totals(items)).toEqual({ total: 270000, paid: 10000, left: 260000, late: 0, count: 3 });
  });

  it('projects weekly templates, honours due days and the end date, and never double-counts created bills', () => {
    const weekly = tpl({ id: 'w', frequency: 'weekly', day_of_month: null, next_date: '2026-11-03', due_days: 2, end_date: '2026-11-20', amount_cents: 500 });
    const items = monthItems('2026-11', [], [weekly], names, today);
    expect(items.map((i) => i.dueDate)).toEqual(['2026-11-05', '2026-11-12', '2026-11-19']);
    // A template whose next date is past this month adds nothing here (its earlier bills already exist).
    expect(monthItems('2026-11', [], [tpl({ next_date: '2026-12-01' })], names, today)).toEqual([]);
    expect(monthItems('2026-11', [], [tpl({ next_date: '2026-11-01', is_active: false })], names, today)).toEqual([]);
  });
});

describe('budgets and forecast', () => {
  const budgets = [{ month: null, amount_cents: 300000 }, { month: '2026-12-01', amount_cents: 400000 }];
  it('uses the month’s own budget, else the default', () => {
    expect(budgetFor('2026-12', budgets)).toEqual({ cents: 400000, own: true });
    expect(budgetFor('2027-01', budgets)).toEqual({ cents: 300000, own: false });
    expect(budgetFor('2027-01', [])).toBeNull();
  });
  it('forecasts six months of bills against the budget', () => {
    const fc = forecast('2026-11', 6, [bill({})], [tpl({ next_date: '2026-12-01' })], names, budgets, '2026-11-10');
    expect(fc.map((f) => f.ym)).toEqual(['2026-11', '2026-12', '2027-01', '2027-02', '2027-03', '2027-04']);
    expect(fc[0]).toEqual({ ym: '2026-11', total: 10000, left: 10000, budget: 300000 });
    expect(fc[1]).toEqual({ ym: '2026-12', total: 250000, left: 250000, budget: 400000 });
  });
});

describe('repSchedule', () => {
  it('finds the usual weekday and frequency from invoice dates', () => {
    // Tuesdays two weeks apart, plus a recurring bill and a one-off vendor that are ignored.
    const bills = ['2026-09-01', '2026-09-15', '2026-09-29', '2026-10-13', '2026-10-27'].map((d) => ({ vendor_id: 'v1', bill_date: d, status: 'approved' as const, recurring_bill_id: null }));
    bills.push({ vendor_id: 'v3', bill_date: '2026-10-01', status: 'approved', recurring_bill_id: 't1' as never });
    bills.push({ vendor_id: 'v2', bill_date: '2026-10-01', status: 'approved', recurring_bill_id: null });
    const [r, ...rest] = repSchedule(bills, names, '2026-11-01');
    expect(rest).toEqual([]);
    expect(r).toMatchObject({ vendorId: 'v1', name: 'Beauty Wholesale', visits: 5, days: [2], freq: 'Every 2 weeks', last: '2026-10-27', next: '2026-11-10' });
  });
});

describe('suggestRecurring', () => {
  it('suggests withdrawals that repeat in 3+ months, skipping ones already set up', () => {
    const l = (d: string, desc: string, c: number) => ({ posted_on: d, description: desc, amount_cents: c });
    const lines = [
      l('2026-08-03', 'ACH COMCAST 8812', -12000), l('2026-09-03', 'ACH COMCAST 9921', -12000), l('2026-10-04', 'ACH COMCAST 1102', -13500),
      l('2026-08-01', 'RENT PAYMENT', -250000), l('2026-09-01', 'RENT PAYMENT', -250000), l('2026-10-01', 'RENT PAYMENT', -250000),
      l('2026-08-05', 'DEPOSIT', 50000), l('2026-09-05', 'DEPOSIT', 50000), l('2026-10-05', 'DEPOSIT', 50000),
      l('2026-10-07', 'ONE OFF STORE', -900),
    ];
    const s = suggestRecurring(lines, ['Rent payment']);
    expect(s).toEqual([{ label: 'ACH COMCAST 8812', months: 3, avgCents: 12500, day: 3 }]);
  });
});

describe('icsCalendar (#107 vendor calendar)', () => {
  it('writes one all-day event per item, escaped and folded', async () => {
    const { icsCalendar } = await import('./ics');
    const items = monthItems('2026-11', [bill({ id: 'b1', due_date: '2026-11-30' })], [tpl({ next_date: '2026-11-25', name: 'Rent, main; store' })], names, '2026-11-10');
    const ics = icsCalendar('JLO bills', items, new Date('2026-11-10T12:00:00Z'));
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics).toContain('DTSTART;VALUE=DATE:20261130\r\nDTEND;VALUE=DATE:20261201');
    expect(ics).toContain('SUMMARY:Rent\\, main\; store · $2\\,500.00 due');
    expect(ics).toContain('UID:tpl:t1:2026-11-25@retailnexa');
    expect(ics.split('\r\n').every((l) => Buffer.byteLength(l) <= 75)).toBe(true);
  });
});
