import { describe, expect, it } from 'vitest';
import { yearEndSheets, yearEndXlsx } from './year-end';

const input = {
  year: 2026, businessName: 'Test Co',
  months: [{ ym: '2026-01', sales: 100000, tax: 7000, cash: 40000, card: 67000, points: 0, bills: 50000, payroll: 20000, balancesIn: 1000, balancesOut: 0, profit: 38000, manual: false }],
  bills: [
    { vendor: 'Outre', bill_number: '1', bill_date: '2026-01-02', due_date: '2026-01-20', status: 'approved', total_cents: 30000, paid_cents: 30000 },
    { vendor: 'Outre', bill_number: '2', bill_date: '2026-02-02', due_date: '2026-02-20', status: 'approved', total_cents: 5000, paid_cents: 0 },
    { vendor: 'Power', bill_number: '9', bill_date: '2026-01-02', due_date: '2026-01-15', status: 'void', total_cents: 999, paid_cents: 0 },
  ],
  payLines: [{ employee: 'Ana', pay_date: '2026-01-09', hours: 40, overtime_hours: 2, gross_cents: 64000, bonus_cents: 1000, employer_tax_cents: 4896, advance_cents: 500, net_cents: 63500 }],
  runs: [{ pay_date: '2026-01-09', period_start: '2026-01-01', period_end: '2026-01-07', gross_cents: 64000, employer_tax_cents: 4896, net_cents: 63500, voided: false }],
  days: [{ date: '2026-01-02', store: 'Main', register: 'Reg 1', net_cents: 1000, tax_cents: 70, cash_cents: 500, card_cents: 570, transactions: 4 }],
  partners: [{ name: 'A', pct: 60, distributed_cents: 10000, paid_cents: 10000 }, { name: 'B', pct: 40, distributed_cents: 0, paid_cents: 0 }],
  bankByMonth: [{ ym: '2026-01', out_cents: 70000, in_cents: 100000 }],
};

describe('year-end report (#111)', () => {
  it('builds every sheet the owner’s report has', () => {
    const s = yearEndSheets(input);
    expect(s.map((x) => x.name)).toEqual(['Summary', 'Sales tax', 'Expenses by vendor', 'All bills', 'Payroll by employee', 'Pay runs', 'Daily sales', 'Partner split', 'Bank spending']);
    const vend = s.find((x) => x.name === 'Expenses by vendor')!;
    expect(vend.rows).toEqual([expect.objectContaining({ v: 'Outre', total: 35000, '2026-01': 30000, '2026-02': 5000 })]);
    expect(s.find((x) => x.name === 'All bills')!.rows.map((r) => [r.n, r.amt, r.left])).toEqual([['9', 0, 0], ['1', 30000, 0], ['2', 5000, 5000]]);
    expect(s.find((x) => x.name === 'Partner split')!.rows.map((r) => r.of)).toEqual([22800, 15200]);
    expect(s.find((x) => x.name === 'Payroll by employee')!.rows[0]).toMatchObject({ e: 'Ana', cost: 68896 });
  });
  it('sheets the person can’t see are left out', () => {
    expect(yearEndSheets({ year: 2026, businessName: 'x', days: [] }).map((x) => x.name)).toEqual(['Daily sales']);
  });
  it('writes a real workbook with dollars, totals, and text kept as text', async () => {
    const sheets = yearEndSheets({ ...input, bills: [{ ...input.bills[0], vendor: '=HYPERLINK("x")' }] });
    const buf = await yearEndXlsx('Test Co 2026', sheets);
    const { Workbook } = await import('exceljs');
    const wb = new Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toContain('Summary');
    const sum = wb.getWorksheet('Summary')!;
    expect(sum.getRow(3).getCell(2).value).toBe(1000);
    expect(sum.getRow(4).getCell(1).value).toBe('Total');
    const bills = wb.getWorksheet('All bills')!;
    expect(bills.getRow(3).getCell(1).value).toBe('=HYPERLINK("x")'); // stored as a string, never a formula
    expect(typeof bills.getRow(3).getCell(1).value).toBe('string');
  });
});
