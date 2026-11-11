import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { can } from '@/lib/auth/context';
import { getSupabase } from '@/lib/auth/context';
import { Notice, PageHeader } from '@/components/ui';
import { committed, standing, withBalances } from '@/lib/wholesale/ledger';
import { ReadOnlyNotice } from '../../read-only-notice';
import { loadCustomers, loadItems, loadOpenLines, loadOrders, loadReceivables, loadSettings, loadTiers, wsContext } from '../_data';
import { saveOrder } from '../actions';
import { OrderBuilder, type BuilderInitial } from './builder';
import { builderData } from './data';
import { getT } from '@/lib/i18n/server';

export const metadata: Metadata = { title: 'Create order' };

/** Create order (or edit one with ?id=): the Wholesale Ledger's order screen. */
export default async function CreateOrderPage({ searchParams }: PageProps<'/app/wholesale/order'>) {
  const t = await getT();
  const ctx = await wsContext();
  if (!can(ctx, 'wholesale.orders.create')) return <Notice tone="warning">{t('You don’t have permission to create orders.')}</Notice>;
  const sp = await searchParams;
  const editId = typeof sp.id === 'string' ? sp.id : null;
  const seeMoney = can(ctx, 'wholesale.receivables.view');
  const [customers, tiers, items, lines, settings, rec, orders] = await Promise.all([
    loadCustomers(ctx.org.id), loadTiers(ctx.org.id), loadItems(ctx.org.id), loadOpenLines(ctx.org.id), loadSettings(ctx.org.id),
    seeMoney ? loadReceivables(ctx.org.id) : Promise.resolve({ invoices: [], payments: [], truncated: false }),
    editId ? loadOrders(ctx.org.id) : Promise.resolve([]),
  ]);
  let initial: BuilderInitial | undefined;
  if (editId) {
    const o = orders.find((x) => x.id === editId);
    if (!o) notFound();
    if (o.status === 'invoiced' || o.status === 'cancelled') return <Notice>{t('This order is closed and can’t be changed.')}</Notice>;
    const { data: ol } = await (await getSupabase()).from('sales_order_lines').select('id, item_id, name, sku, qty, price_cents').eq('order_id', o.id).eq('organization_id', ctx.org.id).order('line_no');
    initial = {
      id: o.id, kind: o.kind, customer_id: o.customer_id, discount: o.discount_cents, shipping: o.shipping_cents, tax_rate: o.tax_rate, customer_po: o.customer_po,
      need_by: o.need_by, valid_until: o.valid_until, notes: o.notes, date: o.order_date,
      lines: (ol ?? []).map((l) => ({ key: l.id, item_id: l.item_id, name: l.name, sku: l.sku, qty: Number(l.qty), price_cents: Number(l.price_cents) })),
    };
  } else if (typeof sp.customer === 'string') initial = { customer_id: sp.customer };
  const held = committed(lines.filter((l) => l.order_id !== editId));
  const inv = withBalances(rec.invoices, rec.payments, ctx.today);
  const { bc, bi } = builderData(customers, tiers, items, (id) => (items.find((i) => i.id === id)?.qty ?? 0) - (held.get(id) ?? 0), (c) => standing(c, inv, ctx.today).warnings, initial?.customer_id);
  return (
    <>
      <PageHeader title={initial?.id ? t('Edit order') : t('Create order')} description={t('Pick the customer, tap quantities, then review. Prices follow the customer’s tier; you can change any price before saving.')} />
      <ReadOnlyNotice show={!ctx.access.canWrite} />
      {ctx.access.canWrite && (bc.length ? <OrderBuilder mode="order" action={saveOrder} customers={bc} items={bi} taxRate={settings.tax_rate} today={ctx.today} initial={initial} />
        : <Notice>{t('Add a customer first, on the Customers page.')}</Notice>)}
    </>
  );
}
