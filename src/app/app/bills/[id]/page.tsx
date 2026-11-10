import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { randomUUID } from 'node:crypto';
import { can, getOrgContext, getSupabase } from '@/lib/auth/context';
import { ActionForm } from '@/components/action-form';
import { Badge, Card, Field, Input, Notice, PageHeader, Select } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';
import { formatMoney } from '@/lib/billing/plans';
import { centsToInput } from '@/lib/money';
import { todayIn } from '@/lib/time';
import { approveBill, recordBillPayment, voidBill, voidBillPayment } from '../actions';
import { STATUS_LABEL, STATUS_TONE, daysOverdue, fmtDate, type BillStatus } from '../format';

export const metadata: Metadata = { title: 'Bill' };

const SOURCE_LABEL: Record<string, string> = { bank: 'Bank account', cash_on_hand: 'Cash on hand' };

export default async function BillPage({ params }: PageProps<'/app/bills/[id]'>) {
  const ctx = await getOrgContext();
  if (!can(ctx, 'bills.view')) return <Notice tone="warning">You don’t have access to bills.</Notice>;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await getSupabase();
  const { data: bill } = await supabase.from('bills')
    .select('id, vendor_id, location_id, bill_number, bill_date, due_date, memo, status, total_cents, paid_cents, journal_entry_id, approved_at, void_reason')
    .eq('organization_id', ctx.org.id).eq('id', id).maybeSingle();
  if (!bill) notFound();
  const [{ data: vendor }, { data: lines }, { data: payments }, { data: accounts }, { data: orgRow }, { data: voids }, { data: store }] = await Promise.all([
    supabase.from('vendors').select('name').eq('id', bill.vendor_id).maybeSingle(),
    supabase.from('bill_lines').select('id, account_id, description, amount_cents').eq('bill_id', id).order('id'),
    supabase.from('bill_payments').select('id, paid_on, amount_cents, source, reference').eq('bill_id', id).order('paid_on'),
    supabase.rpc('bill_account_options', { p_org: ctx.org.id }),
    supabase.from('organizations').select('timezone').eq('id', ctx.org.id).maybeSingle(),
    supabase.from('bill_payment_voids').select('payment_id, reason').eq('organization_id', ctx.org.id),
    bill.location_id ? supabase.from('locations').select('name').eq('id', bill.location_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const voided = new Map((voids ?? []).map((v) => [v.payment_id, v.reason]));
  const acct = new Map(((accounts ?? []) as { id: string; code: string; name: string }[]).map((a) => [a.id, a]));
  const status = bill.status as BillStatus;
  const total = Number(bill.total_cents);
  const open = total - Number(bill.paid_cents);
  const today = todayIn(orgRow?.timezone);
  const late = status === 'approved' ? daysOverdue(bill.due_date, today) : 0;
  const writable = ctx.access.canWrite;
  const canApprove = can(ctx, 'bills.approve') && writable;
  const canPay = can(ctx, 'bills.pay') && writable;

  return (
    <>
      <PageHeader title={`${vendor?.name ?? 'Vendor'} · ${bill.bill_number}`}
        description={`Billed ${fmtDate(bill.bill_date)} · due ${fmtDate(bill.due_date)}`}
        actions={<Link href="/app/bills/list" className="font-semibold text-accent-strong">All bills</Link>} />
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>
        <Badge>{store?.name ?? 'Whole business'}</Badge>
        {late > 0 && <Badge tone="danger">{late} days overdue</Badge>}
        {bill.journal_entry_id && can(ctx, 'accounting.view') && <Link href="/app/accounting/journal" className="text-sm font-semibold text-accent-strong">Posted to the journal</Link>}
      </div>
      {status === 'void' && bill.void_reason && <Notice tone="warning">Voided: {bill.void_reason}</Notice>}
      {bill.memo && <p className="text-muted">{bill.memo}</p>}

      <Card className="p-0">
        <table className="w-full text-[15px]">
          <thead className="text-left text-sm text-muted"><tr><th className="px-5 py-3 font-semibold">Account</th><th className="px-3 font-semibold">Description</th><th className="px-5 text-right font-semibold">Amount</th></tr></thead>
          <tbody>
            {(lines ?? []).map((l) => {
              const a = acct.get(l.account_id);
              return (
                <tr key={l.id} className="border-t border-line">
                  <td className="px-5 py-2"><span className="num mr-2 text-muted">{a?.code}</span>{a?.name ?? 'Account'}</td>
                  <td className="px-3 text-muted">{l.description}</td>
                  <td className="num px-5 text-right">{formatMoney(Number(l.amount_cents))}</td>
                </tr>
              );
            })}
            <tr className="border-t border-line font-bold"><td className="px-5 py-2.5" colSpan={2}>Total</td><td className="num px-5 text-right">{formatMoney(total)}</td></tr>
            {Number(bill.paid_cents) > 0 && <tr className="border-t border-line"><td className="px-5 py-2" colSpan={2}>Still owed</td><td className="num px-5 text-right font-semibold">{formatMoney(open)}</td></tr>}
          </tbody>
        </table>
      </Card>

      {(payments ?? []).length > 0 && (
        <Card>
          <h2 className="mb-3 text-lg font-bold">Payments</h2>
          <ul className="divide-y divide-line">
            {(payments ?? []).map((p) => (
              <li key={p.id} className="py-2">
                <div className="flex flex-wrap justify-between gap-2">
                  <span className={voided.has(p.id) ? 'text-muted line-through' : ''}>{fmtDate(p.paid_on)} · {SOURCE_LABEL[p.source] ?? p.source}{p.reference ? ` · ${p.reference}` : ''}</span>
                  <span className="flex items-center gap-2">{voided.has(p.id) && <Badge tone="warning">Voided</Badge>}<span className="num font-semibold">{formatMoney(Number(p.amount_cents))}</span></span>
                </div>
                {voided.has(p.id) && <p className="text-sm text-muted">Voided: {voided.get(p.id)}</p>}
                {!voided.has(p.id) && canPay && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-sm font-semibold text-late">Void this payment</summary>
                    <ActionForm action={voidBillPayment} className="mt-2 flex flex-wrap items-end gap-2">
                      <input type="hidden" name="payment" value={p.id} /><input type="hidden" name="bill" value={bill.id} />
                      <Field label="Reason" htmlFor={`vp-${p.id}`}><Input id={`vp-${p.id}`} name="reason" required minLength={3} maxLength={500} className="w-72" /></Field>
                      <SubmitButton size="sm" variant="danger" pendingText="Voiding…">Void payment</SubmitButton>
                    </ActionForm>
                  </details>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {status === 'draft' && canApprove && (
        <Card>
          <h2 className="text-lg font-bold">Approve</h2>
          <p className="mt-1 text-muted">Posts {formatMoney(total)} to the books (expenses or inventory up, accounts payable up), dated {fmtDate(bill.bill_date)}.</p>
          <ActionForm action={approveBill} className="mt-3 flex flex-col gap-3">
            <input type="hidden" name="id" value={bill.id} />
            <SubmitButton className="self-start" pendingText="Approving…">Approve bill</SubmitButton>
          </ActionForm>
        </Card>
      )}
      {status === 'draft' && !canApprove && <Notice tone="info">Waiting for an owner, admin or accountant to approve.</Notice>}

      {status === 'approved' && canPay && (
        <Card>
          <h2 className="mb-3 text-lg font-bold">Record a payment</h2>
          {/* Remount after each payment so the next one gets a fresh one-time key (#46). */}
          <ActionForm key={`pay-${bill.paid_cents}`} action={recordBillPayment} className="flex flex-col gap-3">
            <input type="hidden" name="id" value={bill.id} />
            <input type="hidden" name="idempotency_key" value={randomUUID()} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Amount" htmlFor="amount"><Input id="amount" name="amount" inputMode="decimal" defaultValue={centsToInput(open)} className="num w-full" required /></Field>
              <Field label="Paid on" htmlFor="paid_on"><Input id="paid_on" name="paid_on" type="date" defaultValue={today} min={bill.bill_date} required /></Field>
              <Field label="Paid from" htmlFor="source">
                <Select id="source" name="source" defaultValue="bank"><option value="bank">Bank account</option><option value="cash_on_hand">Cash on hand</option></Select>
              </Field>
              <Field label="Reference" htmlFor="reference" hint="Check number or transfer ID (optional)."><Input id="reference" name="reference" maxLength={100} /></Field>
            </div>
            <SubmitButton className="self-start" pendingText="Recording…">Record payment</SubmitButton>
          </ActionForm>
        </Card>
      )}

      {(status === 'draft' || (status === 'approved' && Number(bill.paid_cents) === 0)) && canApprove && (
        <Card>
          <details>
            <summary className="cursor-pointer font-semibold text-late">Void this bill</summary>
            <p className="mt-2 text-muted">{status === 'approved' ? 'A reversing entry will be posted so the books net to zero.' : 'The draft is kept for the record but marked void.'}</p>
            <ActionForm action={voidBill} className="mt-3 flex flex-col gap-3">
              <input type="hidden" name="id" value={bill.id} />
              <Field label="Reason" htmlFor="reason"><Input id="reason" name="reason" required minLength={3} maxLength={500} /></Field>
              <SubmitButton className="self-start" variant="danger" pendingText="Voiding…">Void bill</SubmitButton>
            </ActionForm>
          </details>
        </Card>
      )}
    </>
  );
}
