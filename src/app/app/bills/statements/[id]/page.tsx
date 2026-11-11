import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { can, getOrgContext, getSupabase } from '@/lib/auth/context';
import { ActionForm } from '@/components/action-form';
import { Badge, Card, Eyebrow, Field, Notice, Select, cx } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';
import { formatMoney } from '@/lib/billing/plans';
import { matchStatement, notOnStatement, type BillLite, type LineStatus, type StatementLine } from '@/lib/bills/statements';
import { fmtDate } from '../../format';
import { Stat } from '../../../_dashboard/tiles';
import { addMissingBills, deleteStatement, setLine } from '../actions';

export const metadata: Metadata = { title: 'Vendor statement' };
const STATUS: Record<LineStatus, [Parameters<typeof Badge>[0]['tone'], string]> = {
  matched: ['good', 'Matched'], amount_differs: ['warning', 'Amount differs'], missing: ['danger', 'No bill'], credit: ['neutral', 'Credit / payment'], set_aside: ['neutral', 'Set aside'],
};

/** #110 One statement matched against the vendor's bills. */
export default async function StatementPage({ params }: PageProps<'/app/bills/statements/[id]'>) {
  const { id } = await params;
  const ctx = await getOrgContext();
  if (!can(ctx, 'bills.view')) return <Notice tone="warning">You don’t have access to bills.</Notice>;
  const sb = await getSupabase();
  const { data: stmt } = await sb.from('vendor_statements').select('id, vendor_id, statement_date, note').eq('organization_id', ctx.org.id).eq('id', id).maybeSingle();
  if (!stmt) notFound();
  const [{ data: vendor }, { data: rows }, { data: bills }, { data: accounts }] = await Promise.all([
    sb.from('vendors').select('name, default_account_id').eq('id', stmt.vendor_id).maybeSingle(),
    sb.from('vendor_statement_lines').select('id, line_date, reference, description, amount_cents, bill_id, dismissed').eq('statement_id', id).order('line_date').order('id').limit(500),
    sb.from('bills').select('id, bill_number, bill_date, total_cents, status').eq('organization_id', ctx.org.id).eq('vendor_id', stmt.vendor_id).order('bill_date', { ascending: false }).limit(1000),
    sb.rpc('bill_account_options', { p_org: ctx.org.id }),
  ]);
  const lines = (rows ?? []) as StatementLine[];
  const all = (bills ?? []) as BillLite[];
  const r = matchStatement(lines, all);
  const dates = lines.map((l) => l.line_date).filter(Boolean).sort() as string[];
  const extra = notOnStatement(r.lines, all, dates[0] ?? null, stmt.statement_date as string);
  const canEdit = can(ctx, 'bills.create') && ctx.access.canWrite;
  const accts = (accounts ?? []) as { id: string; code: string; name: string }[];
  const openBills = all.filter((b) => b.status !== 'void');

  return (
    <>
      <Link href="/app/bills/statements" className="text-sm font-semibold text-accent-strong">‹ Vendor statements</Link>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-[24px] font-extrabold tracking-tight">{vendor?.name ?? 'Vendor'} · {fmtDate(stmt.statement_date as string)}</h1>
        {stmt.note && <span className="text-sm text-muted">{stmt.note}</span>}
      </div>
      <div className="grid grid-cols-3 gap-3 max-[520px]:grid-cols-1">
        <Stat block="blue" label="Statement total" value={formatMoney(r.totals.statement)} sub={`${lines.length} lines`} />
        <Stat label="No bill" value={String(r.missing.length)} tone={r.missing.length ? 'late' : undefined} sub={r.missing.length ? `${formatMoney(r.totals.missing)} not in your bills` : 'Every invoice is in'} />
        <Stat label="Amounts differ" value={String(r.differs.length)} sub={r.differs.length ? 'Check these with the vendor' : 'All match'} />
      </div>

      {canEdit && r.missing.some((m) => m.amount_cents > 0) && (
        <Card>
          <h2 className="text-lg font-bold">Add the missing invoices as bills</h2>
          <p className="mt-1 text-sm text-muted">Each becomes a draft bill for {vendor?.name ?? 'this vendor'} with the statement’s invoice number, date and amount, due by the vendor’s terms. You approve them as usual.</p>
          <ActionForm action={addMissingBills} className="mt-3 flex flex-wrap items-end gap-3">
            <input type="hidden" name="statement_id" value={id} />
            {r.missing.filter((m) => m.amount_cents > 0).map((m) => <input key={m.id} type="hidden" name="line_id" value={m.id} />)}
            <Field label="Account" htmlFor="mb-acct"><Select id="mb-acct" name="account_id" defaultValue={(vendor?.default_account_id as string | null) ?? ''} required><option value="">Choose…</option>{accts.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}</Select></Field>
            <SubmitButton>Add all {r.missing.filter((m) => m.amount_cents > 0).length}</SubmitButton>
          </ActionForm>
        </Card>
      )}

      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[640px] text-[14.5px]">
          <thead className="text-left text-xs uppercase tracking-[.06em] text-muted"><tr><th className="px-4 py-2.5">Date</th><th className="px-2">Invoice #</th><th className="px-2 text-right">Statement</th><th className="px-2">Your bill</th><th className="px-4">Status</th></tr></thead>
          <tbody>
            {r.lines.map((m) => (
              <tr key={m.id} className={cx('border-t border-line align-top', m.status === 'missing' && 'bg-late/5')}>
                <td className="px-4 py-2">{m.line_date ? fmtDate(m.line_date) : '—'}</td>
                <td className="px-2">{m.reference ?? '—'}{m.description ? <span className="block text-xs text-muted">{m.description}</span> : null}</td>
                <td className="num px-2 text-right">{formatMoney(m.amount_cents)}</td>
                <td className="px-2">{m.bill ? <Link href={`/app/bills/${m.bill.id}`} className="font-semibold text-accent-strong">#{m.bill.bill_number}</Link> : '—'}{m.bill ? <span className="num block text-xs text-muted">{formatMoney(Number(m.bill.total_cents))}{m.how === 'amount' ? ' · matched by amount' : m.how === 'linked' ? ' · picked by hand' : ''}</span> : null}</td>
                <td className="px-4">
                  <Badge tone={STATUS[m.status][0]}>{STATUS[m.status][1]}</Badge>
                  {canEdit && (
                    <details className="mt-1 text-sm">
                      <summary className="cursor-pointer text-muted">Change</summary>
                      <ActionForm action={setLine} className="mt-1 flex flex-col gap-1.5">
                        <input type="hidden" name="statement_id" value={id} /><input type="hidden" name="line_id" value={m.id} />
                        <Select name="bill_id" aria-label="Bill for this line" defaultValue={m.bill_id ?? ''}><option value="">No bill picked (match automatically)</option>{openBills.slice(0, 300).map((b) => <option key={b.id} value={b.id}>#{b.bill_number} · {fmtDate(b.bill_date)} · {formatMoney(Number(b.total_cents))}</option>)}</Select>
                        <label className="flex items-center gap-1.5"><input type="checkbox" name="dismissed" value="true" defaultChecked={m.dismissed} className="size-4 accent-[#3f63de]" />Set aside (no bill needed)</label>
                        <SubmitButton size="sm" variant="secondary">Save</SubmitButton>
                      </ActionForm>
                    </details>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {extra.length > 0 && (
        <Card>
          <Eyebrow>In your bills but not on this statement</Eyebrow>
          <ul className="mt-2 flex flex-col divide-y divide-line text-[15px]">
            {extra.slice(0, 50).map((b) => <li key={b.id} className="flex justify-between gap-2 py-1.5"><Link href={`/app/bills/${b.id}`} className="text-accent-strong">#{b.bill_number} · {fmtDate(b.bill_date)}</Link><span className="num">{formatMoney(Number(b.total_cents))}</span></li>)}
          </ul>
          <p className="mt-2 text-sm text-muted">These may already be paid, or entered twice. Ask the vendor if unsure.</p>
        </Card>
      )}
      {canEdit && (
        <ActionForm action={deleteStatement}><input type="hidden" name="id" value={id} /><SubmitButton variant="ghost" size="sm">Remove this statement</SubmitButton></ActionForm>
      )}
    </>
  );
}
