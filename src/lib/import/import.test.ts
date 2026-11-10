import { describe, expect, it } from 'vitest';
import { accountRoleFor, nextOnDay, planFromBackup } from './backup';
import { planFromSheet } from './sheet';

const today = '2026-11-10';

describe('old RetailNexa backup → import rows', () => {
  const backup = {
    vendors: [{ id: 'v_beesale', data: { name: 'BEESALE', terms: null, payMethod: 'Check', notes: null } }],
    bills: [
      { id: 'b1', data: { company: 'HAIR ZONE', amount: 1934, dueDate: '2025-07-29', invoiceDate: '2025-07-29', paid: true, paidDate: '2025-07-29', payments: [{ amount: 1934, date: '2025-07-29', method: 'ACH' }] } },
      { id: 'b2', company: 'TECO', amount: 160.5, dueDate: '2026-11-20', paid: false },
      { id: 'b3', company: 'Refund Co', amount: -20, dueDate: '2026-11-01' },
      { id: 'b4', company: 'Cash Vendor', amount: 50, dueDate: '2026-10-01', paid: true, payments: [{ amount: 60, date: '2026-10-01', method: 'Cash' }] },
    ],
    fixed: [{ id: 'f1', data: { name: 'TECO', amount: 1600, day: 8, active: true, startMonth: '2026-10' } }, { id: 'f2', name: 'Old rent', amount: 100, day: 1, endMonth: '2026-01' }],
    sales: [
      { id: '2026-10-01', data: { date: '2026-10-01', sales: 1000, tax: 75, cash: 500, card: 575 } },
      { id: '2024-02-01', data: { date: '2024-02-01', cash: 540, card: 0, gross: 0, sales: 0, tax: 0 } },
      { id: '2024-02-03', data: { date: '2024-02-03', cash: 0, card: 0, gross: 0, sales: 0, tax: 0 } },
      { id: '2026-12-01', data: { date: '2026-12-01', sales: 5, cash: 5 } },
    ],
    months: [{ id: '2024-01' }], employees: [{ id: 'e1' }, { id: 'e2' }],
  };
  const plan = planFromBackup(backup, { today });

  it('maps vendors, bills and payments (in cents, never overpaid)', () => {
    expect(plan.rows.vendor[0]).toMatchObject({ name: 'BEESALE', notes: 'Pays by Check' });
    expect(plan.rows.bill).toHaveLength(3);
    expect(plan.rows.bill[0]).toMatchObject({ key: 'b1', vendor: 'HAIR ZONE', amount_cents: 193400, account_role: 'inventory', payments: [{ amount_cents: 193400, source: 'bank' }] });
    expect(plan.rows.bill[1]).toMatchObject({ vendor: 'TECO', amount_cents: 16050, account_role: 'utilities', payments: [] });
    expect(plan.rows.bill[2].payments).toEqual([{ date: '2026-10-01', amount_cents: 5000, source: 'cash_on_hand', reference: 'Cash' }]);
    expect(plan.warnings.join(' ')).toMatch(/1 credit/);
  });

  it('turns fixed costs into recurring bills from today on, skipping ended ones', () => {
    expect(plan.rows.recurring).toEqual([expect.objectContaining({ name: 'TECO', amount_cents: 160000, day_of_month: 8, next_date: '2026-12-08', account_role: 'utilities' })]);
  });

  it('balances sales days the ledger way and skips empty and future days', () => {
    expect(plan.rows.sales_day).toEqual([
      expect.objectContaining({ date: '2026-10-01', gross_sales_cents: 100000, sales_tax_cents: 7500, cash_cents: 50000, card_cents: 57500 }),
      expect.objectContaining({ date: '2024-02-01', gross_sales_cents: 54000, cash_cents: 54000 }),
    ]);
    expect(plan.warnings.join(' ')).toMatch(/didn’t balance/);
  });

  it('lists what can’t be imported yet', () => {
    expect(plan.notYet.map((n) => [n.name, n.count])).toEqual([['months', 1], ['employees', 2]]);
  });

  it('rejects files that aren’t backups', () => {
    expect(() => planFromBackup([], { today })).toThrow();
    expect(() => planFromBackup({ hello: 1 }, { today })).toThrow();
    expect(planFromBackup({ collections: { vendors: [{ name: 'A' }] } }, { today }).rows.vendor).toHaveLength(1);
  });

  it('helpers', () => {
    expect(nextOnDay('2026-11-10', 8)).toBe('2026-12-08');
    expect(nextOnDay('2026-11-10', 10)).toBe('2026-11-10');
    expect(nextOnDay('2026-01-31', 31)).toBe('2026-01-31');
    expect(nextOnDay('2026-02-01', 31)).toBe('2026-02-28');
    expect(accountRoleFor('Landlord LLC')).toBe('rent');
    expect(accountRoleFor('Outre')).toBe('inventory');
  });
});

describe('spreadsheet → import rows', () => {
  it('bills', () => {
    const { rows, errors } = planFromSheet('bill', [
      ['Vendor', 'Invoice #', 'Bill date', 'Due date', 'Amount', 'Category', 'Paid'],
      ['Outre', 'A1', '11/01/2026', '12/01/2026', '$1,250.00', '', 'yes'],
      ['Landlord', '', '2026-11-01', '', '3500', 'rent', ''],
      ['Bad', 'X', 'nope', '', '10', '', ''],
    ], { today });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ vendor: 'Outre', bill_date: '2026-11-01', amount_cents: 125000, account_role: 'inventory', payments: [{ amount_cents: 125000 }] });
    expect(rows[1]).toMatchObject({ account_role: 'rent', due_date: '2026-11-01', payments: [] });
    expect(errors).toEqual([{ line: 4, message: 'Bad: bill date isn’t a date' }]);
  });

  it('vendors and fixed costs', () => {
    expect(planFromSheet('vendor', [['Name', 'Terms'], ['Outre', 'Net 30'], ['', '']], { today }).rows).toEqual([expect.objectContaining({ name: 'Outre', payment_terms_days: 30 })]);
    expect(planFromSheet('recurring', [['Name', 'Amount', 'Day'], ['Rent', '3500', '1']], { today }).rows[0]).toMatchObject({ amount_cents: 350000, next_date: '2026-12-01', account_role: 'rent' });
  });

  it('needs headers and data', () => {
    expect(planFromSheet('vendor', [['Name']], { today }).errors[0].message).toMatch(/header row/);
    expect(planFromSheet('vendor', [['Foo'], ['x']], { today }).errors[0].message).toMatch(/Name/);
  });
});

describe('Excel cells and dates (#129, #130)', () => {
  it('turns every exceljs cell shape into text; error cells are empty', async () => {
    const { cellText } = await import('./cell');
    expect(cellText(null)).toBe('');
    expect(cellText(12.5)).toBe('12.5');
    expect(cellText(new Date('2026-10-05T00:00:00Z'))).toBe('2026-10-05');
    expect(cellText({ richText: [{ text: 'Hair ' }, { text: 'Zone' }] })).toBe('Hair Zone');
    expect(cellText({ formula: 'A1*2', result: 42 })).toBe('42');
    expect(cellText({ formula: 'A1/0', result: { error: '#DIV/0!' } })).toBe('');
    expect(cellText({ error: '#N/A' })).toBe('');
    expect(cellText({ text: 'site', hyperlink: 'https://x' })).toBe('site');
    expect(cellText({ sharedFormula: 'B1' })).toBe('');
  });

  it('backup dates must be real and between 2000 and 2100', async () => {
    const { isoDate } = await import('./backup');
    expect(isoDate('2026-10-31')).toBe('2026-10-31');
    expect(isoDate('2026-02-30')).toBeNull();
    expect(isoDate('0201-10-01')).toBeNull();
    expect(isoDate('9999-12-31')).toBeNull();
    expect(isoDate('infinity')).toBeNull();
  });

  it('exceljs still loads workbooks with the patched uuid', async () => {
    const { Workbook } = await import('exceljs');
    const wb = new Workbook();
    wb.addWorksheet('S').addRow(['Vendor', 'Amount']);
    const buf = await wb.xlsx.writeBuffer();
    const back = new Workbook();
    await back.xlsx.load(buf as ArrayBuffer);
    expect(back.worksheets[0].getRow(1).values).toEqual([undefined, 'Vendor', 'Amount']);
  });
});
