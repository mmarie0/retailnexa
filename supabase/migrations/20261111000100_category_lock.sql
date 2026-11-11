-- #163: two simultaneous first uploads of a month's category report could both
-- commit and leave a mix of both. Serialize replacements per (business, store,
-- month) with a transaction advisory lock, so the last writer fully replaces
-- the month. Function-only change: no data is deleted or rewritten.
-- No per-row audit trigger on category_sales on purpose: this function is the
-- only writer (direct writes are revoked) and already logs one
-- category_sales.replaced entry per upload; a row trigger would add up to
-- 4,000 audit rows per replacement.

create or replace function public.save_category_month(p_org uuid, p_location uuid, p_month date, p_rows jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare v_loc uuid := private.sales_store(p_org, p_location); v_month date; n int;
begin
  if p_month is null or not isfinite(p_month) or p_month < '2000-01-01' or p_month > private.org_today(p_org) then
    raise exception 'pick a month that has started' using errcode = '22023';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) not between 1 and 2000 then
    raise exception 'the report needs 1 to 2000 categories' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_rows) r where nullif(btrim(r ->> 'category'), '') is null or (r ->> 'sales_cents') is null) then
    raise exception 'every row needs a category and sales' using errcode = '22023';
  end if;
  v_month := date_trunc('month', p_month)::date;
  perform pg_advisory_xact_lock(hashtextextended('category_month:' || p_org::text || ':' || v_loc::text || ':' || v_month::text, 0));
  delete from public.category_sales where organization_id = p_org and location_id = v_loc and month = v_month;
  insert into public.category_sales (organization_id, location_id, month, category, sales_cents, quantity)
  select p_org, v_loc, v_month, min(left(btrim(r ->> 'category'), 120)), sum((r ->> 'sales_cents')::bigint), sum((r ->> 'quantity')::numeric)
    from jsonb_array_elements(p_rows) r group by lower(left(btrim(r ->> 'category'), 120));
  get diagnostics n = row_count;
  perform private.log_audit(p_org, 'user', 'category_sales.replaced', 'location', v_loc::text, jsonb_build_object('month', v_month, 'categories', n));
  return n;
end $$;

revoke all on function public.save_category_month(uuid, uuid, date, jsonb) from public, anon;
grant execute on function public.save_category_month(uuid, uuid, date, jsonb) to authenticated;

