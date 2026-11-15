import type { Metadata } from 'next';
import Link from 'next/link';
import { can, getOrgContext } from '@/lib/auth/context';
import { Card, Notice, cx } from '@/components/ui';
import { formatMoney } from '@/lib/billing/plans';
import { yearSummary } from '@/lib/profit/partners';
import { Stat } from '../../_dashboard/tiles';
import { ProfitTabs } from '../tabs';
import { loadProfitYear } from '../_data';

export const metadata: Metadata = { title: 'Year-end report' };

/** #111 Year-end report: the year's totals and a download of the Excel workbook for your accountant. */
export default async function YearEndPage({ searchParams }: PageProps<'/app/profit/year-end'>) {
  const ctx = await getOrgContext();
  if (!can(ctx, 'profit.view')) return <Notice tone="warning">You don’t have access to profit.</Notice>;
  const sp = await searchParams;
  const now = new Date().getUTCFullYear();
  const years = [now, now - 1, now - 2];
  const year = typeof sp.y === 'string' && years.includes(+sp.y) ? +sp.y : new Date().getUTCMonth() < 3 ? now - 1 : now;
  const { months, today } = await loadProfitYear(ctx, year);
  const sum = yearSummary(months);
  const t = (k: 'bills' | 'payroll') => months.reduce((a, m) => a + m[k], 0);
  const salesTax = months.reduce((a, m) => a + m.tax, 0), sales = months.reduce((a, m) => a + (m.sales ?? 0), 0);
  const missing = months.filter((m) => m.manual === null && (m.bills === 0 || m.payroll === 0)).map((m) => new Date(`${m.ym}-01T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short' }));
  const sheets = [
    can(ctx, 'sales.view') && 'Summary and Sales tax (month by month)',
    can(ctx, 'bills.view') && 'Expenses by vendor (month by month) and All bills',
    can(ctx, 'payroll.view') && 'Payroll by employee and Pay runs',
    can(ctx, 'sales.view') && 'Daily sales',
    'Partner split (empty until you set up partners)',
    can(ctx, 'bank.view') && 'Bank spending by month (empty until you import a bank statement)',
  ].filter(Boolean) as string[];

  return (
    <>
      <h1 className="text-[26px] font-extrabold tracking-[-.02em]">Year-end report</h1>
      <ProfitTabs active="/app/profit/year-end" />
      <nav aria-label="Year" className="flex gap-1.5">
        {years.map((y) => <Link key={y} href={`/app/profit/year-end?y=${y}`} aria-current={y === year ? 'page' : undefined} className={cx('rounded-full px-3.5 py-1.5 text-sm font-semibold', y === year ? 'bg-accent text-on-accent' : 'bg-card shadow-[var(--shadow-card)]')}>{y}</Link>)}
      </nav>
      {year === +today.slice(0, 4) && <Notice>{year} is still in progress: this covers January 1 through today.</Notice>}
      {missing.length > 0 && <Notice tone="warning">No bills or no payroll recorded for {missing.join(', ')}. Profit for those months reads high until they’re added (or enter the month by hand on Profit).</Notice>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat block="blue" label="Net sales" value={formatMoney(sales)} />
        <Stat label="Sales tax collected" value={formatMoney(salesTax)} />
        <Stat label="Bills & orders" value={formatMoney(t('bills'))} />
        <Stat label="Payroll" value={formatMoney(t('payroll'))} />
      </div>
      <Stat block="sunset" label={`${year} profit`} value={formatMoney(sum.total)} sub="Cash-basis: sales + tax ± other stores − bills − payroll" />
      <Card>
        <h2 className="text-lg font-bold">What’s in the Excel file</h2>
        <ul className="mt-2 list-disc ps-5 text-[15px]">{sheets.map((s) => <li key={s}>{s}</li>)}</ul>
        {can(ctx, 'reports.export')
          ? <a href={`/app/profit/year-end/xlsx?y=${year}`} className="mt-3 inline-flex rounded-full bg-accent px-4 py-2 font-semibold text-on-accent">Download {year} Excel report</a>
          : <p className="mt-3 text-sm text-muted">Downloading needs the Export reports permission.</p>}
        <p className="mt-2 text-sm text-muted">Built from what’s in RetailNexa. Your accountant should check it against your bank statements and POS reports.</p>
      </Card>
    </>
  );
}
