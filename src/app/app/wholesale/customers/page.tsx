import type { Metadata } from 'next';
import { can } from '@/lib/auth/context';
import { ActionForm } from '@/components/action-form';
import { Card, EmptyState, Notice, PageHeader } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';
import { standing, termsLabel, withBalances } from '@/lib/wholesale/ledger';
import { ReadOnlyNotice } from '../../read-only-notice';
import { Stat } from '../../_dashboard/tiles';
import { loadCustomers, loadReceivables, loadSettings, loadTiers, wsContext } from '../_data';
import { Pills, Row, SearchBox, Warnings, money, money0 } from '../_ui';
import { saveCustomer } from '../actions';
import { CustomerFields } from './fields';
import { getT } from '@/lib/i18n/server';

export const metadata: Metadata = { title: 'Customers' };

/** Wholesale customers: tier, terms, balance and warnings (overdue, over limit, certificate expired, on hold). */
export default async function CustomersPage({ searchParams }: PageProps<'/app/wholesale/customers'>) {
  const t = await getT();
  const ctx = await wsContext();
  if (!(['wholesale.customers.manage', 'wholesale.orders.view', 'wholesale.receivables.view'] as const).some((p) => can(ctx, p))) return <Notice tone="warning">{t('You don’t have access to customers.')}</Notice>;
  const sp = await searchParams;
  const q = String(sp.q ?? '').trim().toLowerCase(), f = String(sp.f ?? '');
  const seeMoney = can(ctx, 'wholesale.receivables.view');
  const [customers, tiers, settings, rec] = await Promise.all([
    loadCustomers(ctx.org.id), loadTiers(ctx.org.id), loadSettings(ctx.org.id),
    seeMoney ? loadReceivables(ctx.org.id) : Promise.resolve({ invoices: [], payments: [], truncated: false }),
  ]);
  const inv = withBalances(rec.invoices, rec.payments, ctx.today);
  const tierName = new Map(tiers.map((t) => [t.id, t.name]));
  const rows = customers.map((c) => ({ c, s: standing(c, inv, ctx.today) }));
  const shown = rows
    .filter(({ c }) => (f === 'inactive' ? !c.is_active : c.is_active))
    .filter(({ s }) => (f === 'owing' ? s.balance > 0 : f === 'overdue' ? s.overdue > 0 : f === 'warn' ? s.warnings.length > 0 : true))
    .filter(({ c }) => !q || [c.name, c.contact, c.email, c.phone].some((v) => v?.toLowerCase().includes(q)));
  const manage = can(ctx, 'wholesale.customers.manage') && ctx.access.canWrite;
  const owed = rows.reduce((s, r) => s + r.s.balance, 0), late = rows.reduce((s, r) => s + r.s.overdue, 0);

  return (
    <>
      <PageHeader title={t('Customers')} description={t('The businesses you sell to: their price tier, payment terms, credit limit and what they owe.')} />
      <ReadOnlyNotice show={can(ctx, 'wholesale.customers.manage') && !ctx.access.canWrite} />
      {customers.length > 0 && (
        <div className="grid grid-cols-3 gap-3 max-[520px]:grid-cols-1">
          <Stat label={t('Active customers')} value={String(rows.filter((r) => r.c.is_active).length)} />
          {seeMoney && <Stat block="blue" label={t('They owe you')} value={money0(owed)} />}
          {seeMoney && <Stat block={late ? 'coral' : undefined} label={t('Overdue')} value={money0(late)} sub={t('{v0} customers', { v0: rows.filter((r) => r.s.overdue > 0).length })} />}
        </div>
      )}
      {customers.length > 0 && (
        <>
          <SearchBox action="/app/wholesale/customers" q={String(sp.q ?? '')} placeholder={t('Search name, contact, email or phone')} hidden={f ? { f } : undefined} />
          <Pills base="/app/wholesale/customers" current={f} items={[['', 'All'], ...(seeMoney ? [['owing', 'Owe you'], ['overdue', 'Overdue']] as [string, string][] : []), ['warn', 'Need attention'], ['inactive', 'Inactive']]} />
        </>
      )}
      {customers.truncated && <p className="text-sm text-muted">{t('Showing the first 20,000 customers.')}</p>}
      {shown.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {shown.map(({ c, s }) => (
            <Row key={c.id} href={`/app/wholesale/customers/${c.id}`} title={c.name}
              detail={<>{[c.tier_id ? tierName.get(c.tier_id) : 'List price', termsLabel(c.terms), c.contact, c.phone].filter(Boolean).join(' · ')}<span className="mt-1 block"><Warnings list={s.warnings} /></span></>}
              amount={seeMoney && s.balance ? money(s.balance) : undefined} />
          ))}
        </ul>
      ) : customers.length > 0 ? <p className="text-muted">{t('No customers match.')}</p> : (
        <EmptyState title={t('No customers yet')}>{manage ? t('Add the stores and businesses you sell to below.') : t('An owner or admin can add customers.')}</EmptyState>
      )}
      {manage && (
        <Card id="add">
          <h2 className="text-lg font-bold">{t('Add a customer')}</h2>
          {!tiers.length && <p className="mt-1 text-sm text-muted">{t('Tip: set up price tiers (Standard, Volume, Distributor) under Customers → Price tiers first.')}</p>}
          <ActionForm action={saveCustomer} className="mt-3 flex flex-col gap-3">
            <input type="hidden" name="then" value="open" />
            <CustomerFields tiers={tiers} defaultTerms={settings.default_terms} />
            <div><SubmitButton>{t('Add customer')}</SubmitButton></div>
          </ActionForm>
        </Card>
      )}
    </>
  );
}
