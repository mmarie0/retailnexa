import type { Metadata } from 'next';
import Link from 'next/link';
import { can, getOrgContext } from '@/lib/auth/context';
import { ActionForm } from '@/components/action-form';
import { SubmitButton } from '@/components/submit-button';
import { Badge, Card, EmptyState, Field, Input, LinkButton, Notice, Select, cx } from '@/components/ui';
import { formatMoney } from '@/lib/billing/plans';
import { avgSale, pctChange, share, type MonthTotals } from '@/lib/sales/history';
import { Stat } from '../../_dashboard/tiles';
import { ReadOnlyNotice } from '../../read-only-notice';
import { loadMonths } from './_load';
import { saveSalesMonth } from './actions';
import { MonthUpload } from './upload';

export const metadata: Metadata = { title: 'Months & history' };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pct = (v: number | null) => (v === null ? '—' : `${v.toFixed(1)}%`);
const k = (c: number) => (c >= 100_000 ? `$${(c / 100_000).toFixed(1)}k` : formatMoney(c));

/** #103 Months & history: monthly roll-up, years side by side, year compare, monthly reports, CSV. */
export default async function HistoryPage({ searchParams }: PageProps<'/app/sales/history'>) {
  const ctx = await getOrgContext();
  if (!can(ctx, 'sales.view')) return <Notice tone="warning">You don’t have access to sales.</Notice>;
  const sp = await searchParams;
  const { today, months, stores, truncated } = await loadMonths(ctx, 3);
  const thisYear = +today.slice(0, 4);
  const year = typeof sp.y === 'string' && /^\d{4}$/.test(sp.y) && +sp.y >= thisYear - 2 && +sp.y <= thisYear ? +sp.y : thisYear;
  const byYm = new Map(months.map((m) => [m.ym, m]));
  const yearRows = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`).filter((ym) => ym <= today.slice(0, 7)).reverse();
  const sum = (ms: (MonthTotals | undefined)[], f: (m: MonthTotals) => number) => ms.reduce((a, m) => a + (m ? f(m) : 0), 0);
  // Year compare: this year to date vs the same months last year (current month to today's day isn't pro-rated).
  const ytdMonths = (y: number) => Array.from({ length: +today.slice(5, 7) }, (_, i) => byYm.get(`${y}-${String(i + 1).padStart(2, '0')}`));
  const ytd = sum(ytdMonths(thisYear), (m) => m.sales), lastYtd = sum(ytdMonths(thisYear - 1), (m) => m.sales);
  const editable = can(ctx, 'sales.import') && ctx.access.canWrite;
  const years = [thisYear, thisYear - 1, thisYear - 2];

  return (
    <>
      <ReadOnlyNotice show={can(ctx, 'sales.import') && !ctx.access.canWrite} />
      {truncated && <Notice tone="warning">You have more than 50,000 daily sales rows in these 3 years, so the oldest months may be short. Upload monthly reports for those months, or contact support.</Notice>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-[22px] font-bold tracking-tight">Months & history</h1>
        <nav aria-label="Year" className="flex gap-1 rounded-full bg-soft p-1">
          {years.map((y) => <Link key={y} href={`/app/sales/history?y=${y}`} aria-current={y === year ? 'page' : undefined} className={cx('rounded-full px-3.5 py-1.5 text-sm font-semibold', y === year ? 'bg-card text-ink shadow-[var(--shadow-card)]' : 'text-muted')}>{y}</Link>)}
        </nav>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <Stat block="blue" label={`${thisYear} so far`} value={formatMoney(ytd)} sub={lastYtd ? `${(pctChange(ytd, lastYtd) ?? 0) >= 0 ? '▲' : '▼'} ${Math.abs(pctChange(ytd, lastYtd) ?? 0).toFixed(1)}% vs ${thisYear - 1} same months` : 'No last-year sales to compare'} />
        <Stat block="indigo" label={`${thisYear - 1} same months`} value={formatMoney(lastYtd)} sub={`Jan–${MON[+today.slice(5, 7) - 1]}`} />
      </div>

      {months.length === 0 ? <EmptyState title="No sales yet">Add daily reports, or upload your POS’s monthly reports below.</EmptyState> : (
        <Card className="overflow-x-auto p-0">
          <div className="flex items-center justify-between gap-2 px-4 pt-4">
            <h2 className="text-lg font-bold">{year} by month</h2>
            <a href={`/app/sales/history/export?y=${year}`} download className="text-sm font-semibold text-accent-strong">Download CSV</a>
          </div>
          <table className="w-full min-w-[980px] text-[14px]">
            <thead className="text-left"><tr>
              <th className="px-4 py-2">Month</th><th className="px-2 text-right">Sales</th><th className="px-2 text-right">Gross</th><th className="px-2 text-right">Tax</th><th className="px-2 text-right">Cash</th><th className="px-2 text-right">Card</th>
              <th className="px-2 text-right">Cash %</th><th className="px-2 text-right">Card %</th><th className="px-2 text-right">Store card</th><th className="px-2 text-right">Points</th><th className="px-2 text-right">Txns</th><th className="px-2 text-right">Avg sale</th><th className="px-4">From</th>
            </tr></thead>
            <tbody>
              {yearRows.map((ym) => {
                const m = byYm.get(ym);
                const ly = byYm.get(`${+ym.slice(0, 4) - 1}${ym.slice(4)}`);
                const tender = m ? m.cash + m.card + m.storeCard : 0;
                return (
                  <tr key={ym} className="border-t border-line">
                    <td className="px-4 py-2 font-semibold">{MON[+ym.slice(5) - 1]}{ly && m && <span className={cx('block text-xs font-normal', m.sales >= ly.sales ? 'text-paid' : 'text-late')}>{(pctChange(m.sales, ly.sales) ?? 0) >= 0 ? '▲' : '▼'} {Math.abs(pctChange(m.sales, ly.sales) ?? 0).toFixed(1)}%</span>}</td>
                    {m ? <>
                      <td className="num px-2 text-right font-semibold">{formatMoney(m.sales)}</td><td className="num px-2 text-right">{formatMoney(m.gross)}</td><td className="num px-2 text-right">{formatMoney(m.tax)}</td>
                      <td className="num px-2 text-right">{formatMoney(m.cash)}</td><td className="num px-2 text-right">{formatMoney(m.card)}</td>
                      <td className="num px-2 text-right">{pct(share(m.cash, tender))}</td><td className="num px-2 text-right">{pct(share(m.card, tender))}</td>
                      <td className="num px-2 text-right">{formatMoney(m.storeCard)}</td><td className="num px-2 text-right">{formatMoney(m.points)}</td>
                      <td className="num px-2 text-right">{m.transactions?.toLocaleString('en-US') ?? '—'}</td><td className="num px-2 text-right">{avgSale(m) === null ? '—' : formatMoney(avgSale(m)!)}</td>
                      <td className="px-4">{m.source === 'report' ? <Badge tone="info">Monthly report</Badge> : m.source === 'mixed' ? <Badge>Both</Badge> : <span className="text-xs text-muted">{m.days} daily report{m.days === 1 ? '' : 's'}</span>}</td>
                    </> : <td colSpan={12} className="px-2 py-2 text-muted">No sales recorded</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="px-4 py-3 text-xs text-muted">Transactions and average sale come from the monthly report you upload, or from daily reports that include them. When a store’s monthly report is uploaded, it replaces that store’s daily totals for the month.</p>
        </Card>
      )}

      {months.length > 0 && (
        <Card className="overflow-x-auto p-0">
          <h2 className="px-4 pt-4 text-lg font-bold">Years side by side</h2>
          <table className="w-full min-w-[860px] text-[13px]">
            <thead className="text-left"><tr><th className="px-4 py-2">Year</th>{MON.map((m) => <th key={m} className="px-1.5 text-right">{m}</th>)}<th className="px-4 text-right">Total</th></tr></thead>
            <tbody>{years.map((y) => {
              const ms = MON.map((_, i) => byYm.get(`${y}-${String(i + 1).padStart(2, '0')}`));
              return <tr key={y} className="border-t border-line"><td className="px-4 py-2 font-semibold">{y}</td>{ms.map((m, i) => <td key={i} className="num px-1.5 text-right">{m ? k(m.sales) : '—'}</td>)}<td className="num px-4 text-right font-semibold">{formatMoney(sum(ms, (m) => m.sales))}</td></tr>;
            })}</tbody>
          </table>
        </Card>
      )}

      {editable && (
        <Card id="add" className="flex flex-col gap-4">
          <div>
            <h2 className="text-lg font-bold">Monthly sales report</h2>
            <p className="text-sm text-muted">At the end of each month, upload your POS’s monthly report or type its totals. RetailNexa isn’t a register, so this is where transactions, store card and points come from.</p>
          </div>
          <MonthUpload stores={stores} today={today} />
          <details>
            <summary className="cursor-pointer text-sm font-semibold text-accent-strong">Add or fix one month by hand</summary>
            <ActionForm action={saveSalesMonth} className="mt-3 grid gap-3 sm:grid-cols-4">
              <Field label="Month" htmlFor="m-month"><Input id="m-month" name="month" type="month" max={today.slice(0, 7)} defaultValue={today.slice(0, 7)} required /></Field>
              {stores.length > 1 && <Field label="Store" htmlFor="m-loc"><Select id="m-loc" name="location_id" defaultValue=""><option value="">Choose…</option>{stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>}
              {([['sales', 'Sales'], ['gross', 'Gross (optional)'], ['tax', 'Tax'], ['cash', 'Cash'], ['card', 'Card'], ['store_card', 'Store card'], ['points', 'Points / discounts']] as const).map(([f, l]) => (
                <Field key={f} label={l} htmlFor={`m-${f}`}><Input id={`m-${f}`} name={f} inputMode="decimal" className="num" placeholder="0.00" /></Field>
              ))}
              <Field label="Transactions" htmlFor="m-tx"><Input id="m-tx" name="transactions" inputMode="numeric" className="num" /></Field>
              <Field label="Note" htmlFor="m-note"><Input id="m-note" name="note" maxLength={300} /></Field>
              <SubmitButton className="self-end justify-self-start" pendingText="Saving…">Save month</SubmitButton>
            </ActionForm>
          </details>
        </Card>
      )}
      <div className="flex flex-wrap gap-2"><LinkButton href="/app/sales" variant="secondary">Daily sales</LinkButton><LinkButton href="/app/sales/categories" variant="secondary">Categories</LinkButton></div>
    </>
  );
}
