import type { Metadata } from 'next';
import { can } from '@/lib/auth/context';
import { ActionForm } from '@/components/action-form';
import { Card, Input, Notice, PageHeader } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';
import { ReadOnlyNotice } from '../../read-only-notice';
import { loadCustomers, loadTiers, wsContext } from '../_data';
import { saveTiers } from '../actions';
import { getT } from '@/lib/i18n/server';

export const metadata: Metadata = { title: 'Price tiers' };
const STARTER = [{ name: 'Standard', pct: 0 }, { name: 'Volume', pct: 5 }, { name: 'Distributor', pct: 10 }];

/** Price tiers: each customer gets a tier, and its percent comes off your list price on the order screen. */
export default async function TiersPage() {
  const t = await getT();
  const ctx = await wsContext();
  if (!can(ctx, 'wholesale.catalog.manage')) return <Notice tone="warning">{t('Only owners and admins can change price tiers.')}</Notice>;
  const [tiers, customers] = await Promise.all([loadTiers(ctx.org.id), loadCustomers(ctx.org.id)]);
  const used = new Map<string, number>();
  for (const c of customers) if (c.tier_id) used.set(c.tier_id, (used.get(c.tier_id) ?? 0) + 1);
  const rows = [...(tiers.length ? tiers.map((t) => ({ id: t.id, name: t.name, pct: t.pct })) : STARTER.map((t) => ({ id: '', ...t }))), { id: '', name: '', pct: 0 }, { id: '', name: '', pct: 0 }];
  const edit = ctx.access.canWrite;
  return (
    <>
      <PageHeader title={t('Price tiers')} description={t('Give each customer a tier. The tier’s discount comes off your list price when you build their order. You can still change any price on the order.')} />
      <ReadOnlyNotice show={!edit} />
      {!tiers.length && <Notice>{t('These are suggested tiers. Save to start using them.')}</Notice>}
      <Card>
        <ActionForm action={saveTiers} className="flex flex-col gap-3">
          <div className="grid grid-cols-[1fr_7rem_auto] items-center gap-2 text-sm font-semibold text-muted"><span>{t('Tier')}</span><span>{t('% off list')}</span><span className="w-20">{t('Customers')}</span></div>
          {rows.map((row, i) => (
            <div key={row.id || `n${i}`} className="grid grid-cols-[1fr_7rem_auto] items-center gap-2">
              <input type="hidden" name="tier_id" value={row.id} />
              <Input name="tier_name" defaultValue={row.name} maxLength={40} placeholder={row.id ? undefined : t('New tier (optional)')} aria-label={t('Tier {v0} name', { v0: i + 1 })} disabled={!edit} />
              <Input name="tier_pct" type="number" min={0} max={90} step="0.01" defaultValue={row.pct} className="num" aria-label={t('Tier {v0} discount percent', { v0: i + 1 })} disabled={!edit} />
              <span className="w-20 text-sm text-muted">{row.id ? used.get(row.id) ?? 0 : ''}</span>
            </div>
          ))}
          <p className="text-sm text-muted">{t('Clear a name to remove that tier. A tier still used by a customer can’t be removed until you move them.')}</p>
          {edit && <div><SubmitButton>{t('Save tiers')}</SubmitButton></div>}
        </ActionForm>
      </Card>
    </>
  );
}
