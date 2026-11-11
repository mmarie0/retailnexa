import type { Metadata } from 'next';
import { can } from '@/lib/auth/context';
import { EmptyState, LinkButton, Notice, PageHeader } from '@/components/ui';
import { fmtDate } from '../../bills/format';
import { Stat } from '../../_dashboard/tiles';
import { loadCustomers, loadOrders, wsContext } from '../_data';
import { OrderBadge, Pills, Row, SearchBox, money, money0 } from '../_ui';

export const metadata: Metadata = { title: 'Orders' };
const FILTERS: [string, string][] = [['', 'Open orders'], ['quotes', 'Quotes'], ['closed', 'Invoiced & cancelled'], ['all', 'All']];

/** Sales orders and quotes, like the Ledger's Orders tab. */
export default async function OrdersPage({ searchParams }: PageProps<'/app/wholesale/orders'>) {
  const ctx = await wsContext();
  if (!can(ctx, 'wholesale.orders.view')) return <Notice tone="warning">You don’t have access to orders.</Notice>;
  const sp = await searchParams;
  const f = String(sp.f ?? ''), q = String(sp.q ?? '').trim().toLowerCase();
  const [orders, customers] = await Promise.all([loadOrders(ctx.org.id), loadCustomers(ctx.org.id)]);
  const name = new Map(customers.map((c) => [c.id, c.name]));
  const open = (o: (typeof orders)[number]) => ['open', 'picking', 'ready'].includes(o.status);
  const shown = orders
    .filter((o) => (f === 'quotes' ? o.kind === 'quote' && open(o) : f === 'closed' ? !open(o) : f === 'all' ? true : o.kind === 'order' && open(o)))
    .filter((o) => !q || [o.number, o.customer_po, name.get(o.customer_id)].some((v) => v?.toLowerCase().includes(q)));
  const live = orders.filter((o) => o.kind === 'order' && open(o));
  return (
    <>
      <PageHeader title="Orders" description="Quotes and sales orders. Pick and ship them, then invoice — invoicing takes the stock out."
        actions={can(ctx, 'wholesale.orders.create') && ctx.access.canWrite ? <LinkButton href="/app/wholesale/order" size="sm">Create order</LinkButton> : undefined} />
      {orders.length > 0 && (
        <div className="grid grid-cols-3 gap-3 max-[520px]:grid-cols-1">
          <Stat block="blue" label="Open orders" value={String(live.length)} sub={money0(live.reduce((s, o) => s + o.total_cents, 0))} />
          <Stat label="Ready to ship" value={String(live.filter((o) => o.status === 'ready').length)} />
          <Stat label="Open quotes" value={String(orders.filter((o) => o.kind === 'quote' && open(o)).length)} />
        </div>
      )}
      {orders.length > 0 && <SearchBox action="/app/wholesale/orders" q={String(sp.q ?? '')} placeholder="Search order #, PO or customer" hidden={f ? { f } : undefined} />}
      <Pills base="/app/wholesale/orders" current={f} items={FILTERS} />
      {orders.truncated && <p className="text-sm text-muted">Showing the first 20,000 orders.</p>}
      {shown.length ? (
        <ul className="flex flex-col gap-2">
          {shown.map((o) => (
            <Row key={o.id} href={`/app/wholesale/orders/${o.id}`} title={`${o.number} · ${name.get(o.customer_id) ?? 'Customer'}`}
              detail={[fmtDate(o.order_date), o.need_by && `need by ${fmtDate(o.need_by)}`, o.customer_po && `PO ${o.customer_po}`].filter(Boolean).join(' · ')}
              amount={money(o.total_cents)} badge={<OrderBadge status={o.status} kind={o.kind} />} />
          ))}
        </ul>
      ) : orders.length ? <p className="text-muted">Nothing here.</p> : <EmptyState title="No orders yet">Create an order or a quote from the order screen.</EmptyState>}
    </>
  );
}
