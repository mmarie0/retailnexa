import type { Metadata } from 'next';
import Link from 'next/link';
import { can, getOrgContext, getSupabase } from '@/lib/auth/context';
import { Card, EmptyState, Input, Notice, PageHeader, buttonClass, cx } from '@/components/ui';
import { formatMoney } from '@/lib/billing/plans';
import { AGING_BUCKETS, agingReport, openAsOf } from '@/lib/accounting/aging';
import { todayIn } from '@/lib/time';

export const metadata: Metadata = { title: 'Bills aging' };
const LABEL: Record<string, string> = { current: 'Not yet due', '1-30': '1–30 days late', '31-60': '31–60', '61-90': '61–90', '90+': 'Over 90' };

export default async function AgingPage({ searchParams }: PageProps<'/app/bills/aging'>) {
  const ctx = await getOrgContext();
  if (!can(ctx, 'bills.view')) return <Notice tone="warning">You don’t have access to bills.</Notice>;
  const sp = await searchParams;
  const supabase = await getSupabase();
  const [{ data: bills }, { data: vendors }, { data: orgRow }, { data: payments }, { data: voids }] = await Promise.all([
    supabase.from('bills').select('id, vendor_id, bill_date, due_date, total_cents, status, journal_entry_id, voided_at')
      .eq('organization_id', ctx.org.id).not('journal_entry_id', 'is', null).limit(5000),
    supabase.from('vendors').select('id, name').eq('organization_id', ctx.org.id),
    supabase.from('organizations').select('timezone').eq('id', ctx.org.id).maybeSingle(),
    supabase.from('bill_payments').select('id, bill_id, paid_on, amount_cents').eq('organization_id', ctx.org.id).limit(20000),
    supabase.from('bill_payment_voids').select('payment_id').eq('organization_id', ctx.org.id),
  ]);
  const asOf = typeof sp.as_of === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(sp.as_of) ? sp.as_of : todayIn(orgRow?.timezone);
  const names = new Map((vendors ?? []).map((v) => [v.id, v.name]));
  const voidedPayments = new Set((voids ?? []).map((v) => v.payment_id));
  const paysByBill = new Map<string, { paidOn: string; amountCents: number; voided: boolean }[]>();
  for (const p of payments ?? []) {
    paysByBill.set(p.bill_id, [...(paysByBill.get(p.bill_id) ?? []), { paidOn: p.paid_on, amountCents: Number(p.amount_cents), voided: voidedPayments.has(p.id) }]);
  }
  // A voided bill's reversal is posted on the later of its bill date and the business-local day it was voided (#59).
  const voidedOn = (b: { bill_date: string; voided_at: string | null }) =>
    b.voided_at ? [b.bill_date, todayIn(orgRow?.timezone, Date.parse(b.voided_at))].sort()[1] : null;
  const report = agingReport((bills ?? []).map((b) => ({
    vendorId: b.vendor_id, vendorName: names.get(b.vendor_id) ?? 'Vendor', dueDate: b.due_date,
    openCents: openAsOf({ billDate: b.bill_date, totalCents: Number(b.total_cents), posted: true,
      voidedOn: b.status === 'void' ? voidedOn(b) : null, payments: paysByBill.get(b.id) ?? [] }, asOf),
  })), asOf);
  const late = report.total - report.totals.current;

  return (
    <>
      <PageHeader title="Bills aging" description="What you owed each vendor at the end of the chosen day, grouped by how late it was. Matches Accounts payable on the balance sheet for that date."
        actions={<Link href="/app/bills/list" className="font-semibold text-accent-strong">All bills</Link>} />
      <form className="flex items-end gap-2">
        <label className="flex flex-col gap-1 text-sm font-semibold">As of<Input type="date" name="as_of" defaultValue={asOf} className="w-auto" /></label>
        <button className={buttonClass('secondary')}>Show</button>
      </form>
      {report.rows.length === 0 ? <EmptyState title="Nothing owed">No approved bills are waiting to be paid.</EmptyState> : (
        <>
          <p className="text-[15px]">Owed <strong className="num">{formatMoney(report.total)}</strong>
            {late > 0 && <>, of which <strong className="num text-late">{formatMoney(late)}</strong> is past due</>}.</p>
          <Card className="overflow-x-auto p-0">
            <table className="w-full min-w-[720px] text-[15px]">
              <thead className="text-left text-sm text-muted">
                <tr><th className="px-5 py-3 font-semibold">Vendor</th>
                  {AGING_BUCKETS.map((k) => <th key={k} className="px-3 text-right font-semibold">{LABEL[k]}</th>)}
                  <th className="px-5 text-right font-semibold">Total</th></tr>
              </thead>
              <tbody>
                {report.rows.map((r) => (
                  <tr key={r.vendorId} className="border-t border-line">
                    <td className="px-5 py-2.5 font-semibold">{r.vendorName}</td>
                    {AGING_BUCKETS.map((k) => (
                      <td key={k} className={cx('num px-3 text-right', k !== 'current' && r.buckets[k] > 0 && 'text-late')}>{r.buckets[k] ? formatMoney(r.buckets[k]) : '—'}</td>
                    ))}
                    <td className="num px-5 text-right font-semibold">{formatMoney(r.total)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-ink/20 font-bold">
                  <td className="px-5 py-3">Total</td>
                  {AGING_BUCKETS.map((k) => <td key={k} className="num px-3 text-right">{formatMoney(report.totals[k])}</td>)}
                  <td className="num px-5 text-right">{formatMoney(report.total)}</td>
                </tr>
              </tbody>
            </table>
          </Card>
        </>
      )}
    </>
  );
}
