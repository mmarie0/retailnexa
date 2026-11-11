import type { Metadata } from 'next';
import { can } from '@/lib/auth/context';
import { Notice, PageHeader } from '@/components/ui';
import { committed, standing, withBalances } from '@/lib/wholesale/ledger';
import { ReadOnlyNotice } from '../../../read-only-notice';
import { loadCustomers, loadItems, loadOpenLines, loadReceivables, loadSettings, loadTiers, wsContext } from '../../_data';
import { createInvoice } from '../../actions';
import { OrderBuilder } from '../../order/builder';
import { builderData } from '../../order/data';

export const metadata: Metadata = { title: 'New invoice' };

/** A direct invoice without an order (counter sale, walk-in). Stock goes out when it’s saved. */
export default async function NewInvoicePage({ searchParams }: PageProps<'/app/wholesale/invoices/new'>) {
  const ctx = await wsContext();
  if (!can(ctx, 'wholesale.receivables.manage')) return <Notice tone="warning">You don’t have permission to create invoices.</Notice>;
  const sp = await searchParams;
  const [customers, tiers, items, lines, settings, rec] = await Promise.all([
    loadCustomers(ctx.org.id), loadTiers(ctx.org.id), loadItems(ctx.org.id), loadOpenLines(ctx.org.id), loadSettings(ctx.org.id), loadReceivables(ctx.org.id),
  ]);
  const held = committed(lines);
  const inv = withBalances(rec.invoices, rec.payments, ctx.today);
  const { bc, bi } = builderData(customers, tiers, items, (id) => (items.find((i) => i.id === id)?.qty ?? 0) - (held.get(id) ?? 0), (c) => standing(c, inv, ctx.today).warnings);
  return (
    <>
      <PageHeader title="New invoice" description="For a sale without an order. To bill an order, open it and tap Invoice." />
      <ReadOnlyNotice show={!ctx.access.canWrite} />
      {ctx.access.canWrite && (bc.length ? <OrderBuilder mode="invoice" action={createInvoice} customers={bc} items={bi} taxRate={settings.tax_rate} today={ctx.today}
        initial={typeof sp.customer === 'string' ? { customer_id: sp.customer } : undefined} /> : <Notice>Add a customer first, on the Customers page.</Notice>)}
    </>
  );
}
