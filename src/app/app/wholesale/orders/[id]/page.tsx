import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { can, getSupabase } from '@/lib/auth/context';
import { ActionForm } from '@/components/action-form';
import { Card, Field, Input, LinkButton, PageHeader } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';
import { fmtQty } from '@/lib/wholesale/ledger';
import { fmtDate } from '../../../bills/format';
import { loadCustomers, loadOrders, wsContext } from '../../_data';
import { OrderBadge, money } from '../../_ui';
import { invoiceOrder, setOrderStatus, setPicked } from '../../actions';
import { getT } from '@/lib/i18n/server';

export const metadata: Metadata = { title: 'Order' };

/** One quote or sales order: lines with pick ticks, the next step, and Invoice. */
export default async function OrderPage({ params }: PageProps<'/app/wholesale/orders/[id]'>) {
  const t = await getT();
  const ctx = await wsContext();
  if (!can(ctx, 'wholesale.orders.view')) notFound();
  const { id } = await params;
  const [orders, customers, { data: lines }] = await Promise.all([
    loadOrders(ctx.org.id), loadCustomers(ctx.org.id),
    (await getSupabase()).from('sales_order_lines').select('id, item_id, sku, name, qty, price_cents, picked').eq('order_id', id).eq('organization_id', ctx.org.id).order('line_no'),
  ]);
  const o = orders.find((x) => x.id === id);
  if (!o) notFound();
  const c = customers.find((x) => x.id === o.customer_id);
  const open = ['open', 'picking', 'ready'].includes(o.status);
  const edit = can(ctx, 'wholesale.orders.create') && ctx.access.canWrite && open;
  const bill = can(ctx, 'wholesale.receivables.manage') && ctx.access.canWrite && open;
  const ls = (lines ?? []).map((l) => ({ ...l, qty: Number(l.qty), price_cents: Number(l.price_cents) }));
  const picked = ls.filter((l) => l.picked).length;
  const step = (status: string, label: string, variant: 'primary' | 'secondary' | 'danger' = 'secondary') => (
    <ActionForm action={setOrderStatus} quiet><input type="hidden" name="id" value={o.id} /><input type="hidden" name="status" value={status} /><SubmitButton size="sm" variant={variant}>{t(label)}</SubmitButton></ActionForm>
  );

  return (
    <>
      <PageHeader title={`${o.kind === 'quote' ? 'Quote' : 'Order'} ${o.number}`} description={`${c?.name ?? 'Customer'} · ${fmtDate(o.order_date)}`}
        actions={edit ? <LinkButton href={`/app/wholesale/order?id=${o.id}`} size="sm" variant="secondary">{t('Edit')}</LinkButton> : undefined} />
      <div className="flex flex-wrap items-center gap-2">
        <OrderBadge status={o.status} kind={o.kind} />
        {o.need_by && <span className="text-sm text-muted">{t('Needed by')} {fmtDate(o.need_by)}</span>}
        {o.valid_until && <span className="text-sm text-muted">{t('Good until')} {fmtDate(o.valid_until)}</span>}
        {o.customer_po && <span className="text-sm text-muted">{t('PO')} {o.customer_po}</span>}
        {o.invoice_id && can(ctx, 'wholesale.receivables.view') && <Link href={`/app/wholesale/invoices/${o.invoice_id}`} className="text-sm font-semibold text-accent-strong">{t('See the invoice')}</Link>}
      </div>
      <Card>
        {o.kind === 'order' && open && <p className="mb-2 text-sm text-muted">{t('Picked')} {picked} {t('of')} {ls.length} {t('lines.')}</p>}
        <ul className="flex flex-col divide-y divide-soft">
          {ls.map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-3 py-2">
              <span className="flex min-w-0 items-center gap-2.5">
                {o.kind === 'order' && edit ? (
                  <ActionForm action={setPicked} className="contents" quiet>
                    <input type="hidden" name="line_id" value={l.id} /><input type="hidden" name="picked" value={String(!l.picked)} />
                    <button type="submit" aria-label={t('{v0} {v1} picked', { v0: l.picked ? 'Unmark' : 'Mark', v1: l.name })} aria-pressed={l.picked}
                      className={l.picked ? 'grid size-6 flex-none place-items-center rounded-md bg-accent text-on-accent' : 'size-6 flex-none rounded-md border-2 border-line'}>{l.picked ? '✓' : ''}</button>
                  </ActionForm>
                ) : null}
                <span className="min-w-0"><span className="block truncate font-semibold">{l.name}</span><span className="text-sm text-muted">{[l.sku, `${fmtQty(l.qty)} × ${money(l.price_cents)}`].filter(Boolean).join(' · ')}</span></span>
              </span>
              <span className="num font-semibold">{money(Math.round(l.qty * l.price_cents))}</span>
            </li>
          ))}
        </ul>
        <dl className="ms-auto mt-3 grid w-full max-w-xs grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-[15px]">
          <dt className="text-muted">{t('Subtotal')}</dt><dd className="num text-end">{money(o.subtotal_cents)}</dd>
          {o.discount_cents > 0 && <><dt className="text-muted">{t('Discount')}</dt><dd className="num text-end">−{money(o.discount_cents)}</dd></>}
          {o.shipping_cents > 0 && <><dt className="text-muted">{t('Shipping')}</dt><dd className="num text-end">{money(o.shipping_cents)}</dd></>}
          <dt className="text-muted">{t('Tax (')}{o.tax_rate}%)</dt><dd className="num text-end">{money(o.tax_cents)}</dd>
          <dt className="font-bold">{t('Total')}</dt><dd className="num text-end font-bold">{money(o.total_cents)}</dd>
        </dl>
        {o.notes && <p className="mt-2 whitespace-pre-line text-sm text-muted">{o.notes}</p>}
      </Card>
      {(edit || bill) && (
        <Card className="flex flex-col gap-3">
          <h2 className="font-bold">{t('Next step')}</h2>
          <div className="flex flex-wrap gap-2">
            {edit && o.kind === 'quote' && step('order', 'Make it a sales order', 'primary')}
            {edit && o.kind === 'order' && o.status === 'open' && step('picking', 'Start picking')}
            {edit && o.kind === 'order' && o.status !== 'ready' && step('ready', 'Ready to ship')}
            {edit && step('cancelled', o.kind === 'quote' ? 'Decline quote' : 'Cancel order', 'danger')}
          </div>
          {bill && (
            <ActionForm action={invoiceOrder} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="order_id" value={o.id} />
              <Field label={t('Invoice date')} htmlFor="idate"><Input id="idate" name="invoice_date" type="date" defaultValue={ctx.today} required /></Field>
              <SubmitButton>{t('Invoice this')} {o.kind === 'quote' ? 'quote' : 'order'}</SubmitButton>
            </ActionForm>
          )}
          {bill && <p className="text-sm text-muted">{t('Invoicing takes the items out of stock and starts the customer’s payment terms (')}{c ? t('{v0} days', { v0: c.terms }) : t('their terms')}).</p>}
        </Card>
      )}
    </>
  );
}
