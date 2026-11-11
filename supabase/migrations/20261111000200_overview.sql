-- #108 Overview: per-user tile layout, plus two read-only roll-ups so the
-- Overview's date ranges, 12-month trend and spend-vs-last-year don't page
-- thousands of rows into the app. The roll-ups are SECURITY INVOKER: they run
-- as the caller, so the existing RLS on sales_days and bills (permission and
-- store limits) decides what is counted. Nothing here writes money or posts
-- to the books.

-- Per-user, per-business Overview layout (an ordered list of tile ids).
create table public.overview_layouts (
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  layout text[] not null check (cardinality(layout) <= 40 and array_to_string(layout, ',') ~ '^([a-zA-Z0-9]{1,30}(,|$))*$'),
  updated_at timestamptz not null default now(),
  primary key (user_id, organization_id)
);
create index overview_layouts_org_idx on public.overview_layouts (organization_id);
alter table public.overview_layouts enable row level security;
revoke all on public.overview_layouts from public, anon, authenticated;
grant select on public.overview_layouts to authenticated;
create policy overview_layouts_select on public.overview_layouts for select to authenticated
  using (user_id = (select auth.uid()) and private.is_org_member(organization_id));

-- Save (or reset with an empty/null layout) the caller's own layout. Only the
-- caller's row is ever touched; the business must be one they belong to.
create or replace function public.save_overview_layout(p_org uuid, p_layout text[])
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null or not private.is_org_member(p_org) then
    raise exception 'not a member of this business' using errcode = '42501';
  end if;
  if p_layout is null or cardinality(p_layout) = 0 then
    delete from public.overview_layouts where user_id = v_user and organization_id = p_org;
    return;
  end if;
  if cardinality(p_layout) > 40 or exists (select 1 from unnest(p_layout) t where t is null or t !~ '^[a-zA-Z0-9]{1,30}$') then
    raise exception 'that layout isn''t valid' using errcode = '22023';
  end if;
  insert into public.overview_layouts (user_id, organization_id, layout) values (v_user, p_org, p_layout)
  on conflict (user_id, organization_id) do update set layout = excluded.layout, updated_at = now();
end $$;
revoke all on function public.save_overview_layout(uuid, text[]) from public, anon;
grant execute on function public.save_overview_layout(uuid, text[]) to authenticated;

-- Daily sales rolled up per store and day or month. Net = gross - discounts
-- (excludes tax). sales_with_txns is the net from days that have a
-- transaction count, for an honest average sale (#162).
create or replace function public.sales_rollup(p_org uuid, p_from date, p_to date, p_by text)
returns table (location_id uuid, period date, net_cents bigint, tax_cents bigint, transactions bigint, sales_with_txns_cents bigint, days int, last_day date)
language sql stable security invoker set search_path = '' as $$
  select s.location_id,
         case when p_by = 'month' then date_trunc('month', s.business_date)::date else s.business_date end,
         sum(s.gross_sales_cents - s.discounts_cents)::bigint,
         sum(s.sales_tax_cents)::bigint,
         sum(s.transaction_count)::bigint,
         coalesce(sum(case when s.transaction_count is not null then s.gross_sales_cents - s.discounts_cents end), 0)::bigint,
         count(distinct s.business_date)::int,
         max(s.business_date)
    from public.sales_days s
   where s.organization_id = p_org and s.voided_at is null
     and p_by in ('day', 'month') and p_from is not null and p_to is not null and p_to - p_from between 0 and 1200
     and s.business_date between p_from and p_to
   group by 1, 2
$$;
revoke all on function public.sales_rollup(uuid, date, date, text) from public, anon;
grant execute on function public.sales_rollup(uuid, date, date, text) to authenticated;

-- Bills (not void) by due month: what was due and what is paid.
create or replace function public.bill_month_totals(p_org uuid, p_from date, p_to date)
returns table (month date, total_cents bigint, paid_cents bigint, bills int)
language sql stable security invoker set search_path = '' as $$
  select date_trunc('month', b.due_date)::date, sum(b.total_cents)::bigint, sum(least(b.paid_cents, b.total_cents))::bigint, count(*)::int
    from public.bills b
   where b.organization_id = p_org and b.status <> 'void'
     and p_from is not null and p_to is not null and p_to - p_from between 0 and 1200
     and b.due_date between p_from and p_to
   group by 1
$$;
revoke all on function public.bill_month_totals(uuid, date, date) from public, anon;
grant execute on function public.bill_month_totals(uuid, date, date) to authenticated;
