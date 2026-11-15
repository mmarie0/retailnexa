import Link from 'next/link';
import { can, type OrgContext } from '@/lib/auth/context';
import { Card, Eyebrow } from '@/components/ui';
import { committed, reorderSuggestion, scheduleGroups, standing, stockValue, withBalances, fmtQty } from '@/lib/wholesale/ledger';
import { fmtDate } from '../bills/format';
import { Stat } from '../_dashboard/tiles';
import { Icon } from '../app-shell';
import { loadCustomers, loadExpected, loadItems, loadOpenLines, loadOrders, loadReceivables } from './_data';
import { OrderBadge, money, money0 } from './_ui';
import { getT } from '@/lib/i18n/server';

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);

/** Wholesale Overview, like the Ledger's dashboard: what's owed, this month's sales, what to collect, pick and reorder. */
export async function WholesaleOverview({ ctx, today, compact = false }: { ctx: OrgContext; today: string; compact?: boolean }) {
  const t = await getT();
  const org = ctx.org.id;
  const see = {
    orders: can(ctx, 'wholesale.orders.view'), money: can(ctx, 'wholesale.receivables.view'),
    stock: can(ctx, 'inventory.view') || can(ctx, 'wholesale.catalog.manage'), cust: can(ctx, 'wholesale.orders.view') || can(ctx, 'wholesale.customers.manage') || can(ctx, 'wholesale.receivables.view'),
  };
  const [customers, items, openOrders, openLines, rec, expected] = await Promise.all([
    see.cust ? loadCustomers(org) : Promise.resolve([]),
    see.stock ? loadItems(org) : Promise.resolve([]),
    see.orders ? loadOrders(org, { open: true }) : Promise.resolve([]),
    see.stock || see.orders ? loadOpenLines(org) : Promise.resolve([]),
    see.money ? loadReceivables(org) : Promise.resolve({ invoices: [], payments: [], truncated: false }),
    see.money ? loadExpected(org) : Promise.resolve([]),
  ]);
  const name = new Map(customers.map((c) => [c.id, c.name]));
  const inv = withBalances(rec.invoices, rec.payments, today);
  const owed = inv.reduce((s, i) => s + i.balance, 0);
  const overdue = inv.filter((i) => i.status === 'overdue').reduce((s, i) => s + i.balance, 0);
  const ym = today.slice(0, 7);
  const month = inv.filter((i) => i.status !== 'void' && i.invoice_date.startsWith(ym));
  const sales = month.reduce((s, i) => s + i.subtotal_cents - i.discount_cents, 0), gp = sales - month.reduce((s, i) => s + i.cost_cents, 0);
  const held = committed(openLines);
  const value = stockValue(items);
  const reorder = items.map((it) => ({ it, n: reorderSuggestion(it, held.get(it.id) ?? 0) })).filter((r) => r.n !== null);
  const toShip = openOrders.filter((o) => o.kind === 'order');
  const collect = customers.map((c) => ({ c, s: standing(c, inv, today) })).filter((r) => r.s.overdue > 0).sort((a, b) => b.s.overdue - a.s.overdue).slice(0, 6);
  const sched = scheduleGroups(expected, today);
  const coming = [...sched.late, ...sched.soon].slice(0, 6);
  const nothing = !see.orders && !see.money && !see.stock;

  return (
    <section className="flex flex-col gap-[18px]" aria-label={t('Wholesale')}>
      {compact && <Eyebrow>{t('Wholesale')}</Eyebrow>}
      {!compact && (
        <div className="grid grid-cols-4 gap-2 max-[520px]:grid-cols-2">
          {[
            can(ctx, 'wholesale.orders.create') && { href: '/app/wholesale/order', icon: 'cart', label: 'Create order' },
            can(ctx, 'wholesale.receivables.manage') && { href: '/app/wholesale/invoices/new', icon: 'invoice', label: 'New invoice' },
            see.money && { href: '/app/wholesale/payments', icon: 'card', label: 'Payments' },
            see.cust && { href: '/app/wholesale/customers', icon: 'team', label: 'Customers' },
          ].filter(Boolean).map((b) => {
            const x = b as { href: string; icon: 'cart' | 'invoice' | 'card' | 'team'; label: string };
            return <Link key={x.href} href={x.href} className="flex flex-col items-center gap-1 rounded-[16px] bg-card px-2 py-3 text-sm font-semibold shadow-[var(--shadow-card)] hover:bg-soft"><Icon k={x.icon} className="size-6 text-accent" />{t(x.label)}</Link>;
          })}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {see.money && <Stat block="blue" label={t('Owed to you')} value={money0(owed)} sub={overdue ? t('{v0} overdue', { v0: money0(overdue) }) : t('Nothing overdue')} href="/app/wholesale/invoices" />}
        {see.money && <Stat label={t('Sales this month')} value={money0(sales)} sub={sales ? t('GP {v0} · {v1}% margin', { v0: money0(gp), v1: pct(gp, sales) ?? 0 }) : t('No invoices yet')} />}
        {see.orders && <Stat label={t('Open orders')} value={String(toShip.length)} sub={t('{v0} quote{v1}', { v0: openOrders.length - toShip.length, v1: openOrders.length - toShip.length === 1 ? '' : 's' })} href="/app/wholesale/orders" />}
        {see.stock && <Stat label={t('Stock on hand')} value={money0(value.cost)} sub={t('At cost · {v0} at price', { v0: money0(value.price) })} href="/app/wholesale/inventory" />}
      </div>
      {rec.truncated && <p className="text-sm text-muted">{t('Showing the first 20,000 invoices or payments; totals may be low.')}</p>}

      <div className="grid gap-3 sm:grid-cols-2">
        {see.money && (
          <Card>
            <h2 className="font-bold">{t('Collect next')}</h2>
            {collect.length ? (
              <ul className="mt-2 flex flex-col gap-1.5 text-[15px]">
                {collect.map(({ c, s }) => <li key={c.id} className="flex justify-between gap-2"><Link href={`/app/wholesale/customers/${c.id}`} className="truncate hover:underline">{c.name}</Link><span className="num text-late">{money(s.overdue)}</span></li>)}
              </ul>
            ) : <p className="mt-1 text-sm text-muted">{t('No overdue balances.')}</p>}
          </Card>
        )}
        {see.money && (
          <Card>
            <h2 className="font-bold">{t('Payments coming in')}</h2>
            {coming.length ? (
              <ul className="mt-2 flex flex-col gap-1.5 text-[15px]">
                {coming.map((e) => <li key={e.id} className="flex justify-between gap-2"><span className="truncate">{fmtDate(e.due_date)} · {name.get(e.customer_id) ?? t('Customer')}</span><span className={e.due_date < today ? 'num text-late' : 'num'}>{money(e.amount_cents)}</span></li>)}
              </ul>
            ) : <p className="mt-1 text-sm text-muted">{t('No promised payments in the next 7 days.')}</p>}
            <Link href="/app/wholesale/payments" className="mt-2 inline-block text-sm font-semibold text-accent-strong">{t('Payment schedule')}</Link>
          </Card>
        )}
        {see.orders && (
          <Card>
            <h2 className="font-bold">{t('To pick & ship')}</h2>
            {toShip.length ? (
              <ul className="mt-2 flex flex-col gap-1.5 text-[15px]">
                {toShip.slice(0, 6).map((o) => <li key={o.id} className="flex items-center justify-between gap-2"><Link href={`/app/wholesale/orders/${o.id}`} className="truncate hover:underline">{o.number} · {name.get(o.customer_id) ?? t('Customer')}</Link><OrderBadge status={o.status} /></li>)}
              </ul>
            ) : <p className="mt-1 text-sm text-muted">{t('No open orders.')}</p>}
          </Card>
        )}
        {see.stock && (
          <Card>
            <h2 className="font-bold">{t('Reorder')}</h2>
            {reorder.length ? (
              <ul className="mt-2 flex flex-col gap-1.5 text-[15px]">
                {reorder.slice(0, 6).map(({ it, n }) => <li key={it.id} className="flex justify-between gap-2"><span className="truncate">{it.name}</span><span className="num">{t('order')} {fmtQty(n!)}</span></li>)}
              </ul>
            ) : <p className="mt-1 text-sm text-muted">{t('Nothing at its reorder point.')}</p>}
          </Card>
        )}
      </div>
      {nothing && <p className="text-muted">{t('Your role doesn’t include wholesale pages yet.')}</p>}
    </section>
  );
}
