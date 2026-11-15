import type { Metadata } from 'next';
import Link from 'next/link';
import { can, getOrgContext } from '@/lib/auth/context';
import { ActionForm } from '@/components/action-form';
import { Badge, Card, Field, Input, Notice, Textarea, cx } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';
import { formatMoney } from '@/lib/billing/plans';
import { yearSummary } from '@/lib/profit/partners';
import { ReadOnlyNotice } from '../read-only-notice';
import { Stat } from '../_dashboard/tiles';
import { ProfitTabs } from './tabs';
import { loadProfitYear } from './_data';
import { importProfit, saveProfitMonth } from './actions';

export const metadata: Metadata = { title: 'Profit' };
const money0 = (c: number) => formatMoney(Math.round(c / 100) * 100).replace(/\.00$/, '');
const mon = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short' });

/** #104 Profit by month (owner's formula), with manual months and bulk import. */
export default async function ProfitPage({ searchParams }: PageProps<'/app/profit'>) {
  const ctx = await getOrgContext();
  if (!can(ctx, 'profit.view')) return <Notice tone="warning">You don’t have access to profit.</Notice>;
  const sp = await searchParams;
  const thisYear = new Date().getUTCFullYear();
  const year = typeof sp.y === 'string' && /^\d{4}$/.test(sp.y) && +sp.y >= 2000 && +sp.y <= thisYear ? +sp.y : thisYear;
  const { today, months, canBills, canPay } = await loadProfitYear(ctx, year);
  const sum = yearSummary(months);
  const cur = months.find((m) => m.ym === today.slice(0, 7));
  const projectedYear = year === +today.slice(0, 4) && sum.average !== null ? sum.average * 12 : null;
  const manage = can(ctx, 'org.manage') && ctx.access.canWrite;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-[26px] font-extrabold tracking-[-.02em]">Profit</h1>
        <span className="flex items-center gap-1 text-sm">
          <Link href={`/app/profit?y=${year - 1}`} className="rounded-full bg-card px-3 py-1.5 font-semibold shadow-[var(--shadow-card)]" aria-label="Previous year">‹ {year - 1}</Link>
          <b className="px-2">{year}</b>
          {year < thisYear && <Link href={`/app/profit?y=${year + 1}`} className="rounded-full bg-card px-3 py-1.5 font-semibold shadow-[var(--shadow-card)]" aria-label="Next year">{year + 1} ›</Link>}
        </span>
      </div>
      <ProfitTabs active="/app/profit" />
      <ReadOnlyNotice show={can(ctx, 'org.manage') && !ctx.access.canWrite} />
      {(!canBills || !canPay) && <Notice>Some parts are left out because you can’t see {[!canBills && 'bills', !canPay && 'payroll'].filter(Boolean).join(' or ')}.</Notice>}
      {sum.months === 0 ? (
        <Card><h2 className="text-lg font-bold">No profit to show for {year} yet</h2><p className="mt-1 text-muted">Profit appears once sales are recorded for a month (or you enter a month by hand below).</p></Card>
      ) : <Stat hero block="sunset" label={`${year} profit so far`} value={money0(sum.total)}
        sub={<>{sum.months} month{sum.months === 1 ? '' : 's'} · average {sum.average === null ? '—' : money0(sum.average)} a month{sum.margin !== null ? ` · ${sum.margin.toFixed(1)}% of sales` : ''}{projectedYear !== null ? <><br />On pace for {money0(projectedYear)} this year</> : null}</>} />}
      {cur && <p className="text-sm text-muted">{mon(cur.ym)} is {cur.projected ? 'projected: sales on pace and payroll as scheduled' : 'entered by hand'}.</p>}

      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[640px] text-[14.5px]">
          <thead className="text-start text-xs uppercase tracking-[.06em] text-muted">
            <tr><th className="px-4 py-2.5">Month</th><th className="px-2 text-end">Sales + tax</th><th className="px-2 text-end">Bills</th><th className="px-2 text-end">Payroll</th><th className="px-2 text-end">Other stores</th><th className="px-4 text-end">Profit</th></tr>
          </thead>
          <tbody>
            {months.length === 0 ? <tr><td colSpan={6} className="px-4 py-3 text-muted">No months yet.</td></tr> : [...months].reverse().map((m) => (
              <tr key={m.ym} className="border-t border-line">
                <td className="px-4 py-2 font-semibold">{mon(m.ym)} {m.projected && <Badge>On pace</Badge>}{m.manual !== null && <Badge tone="info">By hand</Badge>}</td>
                <td className="num px-2 text-end">{m.sales === null ? '—' : money0(m.sales + m.tax)}</td>
                <td className="num px-2 text-end">{money0(m.bills)}</td>
                <td className="num px-2 text-end">{money0(m.payroll)}</td>
                <td className="num px-2 text-end">{m.balancesIn || m.balancesOut ? `${m.balancesIn - m.balancesOut >= 0 ? '+' : '−'}${money0(Math.abs(m.balancesIn - m.balancesOut))}` : '—'}</td>
                <td className={cx('num px-4 text-end font-bold', m.profit !== null && m.profit < 0 && 'text-late')}>{m.profit === null ? '—' : money0(m.profit)}{m.manual !== null && m.formula !== null ? <span className="block text-xs font-normal text-muted">formula {money0(m.formula)}</span> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <p className="text-sm text-muted">Profit = sales + tax + what other stores owe you − bills due that month − what you owe other stores − payroll. It’s cash-basis: stock you buy counts in the month its bill is due, so it isn’t the same as the Profit &amp; loss in your books{can(ctx, 'accounting.view') ? <> (<Link href="/app/accounting/profit-loss" className="font-semibold text-accent-strong">see Profit &amp; loss</Link>)</> : null}.</p>

      {manage && (
        <div className="grid gap-3 md:grid-cols-2">
          <Card>
            <h2 className="text-lg font-bold">Enter a month by hand</h2>
            <p className="mt-1 text-sm text-muted">For months your accountant closed. Leave profit blank to go back to the formula.</p>
            <ActionForm action={saveProfitMonth} className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Month" htmlFor="pm-month"><Input id="pm-month" name="month" type="month" max={today.slice(0, 7)} required /></Field>
              <Field label="Profit" htmlFor="pm-profit"><Input id="pm-profit" name="profit" inputMode="decimal" className="num" placeholder="12500.00" /></Field>
              <div className="sm:col-span-2"><Field label="Note (optional)" htmlFor="pm-note"><Input id="pm-note" name="note" maxLength={300} /></Field></div>
              <div><SubmitButton>Save month</SubmitButton></div>
            </ActionForm>
          </Card>
          <Card>
            <h2 className="text-lg font-bold">Import profit by month</h2>
            <p className="mt-1 text-sm text-muted">A CSV with <b>Month</b> and <b>Profit</b> columns (Note optional). Nothing is saved if any line has a problem.</p>
            <ActionForm action={importProfit} className="mt-3 flex flex-col gap-3">
              <Field label="CSV file" htmlFor="pi-file"><Input id="pi-file" name="file" type="file" accept=".csv,text/csv,text/plain" /></Field>
              <Field label="Or paste it" htmlFor="pi-text"><Textarea id="pi-text" name="text" rows={3} placeholder={'Month,Profit\nOct 2026,12500.00'} /></Field>
              <div><SubmitButton>Import</SubmitButton></div>
            </ActionForm>
          </Card>
        </div>
      )}
    </>
  );
}
