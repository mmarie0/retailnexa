import type { Metadata } from 'next';
import { can, getOrgContext, getSupabase } from '@/lib/auth/context';
import { Card, Input, Notice, PageHeader, buttonClass } from '@/components/ui';
import { formatMoney } from '@/lib/billing/plans';
import { balanceSheet, type LedgerRow } from '@/lib/accounting/statements';
import { todayIn } from '@/lib/time';
import { AccountingTabs } from '../nav';
import { StatementSection, TotalRow } from '../statement-ui';

export const metadata: Metadata = { title: 'Balance sheet' };

export default async function BalanceSheetPage({ searchParams }: PageProps<'/app/accounting/balance-sheet'>) {
  const ctx = await getOrgContext();
  if (!can(ctx, 'accounting.view')) return <Notice tone="warning">Only owners, admins and accountants can see the books.</Notice>;
  const sp = await searchParams;
  const supabase = await getSupabase();
  const { data: orgRow } = await supabase.from('organizations').select('timezone').eq('id', ctx.org.id).maybeSingle();
  const asOf = typeof sp.as_of === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(sp.as_of) ? sp.as_of : todayIn(orgRow?.timezone);
  const { data, error } = await supabase.rpc('trial_balance', { p_org: ctx.org.id, p_as_of: asOf });
  if (error) return <Notice tone="danger">The balance sheet couldn’t be loaded. Try again.</Notice>;
  const rows: LedgerRow[] = ((data ?? []) as { account_id: string; code: string; name: string; type: LedgerRow['type']; balance_cents: number }[])
    .map((r) => ({ id: r.account_id, code: r.code, name: r.name, type: r.type, role: null, net: Number(r.balance_cents) }));
  const b = balanceSheet(rows);
  const asOfLabel = new Date(`${asOf}T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' });

  return (
    <>
      <PageHeader title="Balance sheet" description={`What the business owns and owes as of ${asOfLabel}.`} />
      <AccountingTabs active="/app/accounting/balance-sheet" />
      <form className="flex items-end gap-2">
        <label className="flex flex-col gap-1 text-sm font-semibold">As of<Input type="date" name="as_of" defaultValue={asOf} className="w-auto" /></label>
        <button className={buttonClass('secondary')}>Show</button>
      </form>
      {!b.balanced && (
        <Notice tone="danger">Assets ({formatMoney(b.assets.total)}) don’t equal liabilities plus equity ({formatMoney(b.totalLiabilitiesAndEquity)}). This should never happen — contact support.</Notice>
      )}
      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[420px] text-[15px]">
          <caption className="sr-only">Balance sheet</caption>
          <StatementSection section={b.assets} totalLabel="Total assets" />
          <StatementSection section={b.liabilities} totalLabel="Total liabilities" />
          <StatementSection section={b.equity} totalLabel="Total equity" />
          <TotalRow label="Liabilities + equity" cents={b.totalLiabilitiesAndEquity} strong />
        </table>
      </Card>
    </>
  );
}
