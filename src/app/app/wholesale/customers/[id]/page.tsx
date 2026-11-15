import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { can } from '@/lib/auth/context';
import { ActionForm } from '@/components/action-form';
import { Card, Eyebrow, LinkButton, Notice, PageHeader } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';
import { methodLabel, standing, termsLabel, withBalances } from '@/lib/wholesale/ledger';
import { fmtDate } from '../../../bills/format';
import { Stat } from '../../../_dashboard/tiles';
import { loadCustomers, loadExpected, loadOrders, loadReceivables, loadSettings, loadTiers, wsContext } from '../../_data';
import { InvoiceBadge, OrderBadge, Row, Warnings, money } from '../../_ui';
import { deleteCustomer, saveCustomer } from '../../actions';
import { CustomerFields } from '../fields';
import { getT } from '@/lib/i18n/server';

export const metadata: Metadata = { title: 'Customer' };

export default async function CustomerPage({ params }: PageProps<'/app/wholesale/customers/[id]'>) {
  const t = await getT();
  const ctx = await wsContext();
  const { id } = await params;
  const seeMoney = can(ctx, 'wholesale.receivables.view'), seeOrders = can(ctx, 'wholesale.orders.view');
  const [customers, tiers, settings, rec, orders, expected] = await Promise.all([
    loadCustomers(ctx.org.id), loadTiers(ctx.org.id), loadSettings(ctx.org.id),
    seeMoney ? loadReceivables(ctx.org.id) : Promise.resolve({ invoices: [], payments: [], truncated: false }),
    seeOrders ? loadOrders(ctx.org.id) : Promise.resolve([]),
    seeMoney ? loadExpected(ctx.org.id) : Promise.resolve([]),
  ]);
  const c = customers.find((x) => x.id === id);
  if (!c) notFound();
  const inv = withBalances(rec.invoices.filter((i) => i.customer_id === id), rec.payments, ctx.today);
  const s = standing(c, inv, ctx.today);
  const mine = orders.filter((o) => o.customer_id === id);
  const plan = expected.filter((e) => e.customer_id === id && e.status === 'expected');
  const lastPay = rec.payments.filter((p) => inv.some((i) => i.id === p.invoice_id)).sort((a, b) => b.paid_on.localeCompare(a.paid_on))[0];
  const tier = tiers.find((t) => t.id === c.tier_id);
  const manage = can(ctx, 'wholesale.customers.manage') && ctx.access.canWrite;
  const sales12 = inv.filter((i) => i.status !== 'void' && i.invoice_date >= `${Number(ctx.today.slice(0, 4)) - 1}${ctx.today.slice(4)}`).reduce((t, i) => t + i.subtotal_cents - i.discount_cents, 0);

  return (
    <>
      <PageHeader title={c.name} description={[tier ? `${tier.name} pricing${tier.pct ? ` (${tier.pct}% off)` : ''}` : 'List price', termsLabel(c.terms), c.is_active ? null : 'Inactive'].filter(Boolean).join(' · ')}
        actions={can(ctx, 'wholesale.orders.create') && ctx.access.canWrite && c.is_active ? <LinkButton href={`/app/wholesale/order?customer=${c.id}`} size="sm">{t('Create order')}</LinkButton> : undefined} />
      <Warnings list={s.warnings} />
      {seeMoney && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat block="blue" label={t('Balance')} value={money(s.balance)} sub={c.credit_limit_cents != null ? t('Limit {v0}', { v0: money(c.credit_limit_cents) }) : t('No credit limit')} />
          <Stat block={s.overdue ? 'coral' : undefined} label={t('Overdue')} value={money(s.overdue)} sub={t('{v0} invoice{v1}', { v0: s.overdueCount, v1: s.overdueCount === 1 ? '' : 's' })} />
          <Stat label={t('Promised')} value={money(plan.reduce((t, e) => t + e.amount_cents, 0))} sub={plan[0] ? t('Next {v0}', { v0: fmtDate(plan[0].due_date) }) : t('No payment plan')} />
          <Stat label={t('Sales, last 12 months')} value={money(sales12)} sub={lastPay ? t('Last paid {v0} · {v1}', { v0: fmtDate(lastPay.paid_on), v1: methodLabel(lastPay.method) }) : t('No payments yet')} />
        </div>
      )}
      <Card>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[15px]">
          {([['Contact', c.contact], ['Email', c.email], ['Phone', c.phone], ['Bill to', c.address], ['Ship to', c.ship_address],
            ['Tax', c.tax_exempt ? `Exempt${c.resale_cert ? ` · certificate ${c.resale_cert}` : ''}${c.cert_expiry ? ` · expires ${fmtDate(c.cert_expiry)}` : ''}` : 'Taxable'], ['Notes', c.notes]] as [string, string | null][])
            .filter(([, v]) => v).map(([k, v]) => <div key={k} className="contents"><dt className="text-muted">{k}</dt><dd className="whitespace-pre-line">{v}</dd></div>)}
        </dl>
      </Card>
      {seeMoney && (
        <section className="flex flex-col gap-2">
          <Eyebrow>{t('Invoices')}</Eyebrow>
          {inv.length ? <ul className="flex flex-col gap-2">{inv.slice(0, 50).map((i) => (
            <Row key={i.id} href={`/app/wholesale/invoices/${i.id}`} title={i.number} detail={t('{v0} · due {v1}', { v0: fmtDate(i.invoice_date), v1: fmtDate(i.due_date) })} amount={money(i.balance || i.total_cents)} badge={<InvoiceBadge s={i.status} />} />
          ))}</ul> : <p className="text-sm text-muted">{t('No invoices yet.')}</p>}
          {plan.length > 0 && <Link href={`/app/wholesale/payments?customer=${c.id}`} className="text-sm font-semibold text-accent-strong">{t('Payment plan ·')} {plan.length} {t('payment')}{plan.length === 1 ? '' : 's'} {t('expected')}</Link>}
        </section>
      )}
      {seeOrders && (
        <section className="flex flex-col gap-2">
          <Eyebrow>{t('Orders & quotes')}</Eyebrow>
          {mine.length ? <ul className="flex flex-col gap-2">{mine.slice(0, 30).map((o) => (
            <Row key={o.id} href={`/app/wholesale/orders/${o.id}`} title={o.number} detail={fmtDate(o.order_date)} amount={money(o.total_cents)} badge={<OrderBadge status={o.status} kind={o.kind} />} />
          ))}</ul> : <p className="text-sm text-muted">{t('No orders yet.')}</p>}
        </section>
      )}
      {manage && (
        <Card>
          <details>
            <summary className="cursor-pointer text-lg font-bold">{t('Edit customer')}</summary>
            <ActionForm action={saveCustomer} className="mt-3 flex flex-col gap-3"><CustomerFields c={c} tiers={tiers} defaultTerms={settings.default_terms} /><div><SubmitButton>{t('Save changes')}</SubmitButton></div></ActionForm>
            <ActionForm action={deleteCustomer} className="mt-3"><input type="hidden" name="id" value={c.id} /><SubmitButton variant="danger" size="sm">{t('Delete customer')}</SubmitButton></ActionForm>
            <p className="mt-1 text-sm text-muted">{t('A customer with orders or invoices is made inactive instead, so history stays.')}</p>
          </details>
        </Card>
      )}
      {!seeMoney && !seeOrders && <Notice>{t('Your role can’t see this customer’s orders or invoices.')}</Notice>}
    </>
  );
}
