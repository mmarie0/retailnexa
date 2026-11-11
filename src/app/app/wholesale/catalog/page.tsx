import type { Metadata } from 'next';
import { can } from '@/lib/auth/context';
import { ActionForm } from '@/components/action-form';
import { Card, Field, Notice, PageHeader, Select } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';
import { ReadOnlyNotice } from '../../read-only-notice';
import { itemImageUrls, loadItems, loadSettings, wsContext } from '../_data';
import { saveItemOrder, saveLayout, setItemImage } from '../actions';
import { CatalogDesigner } from './designer';

export const metadata: Metadata = { title: 'Order screen' };

/** How the order screen looks: a list (default) or a grid of tiles you arrange, with photos. */
export default async function CatalogPage() {
  const ctx = await wsContext();
  if (!can(ctx, 'wholesale.catalog.manage')) return <Notice tone="warning">Only owners and admins can change the order screen.</Notice>;
  const [items, s] = await Promise.all([loadItems(ctx.org.id), loadSettings(ctx.org.id)]);
  const active = items.filter((i) => i.is_active).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  const images = await itemImageUrls(active);
  const edit = ctx.access.canWrite;
  return (
    <>
      <PageHeader title="Order screen" description="Products show as a simple list unless you switch to a grid. In the grid you choose the tile size, add photos and drag items into the order you want. Anyone can still switch between list and grid while ordering." />
      <ReadOnlyNotice show={!edit} />
      <Card>
        <ActionForm action={saveLayout} className="flex flex-wrap items-end gap-3">
          <Field label="Opens as" htmlFor="v"><Select id="v" name="view" defaultValue={s.catalog_view}><option value="list">List</option><option value="grid">Grid of tiles</option></Select></Field>
          <Field label="Tile size" htmlFor="sz"><Select id="sz" name="size" defaultValue={s.grid_size}><option value="s">Small</option><option value="m">Medium</option><option value="l">Large</option></Select></Field>
          <label className="flex items-center gap-2 pb-2 text-[15px]"><input type="hidden" name="images" value="false" /><input type="checkbox" name="images" value="true" defaultChecked={s.grid_images} className="size-4 accent-[#3f63de]" />Show photos</label>
          {edit && <SubmitButton size="sm">Save look</SubmitButton>}
        </ActionForm>
      </Card>
      {items.truncated && <p className="text-sm text-muted">Showing the first 20,000 items.</p>}
      {active.length ? (
        edit ? <CatalogDesigner org={ctx.org.id} size={s.grid_size} saveOrder={saveItemOrder} setImage={setItemImage}
          items={active.map((i) => ({ id: i.id, name: i.name, sku: i.sku, category: i.category, subcategory: i.subcategory, image: images.get(i.id) ?? null }))} />
          : null
      ) : <Notice>Add items on the Inventory page first.</Notice>}
      <p className="text-sm text-muted">“Your order” on the order screen follows this arrangement. Customers can also sort by name (A–Z or Z–A) or by most popular, which is what you invoiced in the last 90 days.</p>
    </>
  );
}
