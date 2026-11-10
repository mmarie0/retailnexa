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

describe('everything in one file (owner request)', () => {
  it('one CSV with a Type column fills every kind', async () => {
    const { planFromTables, TEMPLATE_CSV } = await import('./bundle');
    const { parseCsv } = await import('@/lib/sales/csv');
    const plan = planFromTables([{ name: 'all.csv', rows: parseCsv(TEMPLATE_CSV) }], { today: '2026-11-10' });
    expect(plan.errors).toEqual([]);
    expect(Object.fromEntries(Object.entries(plan.rows).map(([k, v]) => [k, v!.length]))).toEqual({ vendor: 1, bill: 1, recurring: 1, sales_day: 1, bank_line: 1 });
    expect(plan.rows.bill![0]).toMatchObject({ vendor: 'Hair Zone', amount_cents: 193400, bill_date: '2026-10-01' });
    expect(plan.rows.sales_day![0]).toMatchObject({ date: '2026-10-02', gross_sales_cents: 165000, cash_cents: 70000, card_cents: 106550 });
    expect(plan.rows.bank_line![0]).toMatchObject({ amount_cents: -193400 });
    expect(plan.rows.recurring![0]).toMatchObject({ name: 'Rent', amount_cents: 250000, day_of_month: 1 });
  });

  it('unknown types are reported; sheets without a Type column are told apart by name or header', async () => {
    const { planFromTables, kindFromName, kindFromHeader } = await import('./bundle');
    expect(kindFromName('exports/2026 Bank statement Oct.xlsx')).toBe('bank_line');
    expect(kindFromName('fixed costs.csv')).toBe('recurring');
    expect(kindFromName('Vendors.csv')).toBe('vendor');
    expect(kindFromName('all data.xlsx › Bank')).toBe('bank_line');
    expect(kindFromName('all data.xlsx › Fixed costs')).toBe('recurring');
    expect(kindFromHeader(['Date', 'Register', 'Gross sales', 'Cash', 'Card'])).toBe('sales_day');
    expect(kindFromHeader(['Vendor', 'Invoice #', 'Bill date', 'Amount'])).toBe('bill');
    const plan = planFromTables([
      { name: 'mixed.csv', rows: [['Type', 'Name'], ['Vendor', 'A'], ['Payroll', 'B']] },
      { name: 'x.csv', rows: [['Foo', 'Bar'], ['1', '2']] },
      { name: 'suppliers.csv', rows: [['Name', 'Phone'], ['Hair Zone', '555']] },
    ], { today: '2026-11-10' });
    expect(plan.errors.map((e) => e.message)).toEqual([
      'mixed.csv: Type “Payroll” isn’t one of: Vendor, Bill, Sales, Bank, Fixed cost',
      'x.csv: can’t tell what this sheet holds. Add a “Type” column, or name the file vendors, bills, sales, bank or fixed costs.',
    ]);
    expect(plan.rows.vendor!.map((r) => r.name)).toEqual(['A', 'Hair Zone']);
  });

  it('reads a zip of sheets and a backup, skipping other files and macOS junk', async () => {
    const JSZip = (await import('jszip')).default;
    const { readBundle } = await import('./read-bundle');
    const zip = new JSZip();
    zip.file('vendors.csv', 'Name,Phone\nHair Zone,555\n');
    zip.file('sub/bills.xlsx', 'xlsx-bytes');
    zip.file('backup.json', '{"bills":[]}');
    zip.file('notes.pdf', 'pdf');
    zip.file('__MACOSX/._vendors.csv', 'junk');
    const buf = await zip.generateAsync({ type: 'arraybuffer' });
    const file = { name: 'all.zip', size: buf.byteLength, arrayBuffer: async () => buf, text: async () => '' };
    const r = await readBundle(file, async (name) => [{ name, rows: [['Vendor', 'Bill date', 'Amount'], [`from ${name}`, '2026-10-01', '5']] }]);
    expect(r.tables.map((t) => t.name)).toEqual(['sub/bills.xlsx', 'vendors.csv']);
    expect(r.tables[0].rows[1][0]).toBe('from sub/bills.xlsx');
    expect(r.backups).toEqual([{ name: 'backup.json', data: { bills: [] } }]);
    expect(r.skipped).toEqual(['notes.pdf']);
  });
});

describe('one .xlsx with a tab per kind (owner: "this is for if i upload csv or xlsx")', () => {
  it('each tab is classified by its name and every kind imports', async () => {
    const { Workbook } = await import('exceljs');
    const { cellText } = await import('./cell');
    const { planFromTables } = await import('./bundle');
    const wb = new Workbook();
    wb.addWorksheet('Vendors').addRows([['Name', 'Phone'], ['Hair Zone', '555']]);
    wb.addWorksheet('Bills').addRows([['Vendor', 'Bill date', 'Amount'], ['Hair Zone', '2026-10-01', 19.34]]);
    wb.addWorksheet('Sales').addRows([['Date', 'Gross sales', 'Tax', 'Cash', 'Card'], ['2026-10-02', 100, 7, 50, 57]]);
    wb.addWorksheet('Bank').addRows([['Date', 'Description', 'Amount'], ['2026-10-05', 'ACH HAIR ZONE', -19.34]]);
    wb.addWorksheet('Fixed costs').addRows([['Name', 'Amount', 'Day of month'], ['Rent', 2500, 1]]);
    // Same reading as the /admin/import/xlsx route.
    const back = new Workbook();
    await back.xlsx.load((await wb.xlsx.writeBuffer()) as ArrayBuffer);
    const tables = back.worksheets.map((ws) => {
      const rows: string[][] = [];
      ws.eachRow({ includeEmpty: false }, (row) => rows.push((row.values as unknown[]).slice(1).map(cellText)));
      return { name: `all.xlsx › ${ws.name}`, rows };
    });
    const plan = planFromTables(tables, { today: '2026-11-10' });
    expect(plan.errors).toEqual([]);
    expect(Object.fromEntries(Object.entries(plan.rows).map(([k, v]) => [k, v!.length]))).toEqual({ vendor: 1, bill: 1, sales_day: 1, bank_line: 1, recurring: 1 });
    expect(plan.rows.bill![0]).toMatchObject({ amount_cents: 1934 });
  });
});

describe('reading Excel files that exceljs can’t (owner: "it wont read xlsx")', () => {
  const minimalXlsx = async (opts: { inline?: boolean } = {}) => {
    const JSZip = (await import('jszip')).default;
    const z = new JSZip();
    // A bare-bones workbook like some exporters write: no [Content_Types], prefixed tags, a date style, shared + inline strings.
    z.file('xl/workbook.xml', '<x:workbook xmlns:x="m" xmlns:r="r"><x:sheets><x:sheet name="Bills &amp; more" sheetId="1" r:id="rId1"/><x:sheet name="Hidden" sheetId="2" r:id="rId2" state="hidden"/></x:sheets></x:workbook>');
    z.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/></Relationships>');
    z.file('xl/sharedStrings.xml', '<sst><si><t>Vendor</t></si><si><r><t>Bill </t></r><r><t>date</t></r></si><si><t>Amount</t></si><si><t>Hair &amp; Co</t></si></sst>');
    z.file('xl/styles.xml', '<styleSheet><numFmts><numFmt numFmtId="164" formatCode="mm/dd/yyyy"/></numFmts><cellXfs><xf numFmtId="0"/><xf numFmtId="164"/><xf numFmtId="14"/></cellXfs></styleSheet>');
    const nameCell = opts.inline ? '<x:c r="A2" t="inlineStr"><x:is><x:t>Hair &amp; Co</x:t></x:is></x:c>' : '<x:c r="A2" t="s"><x:v>3</x:v></x:c>';
    z.file('xl/worksheets/sheet1.xml', `<x:worksheet><x:sheetData><x:row r="1"><x:c r="A1" t="s"><x:v>0</x:v></x:c><x:c r="B1" t="s"><x:v>1</x:v></x:c><x:c r="D1" t="s"><x:v>2</x:v></x:c></x:row><x:row r="2">${nameCell}<x:c r="B2" s="1"><x:v>46296</x:v></x:c><x:c r="D2"><x:v>1934.5</x:v></x:c></x:row><x:row r="3"></x:row></x:sheetData></x:worksheet>`);
    z.file('xl/worksheets/sheet2.xml', '<worksheet><sheetData><row><c><v>1</v></c></row></sheetData></worksheet>');
    return z.generateAsync({ type: 'arraybuffer' });
  };

  it('the forgiving reader handles shared/inline/rich strings, dates by style, gaps, hidden tabs', async () => {
    const { readXlsxLite } = await import('./xlsx-lite');
    for (const inline of [false, true]) {
      const sheets = await readXlsxLite(await minimalXlsx({ inline }));
      expect(sheets).toEqual([{ name: 'Bills & more', rows: [['Vendor', 'Bill date', '', 'Amount'], ['Hair & Co', '2026-10-01', '', '1934.5']] }]);
    }
  });

  it('readWorkbook falls back when exceljs fails, and explains .xls and renamed CSV files', async () => {
    const { readWorkbook } = await import('./workbook');
    const sheets = await readWorkbook(await minimalXlsx());
    expect(sheets[0].rows[1]).toEqual(['Hair & Co', '2026-10-01', '', '1934.5']);
    const xls = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]).buffer;
    await expect(readWorkbook(xls)).rejects.toThrow(/old \.xls file/);
    const csv = new TextEncoder().encode('Vendor,Amount\nHair Zone,5\n').buffer as ArrayBuffer;
    expect(await readWorkbook(csv)).toEqual([{ name: 'Sheet1', rows: [['Vendor', 'Amount'], ['Hair Zone', '5']] }]);
    await expect(readWorkbook(new TextEncoder().encode('just words').buffer as ArrayBuffer)).rejects.toThrow(/isn’t an Excel workbook/);
  });

  it('a normal Excel file still reads through exceljs, every tab', async () => {
    const { Workbook } = await import('exceljs');
    const { readWorkbook } = await import('./workbook');
    const wb = new Workbook();
    wb.addWorksheet('Vendors').addRows([['Name'], ['Hair Zone']]);
    wb.addWorksheet('Bills').addRows([['Vendor', 'Bill date', 'Amount'], ['Hair Zone', new Date('2026-10-01T00:00:00Z'), 5]]);
    const sheets = await readWorkbook((await wb.xlsx.writeBuffer()) as ArrayBuffer);
    expect(sheets.map((s) => s.name)).toEqual(['Vendors', 'Bills']);
    expect(sheets[1].rows[1]).toEqual(['Hair Zone', '2026-10-01', '5']);
  });
});
