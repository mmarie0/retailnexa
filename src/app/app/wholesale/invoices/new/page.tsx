import type { Metadata } from 'next';
import { can } from '@/lib/auth/context';
import { Notice, PageHeader } from '@/components/ui';
import { committed, standing, withBalances } from '@/lib/wholesale/ledger';
import { ReadOnlyNotice } from '../../../read-only-notice';
import { loadCustomers, loadItems, loadOpenLines, loadReceivables, loadSettings, loadTiers, wsContext, loadPopularity, itemImageUrls } from '../../_data';
import { createInvoice } from '../../actions';
import { OrderBuilder } from '../../order/builder';
import { builderData } from '../../order/data';
import { getT } from '@/lib/i18n/server';

export const metadata: Metadata = { title: 'New invoice' };

/** A direct invoice without an order (counter sale, walk-in). Stock goes out when it’s saved. */
export default async function NewInvoicePage({ searchParams }: PageProps<'/app/wholesale/invoices/new'>) {
  const t = await getT();
  const ctx = await wsContext();
  if (!can(ctx, 'wholesale.receivables.manage')) return <Notice tone="warning">{t('You don’t have permission to create invoices.')}</Notice>;
  const sp = await searchParams;
  const [customers, tiers, items, lines, settings, rec] = await Promise.all([
    loadCustomers(ctx.org.id), loadTiers(ctx.org.id), loadItems(ctx.org.id), loadOpenLines(ctx.org.id), loadSettings(ctx.org.id), loadReceivables(ctx.org.id),
  ]);
  const [sold, images] = await Promise.all([loadPopularity(ctx.org.id), settings.grid_images ? itemImageUrls(items.filter((i) => i.is_active)) : Promise.resolve(new Map<string, string>())]);
  const layout = { view: settings.catalog_view, size: settings.grid_size, images: settings.grid_images };
  const held = committed(lines);
  const inv = withBalances(rec.invoices, rec.payments, ctx.today);
  const { bc, bi } = builderData(customers, tiers, items, (id) => (items.find((i) => i.id === id)?.qty ?? 0) - (held.get(id) ?? 0), (c) => standing(c, inv, ctx.today).warnings, undefined, { sold, images });
  return (
    <>
      <PageHeader title={t('New invoice')} description={t('For a sale without an order. To bill an order, open it and tap Invoice.')} />
      <ReadOnlyNotice show={!ctx.access.canWrite} />
      {ctx.access.canWrite && (bc.length ? <OrderBuilder mode="invoice" action={createInvoice} customers={bc} items={bi} taxRate={settings.tax_rate} today={ctx.today} layout={layout}
        initial={typeof sp.customer === 'string' ? { customer_id: sp.customer } : undefined} /> : <Notice>{t('Add a customer first, on the Customers page.')}</Notice>)}
    </>
  );
}
