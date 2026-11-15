import type { Metadata } from 'next';
import { can, getOrgContext, getSupabase } from '@/lib/auth/context';
import { Card, Field, Notice, Select } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';
import { PrintButton } from '@/components/print-button';
import { formatMoney } from '@/lib/billing/plans';
import { splitByPct, yearSummary } from '@/lib/profit/partners';
import { fmtDate } from '../../bills/format';
import { ProfitTabs } from '../tabs';
import { loadProfitYear } from '../_data';

export const metadata: Metadata = { title: 'Profit report' };
const mon = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long' });

/** #104 Printable profit report for a year (the owner's "investor report"), or one partner's statement. Print or save as PDF from the browser. */
export default async function ReportPage({ searchParams }: PageProps<'/app/profit/report'>) {
  const ctx = await getOrgContext();
  if (!can(ctx, 'profit.view')) return <Notice tone="warning">You don’t have access to profit.</Notice>;
  const sp = await searchParams;
  const thisYear = new Date().getUTCFullYear();
  const year = typeof sp.y === 'string' && /^\d{4}$/.test(sp.y) && +sp.y >= 2000 && +sp.y <= thisYear ? +sp.y : thisYear;
  const supabase = await getSupabase();
  const [{ months, today }, { data: ps }, { data: ds }, { data: ss }, { data: pays }] = await Promise.all([
    loadProfitYear(ctx, year),
    supabase.from('partners').select('id, name, pct, is_active').eq('organization_id', ctx.org.id).order('sort'),
    supabase.from('distributions').select('id, dist_date, total_cents').eq('organization_id', ctx.org.id).gte('dist_date', `${year}-01-01`).lte('dist_date', `${year}-12-31`).limit(1000),
    supabase.from('distribution_shares').select('id, distribution_id, partner_id, share_cents').eq('organization_id', ctx.org.id).limit(1000),
    supabase.from('distribution_payments').select('share_id, paid_on, amount_cents, method, reference').eq('organization_id', ctx.org.id).limit(1000),
  ]);
  const partners = (ps ?? []).map((p) => ({ id: p.id as string, name: p.name as string, pct: Number(p.pct), active: p.is_active as boolean }));
  const one = partners.find((p) => p.id === sp.partner) ?? null;
  const sum = yearSummary(months);
  const sales = months.reduce((a, m) => a + (m.sales ?? 0) + m.tax, 0), bills = months.reduce((a, m) => a + m.bills, 0), payroll = months.reduce((a, m) => a + m.payroll, 0);
  const distIds = new Set((ds ?? []).map((d) => d.id as string));
  const yearShares = (ss ?? []).filter((s) => distIds.has(s.distribution_id as string));
  const paidBy = new Map<string, number>();
  for (const p of pays ?? []) paidBy.set(p.share_id as string, (paidBy.get(p.share_id as string) ?? 0) + Number(p.amount_cents));
  const split = splitByPct(sum.total, partners.filter((p) => p.active));
  const perPartner = partners.map((p) => {
    const mine = yearShares.filter((s) => s.partner_id === p.id);
    return { ...p, ofProfit: split.find((x) => x.id === p.id)?.share ?? null, distributed: mine.reduce((a, s) => a + Number(s.share_cents), 0), paid: mine.reduce((a, s) => a + (paidBy.get(s.id as string) ?? 0), 0) };
  }).filter((p) => !one || p.id === one.id);
  const myPayments = one ? (pays ?? []).filter((p) => yearShares.some((s) => s.id === p.share_id && s.partner_id === one.id)).sort((a, b) => String(a.paid_on).localeCompare(String(b.paid_on))) : [];

  return (
    <>
      <ProfitTabs active="/app/profit/report" />
      <form action="/app/profit/report" className="no-print flex flex-wrap items-end gap-2">
        <Field label="Year" htmlFor="r-y"><Select id="r-y" name="y" defaultValue={String(year)}>{[0, 1, 2, 3].map((i) => <option key={i} value={thisYear - i}>{thisYear - i}</option>)}</Select></Field>
        <Field label="For" htmlFor="r-p"><Select id="r-p" name="partner" defaultValue={one?.id ?? ''}><option value="">Whole business</option>{partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
        <SubmitButton variant="secondary">Show</SubmitButton>
        <PrintButton label="Print or save as PDF" />
      </form>
      <Card className="flex flex-col gap-4">
        <header>
          <p className="text-[11px] font-bold uppercase tracking-[.08em] text-muted">{ctx.org.name}</p>
          <h1 className="text-[24px] font-extrabold tracking-tight">{one ? `${one.name}: ${year} statement` : `${year} profit report`}</h1>
          <p className="text-sm text-muted">Prepared {fmtDate(today)}{year === +today.slice(0, 4) ? ' · this year so far; the current month is on pace' : ''}</p>
        </header>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[['Sales + tax', sales], ['Bills', bills], ['Payroll', payroll], ['Profit', sum.total]].map(([l, v]) => (
            <div key={l as string} className="rounded-xl bg-soft p-3"><p className="text-[11px] font-bold uppercase tracking-[.08em] text-muted">{l}</p><p className="num text-[19px] font-medium">{formatMoney(v as number)}</p></div>
          ))}
        </div>
        {!one && (
          <table className="w-full text-[14px]">
            <thead className="text-start text-xs uppercase tracking-[.06em] text-muted"><tr><th className="py-1.5">Month</th><th className="text-end">Sales + tax</th><th className="text-end">Bills</th><th className="text-end">Payroll</th><th className="text-end">Profit</th></tr></thead>
            <tbody>
              {months.map((m) => (
                <tr key={m.ym} className="border-t border-line">
                  <td className="py-1.5">{mon(m.ym)}{m.projected ? ' (on pace)' : m.manual !== null ? ' (by hand)' : ''}</td>
                  <td className="num text-end">{m.sales === null ? '—' : formatMoney(m.sales + m.tax)}</td>
                  <td className="num text-end">{formatMoney(m.bills)}</td><td className="num text-end">{formatMoney(m.payroll)}</td>
                  <td className="num text-end font-semibold">{m.profit === null ? '—' : formatMoney(m.profit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {perPartner.length > 0 && (
          <table className="w-full text-[14px]">
            <thead className="text-start text-xs uppercase tracking-[.06em] text-muted"><tr><th className="py-1.5">Partner</th><th className="text-end">Share</th><th className="text-end">Share of profit</th><th className="text-end">Distributed</th><th className="text-end">Paid</th></tr></thead>
            <tbody>
              {perPartner.map((p) => (
                <tr key={p.id} className="border-t border-line">
                  <td className="py-1.5">{p.name}</td><td className="num text-end">{p.pct.toFixed(2)}%</td>
                  <td className="num text-end">{p.ofProfit === null ? '—' : formatMoney(p.ofProfit)}</td>
                  <td className="num text-end">{formatMoney(p.distributed)}</td><td className="num text-end">{formatMoney(p.paid)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {one && myPayments.length > 0 && (
          <table className="w-full text-[14px]">
            <thead className="text-start text-xs uppercase tracking-[.06em] text-muted"><tr><th className="py-1.5">Paid on</th><th>How</th><th>Reference</th><th className="text-end">Amount</th></tr></thead>
            <tbody>{myPayments.map((p, i) => <tr key={i} className="border-t border-line"><td className="py-1.5">{fmtDate(String(p.paid_on))}</td><td className="capitalize">{String(p.method)}</td><td>{p.reference ?? ''}</td><td className="num text-end">{formatMoney(Number(p.amount_cents))}</td></tr>)}</tbody>
          </table>
        )}
        <p className="text-xs text-muted">Profit here is cash-basis: sales + tax, plus or minus balances with other stores, less bills due in the month (including stock purchases) and payroll. It is not an audited net income. Share of profit splits the year’s profit by each active partner’s %.</p>
      </Card>
    </>
  );
}
