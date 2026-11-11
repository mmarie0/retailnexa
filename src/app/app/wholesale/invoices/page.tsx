import type { Metadata } from 'next';
import { can } from '@/lib/auth/context';
import { EmptyState, LinkButton, Notice, PageHeader } from '@/components/ui';
import { AGING, aging, withBalances } from '@/lib/wholesale/ledger';
import { fmtDate } from '../../bills/format';
import { Stat } from '../../_dashboard/tiles';
import { loadCustomers, loadReceivables, wsContext } from '../_data';
import { InvoiceBadge, Pills, Row, SearchBox, money, money0 } from '../_ui';

export const metadata: Metadata = { title: 'Invoices' };
const FILTERS: [string, string][] = [['', 'Open'], ['overdue', 'Overdue'], ['paid', 'Paid'], ['void', 'Void'], ['all', 'All']];

/** Customer invoices with balances and aging (Not yet due, 1–30, 31–60, 61–90, 90+). */
export default async function InvoicesPage({ searchParams }: PageProps<'/app/wholesale/invoices'>) {
  const ctx = await wsContext();
  if (!can(ctx, 'wholesale.receivables.view')) return <Notice tone="warning">You don’t have access to invoices.</Notice>;
  const sp = await searchParams;
  const f = String(sp.f ?? ''), q = String(sp.q ?? '').trim().toLowerCase();
  const [rec, customers] = await Promise.all([loadReceivables(ctx.org.id), loadCustomers(ctx.org.id)]);
  const name = new Map(customers.map((c) => [c.id, c.name]));
  const inv = withBalances(rec.invoices, rec.payments, ctx.today);
  const shown = inv
    .filter((i) => (f === 'all' ? true : f === 'paid' ? i.status === 'paid' : f === 'void' ? i.status === 'void' : f === 'overdue' ? i.status === 'overdue' : i.balance > 0))
    .filter((i) => !q || [i.number, name.get(i.customer_id)].some((v) => v?.toLowerCase().includes(q)))
    .sort((a, b) => (f ? 0 : a.due_date.localeCompare(b.due_date)));
  const buckets = aging(inv, ctx.today);
  const owed = buckets.reduce((s, b) => s + b, 0);
  return (
    <>
      <PageHeader title="Invoices" description="What customers owe you, by due date. Record payments on each invoice."
        actions={can(ctx, 'wholesale.receivables.manage') && ctx.access.canWrite ? <LinkButton href="/app/wholesale/invoices/new" size="sm">New invoice</LinkButton> : undefined} />
      {inv.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Stat block="blue" label="Owed to you" value={money0(owed)} sub={`${inv.filter((i) => i.balance > 0).length} open invoices`} />
            <Stat block={owed - buckets[0] ? 'coral' : undefined} label="Overdue" value={money0(owed - buckets[0])} sub={`${inv.filter((i) => i.status === 'overdue').length} invoices`} />
          </div>
          <div className="grid grid-cols-5 gap-1.5 text-center max-[421px]:grid-cols-3" aria-label="Aging">
            {AGING.map((label, n) => (
              <div key={label} className="rounded-xl bg-card px-1.5 py-2 shadow-[var(--shadow-card)]">
                <p className="text-[11px] font-semibold text-muted">{n ? `${label} days` : label}</p>
                <p className={n && buckets[n] ? 'num text-sm font-semibold text-late' : 'num text-sm font-semibold'}>{money0(buckets[n])}</p>
              </div>
            ))}
          </div>
          <SearchBox action="/app/wholesale/invoices" q={String(sp.q ?? '')} placeholder="Search invoice # or customer" hidden={f ? { f } : undefined} />
        </>
      )}
      <Pills base="/app/wholesale/invoices" current={f} items={FILTERS} />
      {rec.truncated && <p className="text-sm text-muted">Showing the first 20,000 invoices or payments; totals may be low.</p>}
      {shown.length ? (
        <ul className="flex flex-col gap-2">
          {shown.map((i) => (
            <Row key={i.id} href={`/app/wholesale/invoices/${i.id}`} title={`${i.number} · ${name.get(i.customer_id) ?? 'Customer'}`}
              detail={`${fmtDate(i.invoice_date)} · due ${fmtDate(i.due_date)}${i.status === 'overdue' ? ` · ${i.daysLate} days late` : ''}`}
              amount={i.balance > 0 ? `${money(i.balance)} due` : money(i.total_cents)} badge={<InvoiceBadge s={i.status} />} />
          ))}
        </ul>
      ) : inv.length ? <p className="text-muted">Nothing here.</p> : <EmptyState title="No invoices yet">Invoice an order from its page, or start a new invoice.</EmptyState>}
    </>
  );
}
