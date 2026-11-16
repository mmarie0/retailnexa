import type { Metadata } from 'next';
import { can, getOrgContext, getSupabase } from '@/lib/auth/context';
import { Card, Input, Notice, PageHeader, buttonClass } from '@/components/ui';
import { formatMoney } from '@/lib/billing/plans';
import { computeProfit } from '@/lib/finance/metrics';
import { todayIn } from '@/lib/time';
import { AccountingTabs, TYPE_LABEL, TYPE_ORDER } from '../nav';

export const metadata: Metadata = { title: 'Trial balance' };

type Row = { account_id: string; code: string; name: string; type: string; debit_cents: number; credit_cents: number; balance_cents: number };

export default async function TrialBalancePage({ searchParams }: PageProps<'/app/accounting/trial-balance'>) {
  const ctx = await getOrgContext();
  if (!can(ctx, 'accounting.view')) return <Notice tone="warning">Only owners, admins and accountants can see the books.</Notice>;
  const sp = await searchParams;
  const supabase = await getSupabase();
  const { data: orgRow } = await supabase.from('organizations').select('timezone').eq('id', ctx.org.id).maybeSingle();
  const asOf = typeof sp.as_of === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(sp.as_of) ? sp.as_of : todayIn(orgRow?.timezone);
  const { data, error } = await supabase.rpc('trial_balance', { p_org: ctx.org.id, p_as_of: asOf });
  if (error) return <Notice tone="danger">The trial balance couldn’t be loaded. Try again.</Notice>;
  const rows = ((data ?? []) as Row[]).map((r) => ({ ...r, debit_cents: Number(r.debit_cents), credit_cents: Number(r.credit_cents), balance_cents: Number(r.balance_cents) }));
  const active = rows.filter((r) => r.debit_cents || r.credit_cents);
  const totalD = rows.reduce((a, r) => a + Math.max(r.balance_cents, 0), 0);
  const totalC = rows.reduce((a, r) => a + Math.max(-r.balance_cents, 0), 0);

  // Profit figures straight from the ledger: revenue/income credit-normal, expenses debit-normal.
  const byCode = (codes: string[]) => rows.filter((r) => codes.includes(r.code)).reduce((a, r) => a + r.balance_cents, 0);
  const profit = computeProfit({
    netSalesCents: -byCode(['4000', '4100']),
    cogsCents: byCode(['5000']),
    operatingExpensesCents: { payroll: byCode(['6000']), rent: byCode(['6100']), utilities: byCode(['6200']), cardFees: byCode(['6300']), other: byCode(['6900', '5100']) },
    otherIncomeCents: -byCode(['4900']), otherExpensesCents: byCode(['7100']), interestCents: byCode(['7000']), taxesCents: byCode(['8000']),
  });

  return (
    <>
      <PageHeader title="Trial balance" description="Every account’s balance on a date. Debits always equal credits." />
      <AccountingTabs active="/app/accounting/trial-balance" />
      <form className="flex items-end gap-2">
        <label className="flex flex-col gap-1 text-sm font-semibold">As of<Input type="date" name="as_of" defaultValue={asOf} className="w-auto" /></label>
        <button className={buttonClass('secondary')}>Show</button>
      </form>
      {active.length === 0 ? (
        <Card><p className="text-muted">No activity up to this date yet.</p></Card>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[520px] text-[15px]">
            <thead className="bg-soft text-start text-sm text-muted"><tr><th className="px-5 py-2">Account</th><th className="px-3 text-end">Debit</th><th className="px-5 text-end">Credit</th></tr></thead>
            <tbody>
              {TYPE_ORDER.flatMap((t) => active.filter((r) => r.type === t).map((r, i) => (
                <tr key={r.account_id} className="border-t border-line">
                  <td className="px-5 py-1.5">{i === 0 && <span className="me-2 text-xs font-semibold text-muted">{TYPE_LABEL[t]}</span>}<span className="num me-2 text-muted">{r.code}</span>{r.name}</td>
                  <td className="num px-3 text-end">{r.balance_cents > 0 ? formatMoney(r.balance_cents) : ''}</td>
                  <td className="num px-5 text-end">{r.balance_cents < 0 ? formatMoney(-r.balance_cents) : ''}</td>
                </tr>
              )))}
            </tbody>
            <tfoot><tr className="border-t-2 border-ink font-bold"><td className="px-5 py-2">Total</td><td className="num px-3 text-end">{formatMoney(totalD)}</td><td className="num px-5 text-end">{formatMoney(totalC)}</td></tr></tfoot>
          </table>
        </Card>
      )}
      {totalD !== totalC && <Notice tone="danger">Debits and credits don’t match. This should never happen — contact support.</Notice>}
      <Card>
        <h2 className="text-lg font-bold">Profit to date (all time through {asOf})</h2>
        <dl className="mt-2 grid gap-1 text-[15px] sm:max-w-md">
          {[['Net sales', profit.netSalesCents], ['Gross profit', profit.grossProfitCents], ['Operating profit', profit.operatingProfitCents]].map(([k, v]) => (
            <div key={k as string} className="flex justify-between border-b border-line py-1"><dt>{k}</dt><dd className="num">{formatMoney(v as number)}</dd></div>
          ))}
          <div className="flex justify-between py-1 font-semibold"><dt>Net income</dt><dd className="num">{formatMoney(profit.netIncomeCents)}</dd></div>
        </dl>
        <p className="mt-2 text-sm text-muted">Taken from posted entries, so every expense recorded in the books is included. Period-by-period profit and loss arrives with the reports module.</p>
      </Card>
    </>
  );
}
