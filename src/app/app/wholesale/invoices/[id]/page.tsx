import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { can, getSupabase } from '@/lib/auth/context';
import { ActionForm } from '@/components/action-form';
import { Card, Field, Input, Select } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';
import { PrintButton } from '@/components/print-button';
import { centsToInput } from '@/lib/money';
import { DEPOSITABLE, PAY_METHODS, fmtQty, methodLabel, termsLabel, withBalances } from '@/lib/wholesale/ledger';
import { fmtDate } from '../../../bills/format';
import { loadCustomers, loadReceivables, loadSettings, wsContext } from '../../_data';
import { InvoiceBadge, money } from '../../_ui';
import { deletePayment, recordPayment, voidInvoice } from '../../actions';
import { getT } from '@/lib/i18n/server';

export const metadata: Metadata = { title: 'Invoice' };

/** A printable invoice with its payments, Record payment and Void. */
export default async function InvoicePage({ params }: PageProps<'/app/wholesale/invoices/[id]'>) {
  const t = await getT();
  const ctx = await wsContext();
  if (!can(ctx, 'wholesale.receivables.view')) notFound();
  const { id } = await params;
  const sb = await getSupabase();
  const [rec, customers, settings, { data: lines }, { data: org }] = await Promise.all([
    loadReceivables(ctx.org.id), loadCustomers(ctx.org.id), loadSettings(ctx.org.id),
    sb.from('customer_invoice_lines').select('id, sku, name, qty, price_cents').eq('invoice_id', id).eq('organization_id', ctx.org.id).order('line_no'),
    sb.from('organizations').select('name, legal_name, phone, website').eq('id', ctx.org.id).maybeSingle(),
  ]);
  const raw = rec.invoices.find((i) => i.id === id);
  if (!raw) notFound();
  const [i] = withBalances([raw], rec.payments, ctx.today);
  const pays = rec.payments.filter((p) => p.invoice_id === id).sort((a, b) => a.paid_on.localeCompare(b.paid_on));
  const c = customers.find((x) => x.id === i.customer_id);
  const manage = can(ctx, 'wholesale.receivables.manage') && ctx.access.canWrite;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link href="/app/wholesale/invoices" className="text-sm font-semibold text-accent-strong">{t('‹ Invoices')}</Link>
        <span className="flex items-center gap-2"><InvoiceBadge s={i.status} /><PrintButton label={t('Print / save PDF')} /></span>
      </div>
      <Card className="flex flex-col gap-4 print:shadow-none">
        <div className="flex flex-wrap justify-between gap-4">
          <div>
            <p className="text-xl font-extrabold">{org?.legal_name || org?.name}</p>
            <p className="text-sm text-muted">{[org?.phone, org?.website].filter(Boolean).join(' · ')}</p>
          </div>
          <div className="text-right">
            <p className="text-[11px] font-bold uppercase tracking-[.08em] text-muted">{t('Invoice')}</p>
            <p className="text-xl font-extrabold">{i.number}</p>
            <p className="text-sm text-muted">{fmtDate(i.invoice_date)} · {termsLabel(raw.terms)} {t('· due')} {fmtDate(i.due_date)}</p>
            {raw.customer_po && <p className="text-sm text-muted">{t('Your PO')} {raw.customer_po}</p>}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><p className="text-[11px] font-bold uppercase tracking-[.08em] text-muted">{t('Bill to')}</p><p className="font-semibold">{c?.name}</p><p className="whitespace-pre-line text-sm">{c?.address}</p></div>
          {c?.ship_address && <div><p className="text-[11px] font-bold uppercase tracking-[.08em] text-muted">{t('Ship to')}</p><p className="whitespace-pre-line text-sm">{c.ship_address}</p></div>}
        </div>
        <table className="w-full text-[15px]">
          <thead><tr className="border-b border-line text-left text-sm text-muted"><th className="py-1.5 font-semibold">{t('Item')}</th><th className="py-1.5 text-right font-semibold">{t('Qty')}</th><th className="py-1.5 text-right font-semibold">{t('Price')}</th><th className="py-1.5 text-right font-semibold">{t('Amount')}</th></tr></thead>
          <tbody>
            {(lines ?? []).map((l) => (
              <tr key={l.id} className="border-b border-soft align-top">
                <td className="py-1.5">{l.name}{l.sku && <span className="block text-xs text-muted">{l.sku}</span>}</td>
                <td className="num py-1.5 text-right">{fmtQty(Number(l.qty))}</td>
                <td className="num py-1.5 text-right">{money(Number(l.price_cents))}</td>
                <td className="num py-1.5 text-right">{money(Math.round(Number(l.qty) * Number(l.price_cents)))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <dl className="ml-auto grid w-full max-w-xs grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-[15px]">
          <dt className="text-muted">{t('Subtotal')}</dt><dd className="num text-right">{money(i.subtotal_cents)}</dd>
          {i.discount_cents > 0 && <><dt className="text-muted">{t('Discount')}</dt><dd className="num text-right">−{money(i.discount_cents)}</dd></>}
          {raw.shipping_cents > 0 && <><dt className="text-muted">{t('Shipping')}</dt><dd className="num text-right">{money(raw.shipping_cents)}</dd></>}
          <dt className="text-muted">{t('Tax (')}{raw.tax_rate}%)</dt><dd className="num text-right">{money(raw.tax_cents)}</dd>
          <dt className="font-bold">{t('Total')}</dt><dd className="num text-right font-bold">{money(i.total_cents)}</dd>
          {i.paid > 0 && <><dt className="text-muted">{t('Paid')}</dt><dd className="num text-right">−{money(i.paid)}</dd></>}
          {i.status !== 'void' && <><dt className="font-bold">{t('Balance due')}</dt><dd className="num text-right font-bold">{money(i.balance)}</dd></>}
        </dl>
        {raw.notes && <p className="whitespace-pre-line text-sm">{raw.notes}</p>}
        {settings.pay_instructions && <p className="whitespace-pre-line rounded-xl bg-soft p-3 text-sm"><span className="font-semibold">{t('How to pay:')} </span>{settings.pay_instructions}</p>}
        {i.status === 'void' && <p className="font-semibold text-late">{t('Void')}{raw.void_reason ? ` · ${raw.void_reason}` : ''}</p>}
      </Card>

      <Card className="flex flex-col gap-2 print:hidden">
        <h2 className="font-bold">{t('Payments')}</h2>
        {pays.length ? (
          <ul className="flex flex-col divide-y divide-soft text-[15px]">
            {pays.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                <span>{fmtDate(p.paid_on)} · {methodLabel(p.method)}{p.check_no ? ` #${p.check_no}` : ''}{p.bank ? ` · ${p.bank}` : ''}
                  <span className="block text-xs text-muted">{DEPOSITABLE.includes(p.method) ? (p.deposit_date ? t('Deposited {v0}', { v0: fmtDate(p.deposit_date) }) : t('Not deposited yet')) : ''}{p.expected_payment_id ? t(' · from payment plan') : ''}</span>
                </span>
                <span className="flex items-center gap-2"><span className="num font-semibold">{money(p.amount_cents)}</span>
                  {manage && <ActionForm action={deletePayment} className="contents" quiet><input type="hidden" name="id" value={p.id} /><SubmitButton variant="ghost" size="sm" aria-label={t('Remove the {v0} payment', { v0: fmtDate(p.paid_on) })}>{t('Remove')}</SubmitButton></ActionForm>}
                </span>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-muted">{t('No payments yet.')}</p>}
        {manage && i.balance > 0 && (
          <details open={pays.length === 0}>
            <summary className="cursor-pointer font-semibold text-accent-strong">{t('Record a payment')}</summary>
            <ActionForm action={recordPayment} className="mt-2 grid gap-2 sm:grid-cols-3">
              <input type="hidden" name="invoice_id" value={i.id} />
              <Field label={t('Amount')} htmlFor="amt"><Input id="amt" name="amount" inputMode="decimal" className="num" defaultValue={centsToInput(i.balance)} required /></Field>
              <Field label={t('Received on')} htmlFor="pd"><Input id="pd" name="paid_on" type="date" defaultValue={ctx.today} max={ctx.today} required /></Field>
              <Field label={t('How they paid')} htmlFor="pm"><Select id="pm" name="method" defaultValue="check">{PAY_METHODS.map((m) => <option key={m.key} value={m.key}>{t(m.label)}</option>)}</Select></Field>
              <Field label={t('Check # (optional)')} htmlFor="ck"><Input id="ck" name="check_no" maxLength={30} /></Field>
              <Field label={t('Their bank (optional)')} htmlFor="bk"><Input id="bk" name="bank" maxLength={60} /></Field>
              <Field label={t('Deposited on (optional)')} htmlFor="dd" hint={t('Leave blank for checks and cash you haven’t taken to the bank.')}><Input id="dd" name="deposit_date" type="date" max={ctx.today} /></Field>
              <div className="sm:col-span-3"><SubmitButton size="sm">{t('Save payment')}</SubmitButton></div>
            </ActionForm>
          </details>
        )}
        {manage && i.status !== 'void' && pays.length === 0 && (
          <details>
            <summary className="cursor-pointer text-sm font-semibold text-muted">{t('Void this invoice')}</summary>
            <ActionForm action={voidInvoice} className="mt-2 flex flex-wrap items-end gap-2">
              <input type="hidden" name="id" value={i.id} />
              <Field label={t('Reason (optional)')} htmlFor="vr"><Input id="vr" name="reason" maxLength={200} /></Field>
              <SubmitButton variant="danger" size="sm">{t('Void invoice')}</SubmitButton>
            </ActionForm>
            <p className="mt-1 text-sm text-muted">{t('The items go back on hand')}{raw.order_id ? t(' and its order opens again so you can fix and re-invoice it') : ''}.</p>
          </details>
        )}
        {raw.order_id && can(ctx, 'wholesale.orders.view') && <Link href={`/app/wholesale/orders/${raw.order_id}`} className="text-sm font-semibold text-accent-strong">{t('See the order')}</Link>}
      </Card>
    </>
  );
}
