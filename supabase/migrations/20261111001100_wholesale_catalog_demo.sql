-- =============================================================================
-- Wholesale follow-up (owner requests after W1 merged):
-- * Order screen: a list by default; owners can switch to a grid of tiles they
--   arrange (drag and drop), with item photos in a private bucket.
-- * Items get a subcategory; "most popular" sort from invoiced quantities.
-- * Demo accounts flag (made-up data for showing prospects).
-- =============================================================================

alter table public.wholesale_settings
  add column catalog_view text not null default 'list' check (catalog_view in ('list', 'grid')),
  add column grid_size text not null default 'm' check (grid_size in ('s', 'm', 'l')),
  add column grid_images boolean not null default true;

alter table public.items
  add column subcategory text check (subcategory is null or char_length(subcategory) <= 60),
  -- Photo in the private item-images bucket ({org}/{item}/{file}); set via set_item_image.
  add column image_path text check (image_path is null or char_length(image_path) <= 200),
  -- Position in the owner's custom grid order (drag and drop).
  add column sort_order int not null default 0;

-- save_item now keeps the subcategory and puts new items at the end of the custom order.
create or replace function public.save_item(p_org uuid, p_id uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_start numeric := coalesce(nullif(p ->> 'qty', '')::numeric, 0);
begin
  perform private.ws_guard(p_org, 'wholesale.catalog.manage');
  if nullif(btrim(p ->> 'name'), '') is null or char_length(btrim(p ->> 'name')) > 160 then raise exception 'enter the item name' using errcode = '22023'; end if;
  if coalesce(nullif(p ->> 'cost_cents', '')::bigint, 0) not between 0 and 10000000000 or coalesce(nullif(p ->> 'price_cents', '')::bigint, 0) not between 0 and 10000000000 then
    raise exception 'cost and price must be zero or more' using errcode = '22023';
  end if;
  if p_id is null then
    if v_start < 0 or v_start > 100000000 or round(v_start, 3) <> v_start then raise exception 'starting quantity must be zero or more' using errcode = '22023'; end if;
    insert into public.items (organization_id, name, sku, upc, brand, category, vendor, bin, unit, cost_cents, price_cents, case_pack, reorder_at, reorder_qty, created_by)
    values (p_org, btrim(p ->> 'name'), nullif(btrim(left(p ->> 'sku', 60)), ''), nullif(btrim(left(p ->> 'upc', 40)), ''), nullif(btrim(left(p ->> 'brand', 60)), ''),
            nullif(btrim(left(p ->> 'category', 60)), ''), nullif(btrim(left(p ->> 'vendor', 120)), ''), nullif(btrim(left(p ->> 'bin', 30)), ''), nullif(btrim(left(p ->> 'unit', 20)), ''),
            coalesce(nullif(p ->> 'cost_cents', '')::bigint, 0), coalesce(nullif(p ->> 'price_cents', '')::bigint, 0), nullif(p ->> 'case_pack', '')::int,
            nullif(p ->> 'reorder_at', '')::numeric, nullif(p ->> 'reorder_qty', '')::numeric, auth.uid())
    returning id into v_id;
    update public.items set subcategory = nullif(btrim(left(p ->> 'subcategory', 60)), ''),
           sort_order = coalesce((select max(sort_order) + 1 from public.items where organization_id = p_org), 0)
     where id = v_id;
    if v_start <> 0 then perform private.ws_move(p_org, v_id, v_start, 'start', 'Starting quantity', null); end if;
    return v_id;
  end if;
  -- On-hand quantity is never set here; use adjust_stock.
  update public.items set name = btrim(p ->> 'name'), sku = nullif(btrim(left(p ->> 'sku', 60)), ''), upc = nullif(btrim(left(p ->> 'upc', 40)), ''),
         brand = nullif(btrim(left(p ->> 'brand', 60)), ''), category = nullif(btrim(left(p ->> 'category', 60)), ''),
         subcategory = nullif(btrim(left(p ->> 'subcategory', 60)), ''), vendor = nullif(btrim(left(p ->> 'vendor', 120)), ''),
         bin = nullif(btrim(left(p ->> 'bin', 30)), ''), unit = nullif(btrim(left(p ->> 'unit', 20)), ''),
         cost_cents = coalesce(nullif(p ->> 'cost_cents', '')::bigint, 0), price_cents = coalesce(nullif(p ->> 'price_cents', '')::bigint, 0),
         case_pack = nullif(p ->> 'case_pack', '')::int, reorder_at = nullif(p ->> 'reorder_at', '')::numeric, reorder_qty = nullif(p ->> 'reorder_qty', '')::numeric,
         is_active = coalesce((p ->> 'active')::boolean, true)
   where id = p_id and organization_id = p_org;
  if not found then raise exception 'that item was not found' using errcode = '22023'; end if;
  return p_id;
end $$;

-- ---------------------------------------------------------------------------
-- Catalog layout, photos, custom order and popularity (order screen)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('item-images', 'item-images', false, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Upload path: {org}/{item}/{file}. Write: catalog managers of a writable Wholesale business, existing item.
create or replace function private.item_image_writable(p_name text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid; v_item uuid; v_parts text[] := string_to_array(p_name, '/');
begin
  if cardinality(v_parts) <> 3 or v_parts[3] !~ '^[0-9a-f-]{36}\.(jpg|png|webp)$' then return false; end if;
  begin v_org := v_parts[1]::uuid; v_item := v_parts[2]::uuid; exception when others then return false; end;
  return private.has_permission(v_org, 'wholesale.catalog.manage') and private.org_is_writable(v_org)
     and exists (select 1 from public.organizations o where o.id = v_org and o.business_type in ('wholesale', 'both'))
     and exists (select 1 from public.items i where i.id = v_item and i.organization_id = v_org);
end $$;
create or replace function private.item_image_readable(p_name text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid;
begin
  begin v_org := split_part(p_name, '/', 1)::uuid; exception when others then return false; end;
  return private.ws_can(v_org, array['inventory.view', 'wholesale.orders.view', 'wholesale.catalog.manage']);
end $$;
revoke all on function private.item_image_writable(text), private.item_image_readable(text) from public, anon;
grant execute on function private.item_image_writable(text), private.item_image_readable(text) to authenticated;
create policy item_images_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'item-images' and private.item_image_writable(name));
create policy item_images_select on storage.objects for select to authenticated
  using (bucket_id = 'item-images' and private.item_image_readable(name));

-- Point an item at its uploaded photo (the object must exist under that item), or clear it.
create or replace function public.set_item_image(p_org uuid, p_item uuid, p_path text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.ws_guard(p_org, 'wholesale.catalog.manage');
  if p_path is not null then
    if p_path not like p_org::text || '/' || p_item::text || '/%'
       or not exists (select 1 from storage.objects o where o.bucket_id = 'item-images' and o.name = p_path) then
      raise exception 'upload the photo first' using errcode = '22023';
    end if;
  end if;
  update public.items set image_path = p_path where id = p_item and organization_id = p_org;
  if not found then raise exception 'that item was not found' using errcode = '22023'; end if;
end $$;

-- List or grid, tile size, photos on/off.
create or replace function public.save_catalog_layout(p_org uuid, p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.ws_guard(p_org, 'wholesale.catalog.manage');
  if coalesce(p ->> 'view', 'list') not in ('list', 'grid') or coalesce(p ->> 'size', 'm') not in ('s', 'm', 'l') then
    raise exception 'pick list or grid and a tile size' using errcode = '22023';
  end if;
  perform private.ws_settings(p_org);
  update public.wholesale_settings set catalog_view = coalesce(p ->> 'view', 'list'), grid_size = coalesce(p ->> 'size', 'm'),
         grid_images = coalesce((p ->> 'images')::boolean, true)
   where organization_id = p_org;
end $$;

-- Custom order from drag and drop: items in the order given, the rest after.
create or replace function public.set_item_order(p_org uuid, p_ids uuid[])
returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  perform private.ws_guard(p_org, 'wholesale.catalog.manage');
  if p_ids is null or cardinality(p_ids) not between 1 and 5000 then raise exception 'nothing to sort' using errcode = '22023'; end if;
  update public.items i set sort_order = x.ord::int
    from unnest(p_ids) with ordinality as x(id, ord)
   where i.id = x.id and i.organization_id = p_org;
  get diagnostics n = row_count;
  update public.items set sort_order = cardinality(p_ids) + 1 where organization_id = p_org and not (id = any (p_ids));
  return n;
end $$;

-- How much of each item was invoiced in the last N days (for "most popular"). Quantities only.
create or replace function public.item_popularity(p_org uuid, p_days int default 90)
returns table (item_id uuid, qty numeric) language sql stable security definer set search_path = '' as $$
  select l.item_id, sum(l.qty)
    from public.customer_invoice_lines l
    join public.customer_invoices i on i.id = l.invoice_id
   where l.organization_id = p_org and l.item_id is not null and i.voided_at is null
     and i.invoice_date >= private.org_today(p_org) - least(greatest(coalesce(p_days, 90), 1), 730)
     and private.ws_can(p_org, array['inventory.view', 'wholesale.orders.view', 'wholesale.catalog.manage'])
   group by l.item_id
$$;

revoke all on function public.set_item_image(uuid, uuid, text), public.save_catalog_layout(uuid, jsonb), public.set_item_order(uuid, uuid[]), public.item_popularity(uuid, int) from public, anon;
grant execute on function public.set_item_image(uuid, uuid, text), public.save_catalog_layout(uuid, jsonb), public.set_item_order(uuid, uuid[]), public.item_popularity(uuid, int) to authenticated;

-- ---------------------------------------------------------------------------
-- Demo accounts (made-up data to show prospects; never counted as customers)
-- ---------------------------------------------------------------------------
alter table public.organizations add column is_demo boolean not null default false;

-- A superadmin marks a business they own as a demo (the app creates and fills it).
create or replace function public.admin_mark_demo(p_org uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_platform_admin(array['superadmin']::public.platform_role[]) then raise exception 'permission denied' using errcode = '42501'; end if;
  if private.member_role(p_org) is distinct from 'owner' then raise exception 'you must own the demo business' using errcode = '42501'; end if;
  update public.organizations set is_demo = true where id = p_org;
  perform private.log_audit(p_org, 'platform_admin', 'organization.marked_demo', 'organization', p_org::text, '{}'::jsonb);
end $$;
revoke all on function public.admin_mark_demo(uuid) from public, anon;
grant execute on function public.admin_mark_demo(uuid) to authenticated;

