/**
 * Year-end Excel report (#111), copied from the owner's RetailNexa app: one
 * workbook with a monthly summary, sales tax, expenses by vendor, all bills,
 * payroll by employee, pay runs, daily sales, partner split and bank spending.
 * Building the sheets is pure; money in integer cents, written as dollars.
 */
export interface Col { header: string; key: string; width?: number; money?: boolean }
export interface Sheet { name: string; columns: Col[]; rows: Record<string, string | number | null>[]; totals?: boolean; note?: string }

export interface YearEndInput {
  year: number;
  businessName: string;
  months?: { ym: string; sales: number; tax: number; cash: number; card: number; points: number; bills: number; payroll: number; balancesIn: number; balancesOut: number; profit: number | null; manual: boolean }[];
  bills?: { vendor: string; bill_number: string; bill_date: string; due_date: string; status: string; total_cents: number; paid_cents: number }[];
  payLines?: { employee: string; pay_date: string; hours: number; overtime_hours: number; gross_cents: number; bonus_cents: number; employer_tax_cents: number; advance_cents: number; net_cents: number }[];
  runs?: { pay_date: string; period_start: string; period_end: string; gross_cents: number; employer_tax_cents: number; net_cents: number; voided: boolean }[];
  days?: { date: string; store: string; register: string; net_cents: number; tax_cents: number; cash_cents: number; card_cents: number; transactions: number | null }[];
  partners?: { name: string; pct: number; distributed_cents: number; paid_cents: number }[];
  bankByMonth?: { ym: string; out_cents: number; in_cents: number }[];
}

const mon = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', year: 'numeric' });

export function yearEndSheets(d: YearEndInput): Sheet[] {
  const out: Sheet[] = [];
  if (d.months) {
    out.push({ name: 'Summary', totals: true, note: 'Profit is cash-basis: sales + tax ± other stores − bills due − payroll. Not audited net income.', columns: [
      { header: 'Month', key: 'm', width: 12 }, { header: 'Net sales', key: 'sales', money: true }, { header: 'Sales tax', key: 'tax', money: true },
      { header: 'Points', key: 'points', money: true }, { header: 'Cash', key: 'cash', money: true }, { header: 'Card', key: 'card', money: true },
      { header: 'Bills & orders', key: 'bills', money: true }, { header: 'Payroll (with employer taxes)', key: 'payroll', money: true, width: 18 },
      { header: 'Other stores (net)', key: 'xfer', money: true }, { header: 'Profit', key: 'profit', money: true }, { header: 'Profit entered by hand', key: 'manual', width: 12 },
    ], rows: d.months.map((m) => ({ m: mon(m.ym), sales: m.sales, tax: m.tax, points: m.points, cash: m.cash, card: m.card, bills: m.bills, payroll: m.payroll, xfer: m.balancesIn - m.balancesOut, profit: m.profit, manual: m.manual ? 'Yes' : '' })) });
    out.push({ name: 'Sales tax', totals: true, columns: [{ header: 'Month', key: 'm', width: 12 }, { header: 'Taxable sales', key: 'sales', money: true }, { header: 'Tax collected', key: 'tax', money: true }],
      rows: d.months.map((m) => ({ m: mon(m.ym), sales: m.sales, tax: m.tax })) });
  }
  if (d.bills) {
    const live = d.bills.filter((b) => b.status !== 'void');
    const months = Array.from({ length: 12 }, (_, i) => `${d.year}-${String(i + 1).padStart(2, '0')}`);
    const by = new Map<string, Record<string, number>>();
    for (const b of live) {
      const r = by.get(b.vendor) ?? {};
      r[b.due_date.slice(0, 7)] = (r[b.due_date.slice(0, 7)] ?? 0) + Number(b.total_cents);
      by.set(b.vendor, r);
    }
    out.push({ name: 'Expenses by vendor', totals: true, columns: [{ header: 'Vendor', key: 'v', width: 28 }, { header: 'Total', key: 'total', money: true }, ...months.map((m) => ({ header: mon(m).slice(0, 3), key: m, money: true, width: 11 }))],
      rows: [...by].map(([v, r]) => ({ v, total: Object.values(r).reduce((a, x) => a + x, 0), ...Object.fromEntries(months.map((m) => [m, r[m] ?? 0])) })).sort((a, b) => Number(b.total) - Number(a.total)) });
    out.push({ name: 'All bills', totals: true, columns: [
      { header: 'Vendor', key: 'v', width: 28 }, { header: 'Invoice #', key: 'n', width: 14 }, { header: 'Bill date', key: 'bd', width: 12 }, { header: 'Due date', key: 'dd', width: 12 },
      { header: 'Status', key: 's', width: 10 }, { header: 'Amount', key: 'amt', money: true }, { header: 'Paid', key: 'paid', money: true }, { header: 'Left', key: 'left', money: true },
    ], rows: [...d.bills].sort((a, b) => a.due_date.localeCompare(b.due_date)).map((b) => ({ v: b.vendor, n: b.bill_number, bd: b.bill_date, dd: b.due_date, s: b.status,
      amt: b.status === 'void' ? 0 : Number(b.total_cents), paid: Number(b.paid_cents), left: b.status === 'void' ? 0 : Math.max(0, Number(b.total_cents) - Number(b.paid_cents)) })) });
  }
  if (d.payLines) {
    const by = new Map<string, { hours: number; ot: number; gross: number; bonus: number; tax: number; adv: number; net: number }>();
    for (const l of d.payLines) {
      const r = by.get(l.employee) ?? { hours: 0, ot: 0, gross: 0, bonus: 0, tax: 0, adv: 0, net: 0 };
      r.hours += Number(l.hours); r.ot += Number(l.overtime_hours); r.gross += Number(l.gross_cents); r.bonus += Number(l.bonus_cents);
      r.tax += Number(l.employer_tax_cents); r.adv += Number(l.advance_cents); r.net += Number(l.net_cents);
      by.set(l.employee, r);
    }
    out.push({ name: 'Payroll by employee', totals: true, note: 'From pay runs that were not voided. Records only; not a payroll tax filing.', columns: [
      { header: 'Employee', key: 'e', width: 24 }, { header: 'Hours', key: 'hours' }, { header: 'Overtime hours', key: 'ot' }, { header: 'Gross pay', key: 'gross', money: true },
      { header: 'Bonus', key: 'bonus', money: true }, { header: 'Employer taxes', key: 'tax', money: true }, { header: 'Cost', key: 'cost', money: true },
      { header: 'Advances repaid', key: 'adv', money: true }, { header: 'Net paid', key: 'net', money: true },
    ], rows: [...by].sort((a, b) => a[0].localeCompare(b[0])).map(([e, r]) => ({ e, hours: Math.round(r.hours * 100) / 100, ot: Math.round(r.ot * 100) / 100, gross: r.gross, bonus: r.bonus, tax: r.tax, cost: r.gross + r.tax, adv: r.adv, net: r.net })) });
  }
  if (d.runs) {
    out.push({ name: 'Pay runs', totals: true, columns: [
      { header: 'Pay date', key: 'd', width: 12 }, { header: 'Period', key: 'p', width: 24 }, { header: 'Gross pay', key: 'g', money: true }, { header: 'Employer taxes', key: 't', money: true },
      { header: 'Net paid', key: 'n', money: true }, { header: 'Voided', key: 'v', width: 8 },
    ], rows: [...d.runs].sort((a, b) => a.pay_date.localeCompare(b.pay_date)).map((r) => ({ d: r.pay_date, p: `${r.period_start} to ${r.period_end}`,
      g: r.voided ? 0 : Number(r.gross_cents), t: r.voided ? 0 : Number(r.employer_tax_cents), n: r.voided ? 0 : Number(r.net_cents), v: r.voided ? 'Yes' : '' })) });
  }
  if (d.days) {
    out.push({ name: 'Daily sales', totals: true, columns: [
      { header: 'Date', key: 'd', width: 12 }, { header: 'Store', key: 's', width: 18 }, { header: 'Register', key: 'r', width: 14 }, { header: 'Net sales', key: 'net', money: true },
      { header: 'Tax', key: 'tax', money: true }, { header: 'Cash', key: 'cash', money: true }, { header: 'Card', key: 'card', money: true }, { header: 'Transactions', key: 'tx' },
    ], rows: [...d.days].sort((a, b) => a.date.localeCompare(b.date) || a.store.localeCompare(b.store)).map((x) => ({ d: x.date, s: x.store, r: x.register, net: x.net_cents, tax: x.tax_cents, cash: x.cash_cents, card: x.card_cents, tx: x.transactions })) });
  }
  if (d.partners) {
    const profit = d.months?.reduce((a, m) => a + (m.profit ?? 0), 0) ?? null;
    out.push({ name: 'Partner split', totals: true, columns: [
      { header: 'Partner', key: 'p', width: 22 }, { header: 'Share %', key: 'pct' }, { header: 'Share of profit', key: 'of', money: true },
      { header: 'Distributed', key: 'dist', money: true }, { header: 'Paid', key: 'paid', money: true },
    ], rows: d.partners.map((p) => ({ p: p.name, pct: p.pct, of: profit === null ? null : Math.round((profit * p.pct) / 100), dist: p.distributed_cents, paid: p.paid_cents })) });
  }
  if (d.bankByMonth) {
    out.push({ name: 'Bank spending', totals: true, note: 'From imported bank statements: money out and in by month.', columns: [{ header: 'Month', key: 'm', width: 12 }, { header: 'Money out', key: 'out', money: true }, { header: 'Money in', key: 'in', money: true }],
      rows: d.bankByMonth.map((b) => ({ m: mon(b.ym), out: b.out_cents, in: b.in_cents })) });
  }
  return out;
}

/** Write the sheets as an .xlsx (ExcelJS). Money columns are dollars with a currency format; text stays text (no formulas from data). */
export async function yearEndXlsx(title: string, sheets: Sheet[]): Promise<Buffer> {
  const { Workbook } = await import('exceljs');
  const wb = new Workbook();
  wb.creator = 'RetailNexa';
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name.slice(0, 31), { views: [{ state: 'frozen', ySplit: 2 }] });
    ws.addRow([`${title} · ${s.name}`]).font = { bold: true, size: 13 };
    const head = ws.addRow(s.columns.map((c) => c.header));
    head.font = { bold: true };
    s.columns.forEach((c, i) => { ws.getColumn(i + 1).width = c.width ?? 14; if (c.money) ws.getColumn(i + 1).numFmt = '"$"#,##0.00;[Red]-"$"#,##0.00'; });
    for (const r of s.rows) ws.addRow(s.columns.map((c) => { const v = r[c.key]; return c.money ? (v === null || v === undefined ? null : Number(v) / 100) : v ?? null; }));
    if (s.totals && s.rows.length) {
      const t = ws.addRow(s.columns.map((c, i) => (i === 0 ? 'Total' : c.money ? s.rows.reduce((a, r) => a + Number(r[c.key] ?? 0), 0) / 100 : null)));
      t.font = { bold: true };
    }
    if (s.note) ws.addRow([]).getCell(1).value = s.note;
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
