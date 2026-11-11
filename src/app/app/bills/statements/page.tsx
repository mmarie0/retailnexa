import type { Metadata } from 'next';
import Link from 'next/link';
import { can, getOrgContext, getSupabase } from '@/lib/auth/context';
import { ActionForm } from '@/components/action-form';
import { Card, EmptyState, Field, Input, Notice, PageHeader, Select, Textarea } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';
import { formatMoney } from '@/lib/billing/plans';
import { todayIn } from '@/lib/time';
import { fmtDate } from '../format';
import { ReadOnlyNotice } from '../../read-only-notice';
import { createStatement } from './actions';

export const metadata: Metadata = { title: 'Vendor statements' };

/** #110 Vendor statements: import a statement, then match it against your bills. */
export default async function StatementsPage() {
  const ctx = await getOrgContext();
  if (!can(ctx, 'bills.view')) return <Notice tone="warning">You don’t have access to bills.</Notice>;
  const sb = await getSupabase();
  const [{ data: tz }, { data: seesAll }, { data: stmts }, { data: vendors }, { data: lines }] = await Promise.all([
    sb.from('organizations').select('timezone').eq('id', ctx.org.id).maybeSingle(),
    sb.rpc('sees_all_stores', { p_org: ctx.org.id }),
    sb.from('vendor_statements').select('id, vendor_id, statement_date, note').eq('organization_id', ctx.org.id).order('statement_date', { ascending: false }).limit(200),
    sb.from('vendors').select('id, name').eq('organization_id', ctx.org.id).order('name').limit(1000),
    sb.from('vendor_statement_lines').select('statement_id, amount_cents').eq('organization_id', ctx.org.id).limit(1000),
  ]);
  if (seesAll !== true) return <Notice tone="warning">Vendor statements list every store’s invoices, so only people who see every store can open them.</Notice>;
  const today = todayIn(tz?.timezone);
  const vName = new Map((vendors ?? []).map((v) => [v.id as string, v.name as string]));
  const total = new Map<string, { n: number; cents: number }>();
  for (const l of lines ?? []) { const t = total.get(l.statement_id as string) ?? { n: 0, cents: 0 }; t.n++; t.cents += Number(l.amount_cents); total.set(l.statement_id as string, t); }
  const canAdd = can(ctx, 'bills.create') && ctx.access.canWrite;
  return (
    <>
      <PageHeader title="Vendor statements" description="Bring in a vendor’s statement and see which invoices you have, which amounts differ and which are missing." />
      <ReadOnlyNotice show={can(ctx, 'bills.create') && !ctx.access.canWrite} />
      {(stmts ?? []).length === 0 ? <EmptyState title="No statements yet">{canAdd ? 'Import one below.' : null}</EmptyState> : (
        <ul className="flex flex-col gap-2">
          {(stmts ?? []).map((s) => (
            <li key={s.id}>
              <Link href={`/app/bills/statements/${s.id}`} className="flex items-center justify-between gap-3 rounded-[16px] bg-card px-4 py-3 shadow-[var(--shadow-card)] hover:opacity-90">
                <span className="min-w-0"><span className="block font-semibold">{vName.get(s.vendor_id as string) ?? 'Vendor'}</span><span className="text-sm text-muted">{fmtDate(s.statement_date as string)} · {total.get(s.id as string)?.n ?? 0} lines{s.note ? ` · ${s.note}` : ''}</span></span>
                <span className="num font-medium">{formatMoney(total.get(s.id as string)?.cents ?? 0)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {canAdd && (
        <Card id="add">
          <h2 className="text-lg font-bold">Import a statement</h2>
          <p className="mt-1 text-sm text-muted">A CSV with <b>Date</b>, <b>Invoice #</b> and <b>Amount</b> columns (or Charges and Credits). Payments and credits can be negative or in parentheses. Reading PDFs and photos needs AI, which is off for now.</p>
          <ActionForm action={createStatement} className="mt-3 grid gap-3 sm:grid-cols-3">
            <Field label="Vendor" htmlFor="st-v"><Select id="st-v" name="vendor_id" required defaultValue=""><option value="">Choose…</option>{(vendors ?? []).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</Select></Field>
            <Field label="Statement date" htmlFor="st-d"><Input id="st-d" name="statement_date" type="date" defaultValue={today} required /></Field>
            <Field label="Note (optional)" htmlFor="st-n"><Input id="st-n" name="note" maxLength={300} /></Field>
            <Field label="CSV file" htmlFor="st-f"><Input id="st-f" name="file" type="file" accept=".csv,text/csv,text/plain" /></Field>
            <div className="sm:col-span-2"><Field label="Or paste the rows" htmlFor="st-t"><Textarea id="st-t" name="text" rows={4} placeholder={'Date,Invoice #,Amount\n10/02/2026,INV-123,500.00'} /></Field></div>
            <div className="sm:col-span-3"><SubmitButton>Import and match</SubmitButton></div>
          </ActionForm>
        </Card>
      )}
    </>
  );
}
