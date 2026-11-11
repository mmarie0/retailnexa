import type { Metadata } from 'next';
import { can } from '@/lib/auth/context';
import { ActionForm } from '@/components/action-form';
import { Badge, Card, EmptyState, Field, Input, Notice, PageHeader, Select } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';
import { centsToInput } from '@/lib/money';
import { ADJUST_REASONS, committed, fmtQty, reorderSuggestion, stockValue } from '@/lib/wholesale/ledger';
import { ReadOnlyNotice } from '../../read-only-notice';
import { Stat } from '../../_dashboard/tiles';
import { loadItems, loadOpenLines, loadSettings, wsContext, type Item } from '../_data';
import { Pills, SearchBox, money, money0 } from '../_ui';
import { adjustStock, deleteItem, saveItem } from '../actions';
import { getT } from '@/lib/i18n/server';

export const metadata: Metadata = { title: 'Products & inventory' };

async function ItemFields({ it, markup }: { it?: Item; markup: number }) {
  const t = await getT();
  const p = it?.id ?? 'new';
  const f = (name: keyof Item, label: string, max: number, ph?: string) => (
    <Field label={t(label)} htmlFor={`${p}-${name}`}><Input id={`${p}-${name}`} name={name} defaultValue={(it?.[name] as string | null) ?? ''} maxLength={max} placeholder={ph} /></Field>
  );
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <input type="hidden" name="id" value={it?.id ?? ''} />
      <div className="sm:col-span-2"><Field label={t('Item name')} htmlFor={`${p}-name`}><Input id={`${p}-name`} name="name" defaultValue={it?.name} required maxLength={160} /></Field></div>
      {f('sku', 'SKU (optional)', 60)}
      {f('brand', 'Brand (optional)', 60)}
      {f('category', 'Category (optional)', 60, 'Hair')}
      {f('subcategory', 'Subcategory (optional)', 60, 'Braiding hair')}
      {f('upc', 'UPC / barcode (optional)', 40)}
      {f('vendor', 'Vendor (optional)', 120)}
      {f('bin', 'Bin / shelf (optional)', 30, 'A-12')}
      {f('unit', 'Unit (optional)', 20, 'each')}
      <Field label={t('Your cost')} htmlFor={`${p}-cost`}><Input id={`${p}-cost`} name="cost" inputMode="decimal" className="num" defaultValue={it ? centsToInput(it.cost_cents) : ''} placeholder="2.50" /></Field>
      <Field label={t('Wholesale price')} htmlFor={`${p}-price`} hint={t('List price before tier discounts. At your {v0}% markup, price = cost × {v1}.', { v0: markup, v1: (1 + markup / 100).toFixed(2) })}>
        <Input id={`${p}-price`} name="price" inputMode="decimal" className="num" defaultValue={it ? centsToInput(it.price_cents) : ''} placeholder="4.50" />
      </Field>
      <Field label={t('Case pack (optional)')} htmlFor={`${p}-case`} hint={t('Units per case; reorders round up to it.')}><Input id={`${p}-case`} name="case_pack" type="number" min={1} defaultValue={it?.case_pack ?? ''} className="num" /></Field>
      <Field label={t('Reorder at (optional)')} htmlFor={`${p}-ra`} hint={t('Warn when free stock falls to this.')}><Input id={`${p}-ra`} name="reorder_at" type="number" min={0} step="any" defaultValue={it?.reorder_at ?? ''} className="num" /></Field>
      <Field label={t('Reorder quantity (optional)')} htmlFor={`${p}-rq`}><Input id={`${p}-rq`} name="reorder_qty" type="number" min={0} step="any" defaultValue={it?.reorder_qty ?? ''} className="num" /></Field>
      {!it && <Field label={t('On hand now')} htmlFor="new-qty" hint={t('Later changes go through Adjust stock, so there’s a history.')}><Input id="new-qty" name="qty" type="number" min={0} step="any" defaultValue={0} className="num" /></Field>}
      {it && (
        <label className="flex items-center gap-2 text-[15px]"><input type="hidden" name="active" value="false" /><input type="checkbox" name="active" value="true" defaultChecked={it.is_active} className="size-4 accent-[#3f63de]" />{t('Active (shows on the order screen)')}</label>
      )}
    </div>
  );
}

/** Wholesale inventory: on hand, held by open orders, free to sell, reorder suggestions in case packs, stock value. */
export default async function InventoryPage({ searchParams }: PageProps<'/app/wholesale/inventory'>) {
  const t = await getT();
  const ctx = await wsContext();
  if (!can(ctx, 'inventory.view') && !can(ctx, 'wholesale.catalog.manage')) return <Notice tone="warning">{t('You don’t have access to inventory.')}</Notice>;
  const sp = await searchParams;
  const q = String(sp.q ?? '').trim().toLowerCase(), f = String(sp.f ?? '');
  const [items, lines, settings] = await Promise.all([loadItems(ctx.org.id), loadOpenLines(ctx.org.id), loadSettings(ctx.org.id)]);
  const held = committed(lines);
  const rows = items.map((it) => {
    const h = held.get(it.id) ?? 0;
    return { it, held: h, free: it.qty - h, reorder: reorderSuggestion(it, h) };
  });
  const shown = rows
    .filter(({ it }) => (f === 'inactive' ? !it.is_active : it.is_active))
    .filter((r) => (f === 'reorder' ? r.reorder !== null : f === 'out' ? r.free <= 0 : true))
    .filter(({ it }) => !q || [it.name, it.sku, it.upc, it.brand, it.category, it.subcategory, it.vendor, it.bin].some((v) => v?.toLowerCase().includes(q)));
  const value = stockValue(items);
  const catalog = can(ctx, 'wholesale.catalog.manage') && ctx.access.canWrite, adjust = can(ctx, 'inventory.manage') && ctx.access.canWrite;
  const seeCost = can(ctx, 'wholesale.catalog.manage') || can(ctx, 'inventory.manage');

  return (
    <>
      <PageHeader title={t('Products & inventory')} description={t('Your products: what’s on hand, what open orders are holding, what’s free to sell, and what to reorder.')} />
      <ReadOnlyNotice show={(can(ctx, 'wholesale.catalog.manage') || can(ctx, 'inventory.manage')) && !ctx.access.canWrite} />
      {items.length > 0 && (
        <div className="grid grid-cols-3 gap-3 max-[520px]:grid-cols-1">
          {seeCost && <Stat block="blue" label={t('Stock at cost')} value={money0(value.cost)} sub={t('{v0} at wholesale price', { v0: money0(value.price) })} />}
          <Stat label={t('Items')} value={String(rows.filter((r) => r.it.is_active).length)} sub={t('{v0} out of stock', { v0: rows.filter((r) => r.it.is_active && r.free <= 0).length })} />
          <Stat block={rows.some((r) => r.reorder !== null) ? 'coral' : undefined} label={t('To reorder')} value={String(rows.filter((r) => r.reorder !== null).length)} href="/app/wholesale/inventory?f=reorder" />
        </div>
      )}
      {items.length > 0 && (
        <>
          <SearchBox action="/app/wholesale/inventory" q={String(sp.q ?? '')} placeholder={t('Search name, SKU, UPC, brand, bin')} hidden={f ? { f } : undefined} />
          <Pills base="/app/wholesale/inventory" current={f} items={[['', 'All'], ['reorder', 'Reorder'], ['out', 'Out of stock'], ['inactive', 'Inactive']]} />
        </>
      )}
      {items.truncated && <p className="text-sm text-muted">{t('Showing the first 20,000 items.')}</p>}
      {shown.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {shown.map(({ it, held: h, free, reorder }) => (
            <li key={it.id}>
              <Card className="flex flex-col gap-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-bold">{it.name}</p>
                    <p className="text-sm text-muted">{[it.sku && `SKU ${it.sku}`, it.brand, [it.category, it.subcategory].filter(Boolean).join(' › ') || null, it.bin && `Bin ${it.bin}`, it.case_pack && `${it.case_pack}/case`].filter(Boolean).join(' · ') || t('No SKU')}</p>
                  </div>
                  <div className="text-end">
                    <p className="num font-semibold">{money(it.price_cents)}{seeCost && <span className="font-normal text-muted"> {t('· cost')} {money(it.cost_cents)}</span>}</p>
                    {reorder !== null && <Badge tone="warning">{t('Reorder')} {fmtQty(reorder)}</Badge>}
                    {free <= 0 && it.is_active && <Badge tone="danger">{t('Out')}</Badge>}
                  </div>
                </div>
                <dl className="grid grid-cols-3 gap-2 text-center text-sm">
                  {([['On hand', it.qty], ['On open orders', h], ['Free to sell', free]] as [string, number][]).map(([k, v]) => (
                    <div key={k} className="rounded-xl bg-soft px-2 py-1.5"><dt className="text-xs text-muted">{k}</dt><dd className={v < 0 ? 'num font-semibold text-late' : 'num font-semibold'}>{fmtQty(v)}</dd></div>
                  ))}
                </dl>
                {adjust && (
                  <details>
                    <summary className="cursor-pointer font-semibold text-accent-strong">{t('Adjust stock')}</summary>
                    <ActionForm action={adjustStock} className="mt-2 grid gap-2 sm:grid-cols-3">
                      <input type="hidden" name="item_id" value={it.id} />
                      <Field label={t('Add (or −remove)')} htmlFor={`a-${it.id}`}><Input id={`a-${it.id}`} name="qty" type="number" step="any" required className="num" placeholder={t('12 or -2')} /></Field>
                      <Field label={t('Reason')} htmlFor={`r-${it.id}`}><Select id={`r-${it.id}`} name="reason">{ADJUST_REASONS.map((r) => <option key={r} value={r}>{t(r)}</option>)}</Select></Field>
                      <div className="flex items-end"><SubmitButton size="sm">{t('Save')}</SubmitButton></div>
                    </ActionForm>
                  </details>
                )}
                {catalog && (
                  <details>
                    <summary className="cursor-pointer text-sm font-semibold text-muted">{t('Edit')}</summary>
                    <ActionForm action={saveItem} className="mt-2 flex flex-col gap-3"><ItemFields it={it} markup={settings.markup} /><div><SubmitButton size="sm">{t('Save changes')}</SubmitButton></div></ActionForm>
                    <ActionForm action={deleteItem} className="mt-2"><input type="hidden" name="id" value={it.id} /><SubmitButton variant="danger" size="sm">{t('Delete item')}</SubmitButton></ActionForm>
                  </details>
                )}
              </Card>
            </li>
          ))}
        </ul>
      ) : items.length > 0 ? <p className="text-muted">{t('No items match.')}</p> : (
        <EmptyState title={t('No items yet')}>{catalog ? t('Add the products you sell below.') : t('An owner or admin can add items.')}</EmptyState>
      )}
      {catalog && (
        <Card id="add">
          <h2 className="text-lg font-bold">{t('Add an item')}</h2>
          <ActionForm action={saveItem} className="mt-3 flex flex-col gap-3"><ItemFields markup={settings.markup} /><div><SubmitButton>{t('Add item')}</SubmitButton></div></ActionForm>
        </Card>
      )}
    </>
  );
}
