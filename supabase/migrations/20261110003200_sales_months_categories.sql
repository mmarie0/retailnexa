-- =============================================================================
-- Batch C (#103, #112): monthly sales reports and category reports.
-- RetailNexa isn't a POS (owner): at month end the store uploads its POS's
-- monthly report, which carries what daily entries don't (transactions, store
-- card, points). Category reports are uploaded per month and compared with the
-- month before and the same month last year. Both are report data only: daily
-- sales still post to the books; these never do.
-- Read: sales.view + store access. Write: sales.import through the RPCs.
-- =============================================================================

create table public.sales_months (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  location_id uuid not null,
  month date not null check (extract(day from month) = 1 and month between '2000-01-01' and '2100-12-01'),
  sales_cents bigint not null check (sales_cents between 0 and 100000000000),
  gross_cents bigint check (gross_cents is null or gross_cents between 0 and 100000000000),
  tax_cents bigint not null default 0 check (tax_cents between 0 and 100000000000),
  cash_cents bigint not null default 0 check (cash_cents between 0 and 100000000000),
  card_cents bigint not null default 0 check (card_cents between 0 and 100000000000),
  store_card_cents bigint not null default 0 check (store_card_cents between 0 and 100000000000),
  points_cents bigint not null default 0 check (points_cents between 0 and 100000000000),
  transactions int check (transactions is null or transactions between 0 and 100000000),
  note text check (note is null or char_length(note) <= 300),
  source text not null default 'manual' check (source in ('manual', 'csv')),
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, location_id, month),
  foreign key (organization_id, location_id) references public.locations (organization_id, id)
);
create index sales_months_updated_by_idx on public.sales_months (updated_by);

create table public.category_sales (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  location_id uuid not null,
  month date not null check (extract(day from month) = 1 and month between '2000-01-01' and '2100-12-01'),
  category text not null check (char_length(btrim(category)) between 1 and 120),
  sales_cents bigint not null check (sales_cents between -100000000000 and 100000000000),
  quantity numeric(12, 2) check (quantity is null or quantity between -100000000 and 100000000),
  created_at timestamptz not null default now(),
  foreign key (organization_id, location_id) references public.locations (organization_id, id)
);
create unique index category_sales_uidx on public.category_sales (organization_id, location_id, month, lower(btrim(category)));
create index category_sales_org_month_idx on public.category_sales (organization_id, month);

create trigger sales_months_updated_at before update on public.sales_months for each row execute function private.set_updated_at();
create trigger audit_sales_months after insert or update or delete on public.sales_months for each row execute function private.audit_row_change();

alter table public.sales_months enable row level security;
alter table public.category_sales enable row level security;
revoke all on public.sales_months, public.category_sales from anon, authenticated;
grant select on public.sales_months, public.category_sales to authenticated;
grant all on public.sales_months, public.category_sales to service_role;
create policy sales_months_select on public.sales_months for select to authenticated
  using ((private.has_permission(organization_id, 'sales.view') and private.can_access_location(organization_id, location_id))
         or private.has_support_access(organization_id));
create policy category_sales_select on public.category_sales for select to authenticated
  using ((private.has_permission(organization_id, 'sales.view') and private.can_access_location(organization_id, location_id))
         or private.has_support_access(organization_id));

create or replace function private.sales_store(p_org uuid, p_location uuid)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v uuid;
begin
  perform private.require_user();
  if not private.has_permission(p_org, 'sales.import') or not private.org_is_writable(p_org) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if p_location is not null and not exists (select 1 from public.locations l where l.id = p_location and l.organization_id = p_org) then
    raise exception 'store not found' using errcode = 'P0002';
  end if;
  v := private.default_location(p_org, p_location);
  if v is null then
    select l.id into v from public.locations l where l.organization_id = p_org and l.is_active and l.kind = 'store'
      and (select count(*) from public.locations x where x.organization_id = p_org and x.is_active and x.kind = 'store') = 1;
  end if;
  if v is null then raise exception 'pick the store' using errcode = '22023'; end if;
  if not private.can_access_location(p_org, v) then
    raise exception 'permission denied: this record belongs to a store you don''t have access to' using errcode = '42501';
  end if;
  return v;
end $$;

-- Add or replace one store's monthly report. p: {sales_cents, gross_cents, tax_cents, cash_cents,
-- card_cents, store_card_cents, points_cents, transactions, note}
create or replace function public.save_sales_month(p_org uuid, p_location uuid, p_month date, p jsonb, p_source text default 'manual')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_loc uuid := private.sales_store(p_org, p_location); v_id uuid; v_month date;
begin
  if p_month is null or not isfinite(p_month) or p_month < '2000-01-01' or p_month > private.org_today(p_org) then
    raise exception 'pick a month that has started' using errcode = '22023';
  end if;
  v_month := date_trunc('month', p_month)::date;
  if jsonb_typeof(p) <> 'object' or coalesce((p ->> 'sales_cents')::bigint, -1) < 0 then
    raise exception 'enter the month''s sales' using errcode = '22023';
  end if;
  insert into public.sales_months (organization_id, location_id, month, sales_cents, gross_cents, tax_cents, cash_cents, card_cents,
                                   store_card_cents, points_cents, transactions, note, source, updated_by)
  values (p_org, v_loc, v_month, (p ->> 'sales_cents')::bigint, (p ->> 'gross_cents')::bigint, coalesce((p ->> 'tax_cents')::bigint, 0),
          coalesce((p ->> 'cash_cents')::bigint, 0), coalesce((p ->> 'card_cents')::bigint, 0), coalesce((p ->> 'store_card_cents')::bigint, 0),
          coalesce((p ->> 'points_cents')::bigint, 0), (p ->> 'transactions')::int, left(nullif(btrim(p ->> 'note'), ''), 300),
          case when p_source = 'csv' then 'csv' else 'manual' end, auth.uid())
  on conflict (organization_id, location_id, month) do update set
    sales_cents = excluded.sales_cents, gross_cents = excluded.gross_cents, tax_cents = excluded.tax_cents, cash_cents = excluded.cash_cents,
    card_cents = excluded.card_cents, store_card_cents = excluded.store_card_cents, points_cents = excluded.points_cents,
    transactions = excluded.transactions, note = excluded.note, source = excluded.source, updated_by = excluded.updated_by
  returning id into v_id;
  return v_id;
end $$;

-- Replace one store's category report for a month. p_rows: [{category, sales_cents, quantity}]
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
  delete from public.category_sales where organization_id = p_org and location_id = v_loc and month = v_month;
  insert into public.category_sales (organization_id, location_id, month, category, sales_cents, quantity)
  select p_org, v_loc, v_month, min(left(btrim(r ->> 'category'), 120)), sum((r ->> 'sales_cents')::bigint), sum((r ->> 'quantity')::numeric)
    from jsonb_array_elements(p_rows) r group by lower(left(btrim(r ->> 'category'), 120));
  get diagnostics n = row_count;
  perform private.log_audit(p_org, 'user', 'category_sales.replaced', 'location', v_loc::text, jsonb_build_object('month', v_month, 'categories', n));
  return n;
end $$;

revoke all on function private.sales_store(uuid, uuid) from public, anon, authenticated;
revoke all on function public.save_sales_month(uuid, uuid, date, jsonb, text), public.save_category_month(uuid, uuid, date, jsonb) from public, anon;
grant execute on function public.save_sales_month(uuid, uuid, date, jsonb, text), public.save_category_month(uuid, uuid, date, jsonb) to authenticated;
