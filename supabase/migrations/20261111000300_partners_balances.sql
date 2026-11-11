-- =============================================================================
-- Parity batch D (part 1)
--   #106 Location balances: what other stores owe this store and what it owes
--        them, with payments, a "month it counts in" and a month-end check.
--        Read with bills.view + store access; entered with bills.create;
--        payments with bills.pay.
--   #104 Profit partners: partners and split %, distributions (split by %),
--        payments to each partner, and manual profit for a month (bulk import).
--        Read with profit.view by members who see every store; changed with
--        org.manage + profit.view (owners and admins).
-- These are records only: nothing here posts to the books or moves money.
-- =============================================================================

-- #106 ---------------------------------------------------------------------------
create table public.location_balances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  direction text not null check (direction in ('owed_to_me', 'i_owe')),
  location_id uuid not null,
  other_party text not null check (char_length(btrim(other_party)) between 1 and 100),
  entry_date date not null,
  due_date date,
  count_month date not null check (extract(day from count_month) = 1),
  amount_cents bigint not null check (amount_cents between 1 and 100000000000),
  lines jsonb not null default '[]' check (jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) <= 50),
  reference text check (reference is null or char_length(reference) <= 100),
  note text check (note is null or char_length(note) <= 500),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (due_date is null or due_date >= entry_date),
  unique (organization_id, id),
  foreign key (organization_id, location_id) references public.locations (organization_id, id)
);
create index location_balances_org_loc_idx on public.location_balances (organization_id, location_id);
create index location_balances_org_month_idx on public.location_balances (organization_id, count_month);
create index location_balances_created_by_idx on public.location_balances (created_by);

create table public.location_balance_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  balance_id uuid not null,
  paid_on date not null,
  amount_cents bigint not null check (amount_cents between 1 and 100000000000),
  method text not null check (method in ('cash', 'check', 'ach', 'zelle', 'card', 'offset', 'other')),
  reference text check (reference is null or char_length(reference) <= 100),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (organization_id, balance_id) references public.location_balances (organization_id, id) on delete cascade
);
create index location_balance_payments_balance_idx on public.location_balance_payments (organization_id, balance_id);
create index location_balance_payments_created_by_idx on public.location_balance_payments (created_by);

create trigger location_balances_updated_at before update on public.location_balances for each row execute function private.set_updated_at();
create trigger audit_location_balances after insert or update or delete on public.location_balances for each row execute function private.audit_row_change();
create trigger audit_location_balance_payments after insert or update or delete on public.location_balance_payments for each row execute function private.audit_row_change();

alter table public.location_balances enable row level security;
alter table public.location_balance_payments enable row level security;
revoke all on public.location_balances, public.location_balance_payments from anon, authenticated;
grant select on public.location_balances, public.location_balance_payments to authenticated;
grant all on public.location_balances, public.location_balance_payments to service_role;
create policy location_balances_select on public.location_balances for select to authenticated
  using ((private.has_permission(organization_id, 'bills.view') and private.can_access_location(organization_id, location_id))
         or private.has_support_access(organization_id));
create policy location_balance_payments_select on public.location_balance_payments for select to authenticated
  using (exists (select 1 from public.location_balances b where b.id = location_balance_payments.balance_id and b.organization_id = location_balance_payments.organization_id
                   and ((private.has_permission(b.organization_id, 'bills.view') and private.can_access_location(b.organization_id, b.location_id))
                        or private.has_support_access(b.organization_id))));

-- Guard shared by the writers: permission, writable business, store access.
create or replace function private.balance_guard(p_org uuid, p_location uuid, p_perm text)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_user();
  if not private.has_permission(p_org, p_perm) or not private.org_is_writable(p_org) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if p_location is null or not exists (select 1 from public.locations l where l.id = p_location and l.organization_id = p_org) then
    raise exception 'pick one of your stores' using errcode = '22023';
  end if;
  if not private.can_access_location(p_org, p_location) then
    raise exception 'permission denied: that is a store you don''t have access to' using errcode = '42501';
  end if;
end $$;
revoke all on function private.balance_guard(uuid, uuid, text) from public, anon, authenticated;

-- Add (p_id null) or change a balance. p: direction, location_id, other_party,
-- entry_date, due_date, count_month, amount_cents, lines[{description, amount_cents}], reference, note.
create or replace function public.save_location_balance(p_org uuid, p_id uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_loc uuid := private.default_location(p_org, nullif(p ->> 'location_id', '')::uuid);
  v_amount bigint := (p ->> 'amount_cents')::bigint;
  v_lines jsonb := coalesce(p -> 'lines', '[]'::jsonb);
  v_entry date := (p ->> 'entry_date')::date;
  v_month date := date_trunc('month', coalesce(nullif(p ->> 'count_month', '')::date, (p ->> 'entry_date')::date))::date;
  v_paid bigint; v_id uuid; v_old public.location_balances;
begin
  perform private.balance_guard(p_org, v_loc, 'bills.create');
  if coalesce(p ->> 'direction', '') not in ('owed_to_me', 'i_owe') then raise exception 'pick who owes whom' using errcode = '22023'; end if;
  if v_entry is null or v_entry < '2000-01-01' or v_entry > private.org_today(p_org) + 366 then raise exception 'enter a real date' using errcode = '22023'; end if;
  if v_amount is null or v_amount < 1 or v_amount > 100000000000 then raise exception 'enter an amount over zero' using errcode = '22023'; end if;
  if jsonb_typeof(v_lines) <> 'array' or jsonb_array_length(v_lines) > 50
     or exists (select 1 from jsonb_array_elements(v_lines) l where nullif(btrim(l ->> 'description'), '') is null or (l ->> 'amount_cents') is null
                  or char_length(l ->> 'description') > 120 or abs((l ->> 'amount_cents')::bigint) > 100000000000)
     or (jsonb_array_length(v_lines) > 0 and (select sum((l ->> 'amount_cents')::bigint) from jsonb_array_elements(v_lines) l) <> v_amount) then
    raise exception 'each line needs a description and amount, and the lines must add up to the total' using errcode = '22023';
  end if;
  if p_id is null then
    insert into public.location_balances (organization_id, direction, location_id, other_party, entry_date, due_date, count_month, amount_cents, lines, reference, note, created_by)
    values (p_org, p ->> 'direction', v_loc, btrim(p ->> 'other_party'), v_entry, nullif(p ->> 'due_date', '')::date, v_month, v_amount, v_lines,
            nullif(btrim(p ->> 'reference'), ''), nullif(btrim(p ->> 'note'), ''), auth.uid())
    returning id into v_id;
    return v_id;
  end if;
  select * into v_old from public.location_balances where id = p_id and organization_id = p_org for update;
  if not found then raise exception 'that balance was not found' using errcode = '22023'; end if;
  perform private.balance_guard(p_org, v_old.location_id, 'bills.create');
  select coalesce(sum(amount_cents), 0) into v_paid from public.location_balance_payments where balance_id = p_id;
  if v_amount < v_paid then raise exception 'the amount can''t be less than what was already paid' using errcode = '22023'; end if;
  update public.location_balances set direction = p ->> 'direction', location_id = v_loc, other_party = btrim(p ->> 'other_party'), entry_date = v_entry,
         due_date = nullif(p ->> 'due_date', '')::date, count_month = v_month, amount_cents = v_amount, lines = v_lines,
         reference = nullif(btrim(p ->> 'reference'), ''), note = nullif(btrim(p ->> 'note'), '')
   where id = p_id;
  return p_id;
end $$;

-- Remove a balance with no payments (remove its payments first).
create or replace function public.delete_location_balance(p_org uuid, p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_loc uuid;
begin
  select location_id into v_loc from public.location_balances where id = p_id and organization_id = p_org for update;
  if not found then raise exception 'that balance was not found' using errcode = '22023'; end if;
  perform private.balance_guard(p_org, v_loc, 'bills.create');
  if exists (select 1 from public.location_balance_payments where balance_id = p_id) then
    raise exception 'remove its payments first' using errcode = '22023';
  end if;
  delete from public.location_balances where id = p_id;
end $$;

-- Record a payment (collected or paid). Never more than what is left.
create or replace function public.add_location_balance_payment(p_org uuid, p_balance uuid, p_paid_on date, p_amount_cents bigint, p_method text, p_reference text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_b public.location_balances; v_paid bigint; v_id uuid;
begin
  select * into v_b from public.location_balances where id = p_balance and organization_id = p_org for update;
  if not found then raise exception 'that balance was not found' using errcode = '22023'; end if;
  perform private.balance_guard(p_org, v_b.location_id, 'bills.pay');
  if p_paid_on is null or p_paid_on < '2000-01-01' or p_paid_on > private.org_today(p_org) then raise exception 'enter a payment date that isn''t in the future' using errcode = '22023'; end if;
  if coalesce(p_method, '') not in ('cash', 'check', 'ach', 'zelle', 'card', 'offset', 'other') then raise exception 'pick how it was paid' using errcode = '22023'; end if;
  select coalesce(sum(amount_cents), 0) into v_paid from public.location_balance_payments where balance_id = p_balance;
  if p_amount_cents is null or p_amount_cents < 1 or p_amount_cents > v_b.amount_cents - v_paid then
    raise exception 'the payment must be over zero and no more than what is left' using errcode = '22023';
  end if;
  insert into public.location_balance_payments (organization_id, balance_id, paid_on, amount_cents, method, reference, created_by)
  values (p_org, p_balance, p_paid_on, p_amount_cents, p_method, nullif(btrim(p_reference), ''), auth.uid()) returning id into v_id;
  return v_id;
end $$;

create or replace function public.delete_location_balance_payment(p_org uuid, p_payment uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_loc uuid;
begin
  select b.location_id into v_loc from public.location_balance_payments p join public.location_balances b on b.id = p.balance_id
   where p.id = p_payment and p.organization_id = p_org for update of b;
  if not found then raise exception 'that payment was not found' using errcode = '22023'; end if;
  perform private.balance_guard(p_org, v_loc, 'bills.pay');
  delete from public.location_balance_payments where id = p_payment;
end $$;

-- #104 ---------------------------------------------------------------------------
create table public.partners (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  pct numeric(5,2) not null check (pct >= 0 and pct <= 100),
  is_active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);
create unique index partners_org_name_uidx on public.partners (organization_id, lower(btrim(name)));

create table public.distributions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  dist_date date not null,
  total_cents bigint not null check (total_cents between 1 and 100000000000),
  note text check (note is null or char_length(note) <= 300),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id, id)
);
create index distributions_org_month_idx on public.distributions (organization_id, month);
create index distributions_created_by_idx on public.distributions (created_by);

create table public.distribution_shares (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  distribution_id uuid not null,
  partner_id uuid not null,
  pct numeric(5,2) not null check (pct >= 0 and pct <= 100),
  share_cents bigint not null check (share_cents >= 0),
  unique (distribution_id, partner_id),
  unique (organization_id, id),
  foreign key (organization_id, distribution_id) references public.distributions (organization_id, id) on delete cascade,
  foreign key (organization_id, partner_id) references public.partners (organization_id, id)
);
create index distribution_shares_dist_idx on public.distribution_shares (organization_id, distribution_id);
create index distribution_shares_partner_idx on public.distribution_shares (organization_id, partner_id);

create table public.distribution_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  share_id uuid not null,
  paid_on date not null,
  amount_cents bigint not null check (amount_cents between 1 and 100000000000),
  method text not null check (method in ('check', 'ach', 'cash', 'zelle', 'other')),
  reference text check (reference is null or char_length(reference) <= 100),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (organization_id, share_id) references public.distribution_shares (organization_id, id) on delete cascade
);
create index distribution_payments_share_idx on public.distribution_payments (organization_id, share_id);
create index distribution_payments_created_by_idx on public.distribution_payments (created_by);

-- Manual profit for a month (the owner's "profits" overrides and bulk profit import).
create table public.profit_months (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  profit_cents bigint not null check (profit_cents between -100000000000 and 100000000000),
  note text check (note is null or char_length(note) <= 300),
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, month)
);
create index profit_months_updated_by_idx on public.profit_months (updated_by);

create trigger partners_updated_at before update on public.partners for each row execute function private.set_updated_at();
create trigger profit_months_updated_at before update on public.profit_months for each row execute function private.set_updated_at();
create trigger audit_partners after insert or update or delete on public.partners for each row execute function private.audit_row_change();
create trigger audit_distributions after insert or update or delete on public.distributions for each row execute function private.audit_row_change();
create trigger audit_distribution_payments after insert or update or delete on public.distribution_payments for each row execute function private.audit_row_change();
create trigger audit_profit_months after insert or update or delete on public.profit_months for each row execute function private.audit_row_change();

-- Who may read partner data: profit.view and sees every store (partner money is business-wide).
create or replace function private.can_see_partners(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (private.has_permission(p_org, 'profit.view') and private.can_access_location(p_org, null)) or private.has_support_access(p_org)
$$;
revoke all on function private.can_see_partners(uuid) from public, anon;
grant execute on function private.can_see_partners(uuid) to authenticated;

alter table public.partners enable row level security;
alter table public.distributions enable row level security;
alter table public.distribution_shares enable row level security;
alter table public.distribution_payments enable row level security;
alter table public.profit_months enable row level security;
revoke all on public.partners, public.distributions, public.distribution_shares, public.distribution_payments, public.profit_months from anon, authenticated;
grant select on public.partners, public.distributions, public.distribution_shares, public.distribution_payments, public.profit_months to authenticated;
grant all on public.partners, public.distributions, public.distribution_shares, public.distribution_payments, public.profit_months to service_role;
create policy partners_select on public.partners for select to authenticated using (private.can_see_partners(organization_id));
create policy distributions_select on public.distributions for select to authenticated using (private.can_see_partners(organization_id));
create policy distribution_shares_select on public.distribution_shares for select to authenticated using (private.can_see_partners(organization_id));
create policy distribution_payments_select on public.distribution_payments for select to authenticated using (private.can_see_partners(organization_id));
create policy profit_months_select on public.profit_months for select to authenticated using (private.can_see_partners(organization_id));

create or replace function private.partner_guard(p_org uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_user();
  if not (private.has_permission(p_org, 'org.manage') and private.has_permission(p_org, 'profit.view') and private.can_access_location(p_org, null))
     or not private.org_is_writable(p_org) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
end $$;
revoke all on function private.partner_guard(uuid) from public, anon, authenticated;

-- Replace the partner list. p: [{id?, name, pct, active}]. Active partners must
-- add up to 100%. A partner who was left out is removed, or made inactive when
-- they already have distributions.
create or replace function public.save_partners(p_org uuid, p jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare r jsonb; v_ids uuid[] := '{}'; v_id uuid; i int := 0;
begin
  perform private.partner_guard(p_org);
  if jsonb_typeof(p) <> 'array' or jsonb_array_length(p) > 30 then raise exception 'up to 30 partners' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_array_elements(p) x where nullif(btrim(x ->> 'name'), '') is null or char_length(btrim(x ->> 'name')) > 80
               or (x ->> 'pct') is null or (x ->> 'pct')::numeric < 0 or (x ->> 'pct')::numeric > 100 or round((x ->> 'pct')::numeric, 2) <> (x ->> 'pct')::numeric) then
    raise exception 'each partner needs a name and a share from 0 to 100 percent, two decimals at most' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p) x where coalesce((x ->> 'active')::boolean, true))
     and (select sum((x ->> 'pct')::numeric) from jsonb_array_elements(p) x where coalesce((x ->> 'active')::boolean, true)) <> 100 then
    raise exception 'active partners must add up to 100 percent' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('partners:' || p_org::text, 0));
  for r in select * from jsonb_array_elements(p) loop
    i := i + 1;
    -- Match by id, else by name, so re-saving a list without ids doesn't duplicate anyone.
    v_id := coalesce(nullif(r ->> 'id', '')::uuid,
                     (select id from public.partners where organization_id = p_org and lower(btrim(name)) = lower(btrim(r ->> 'name'))));
    if v_id is not null and exists (select 1 from public.partners where id = v_id and organization_id = p_org) then
      update public.partners set name = btrim(r ->> 'name'), pct = (r ->> 'pct')::numeric, is_active = coalesce((r ->> 'active')::boolean, true), sort = i where id = v_id;
    else
      insert into public.partners (organization_id, name, pct, is_active, sort)
      values (p_org, btrim(r ->> 'name'), (r ->> 'pct')::numeric, coalesce((r ->> 'active')::boolean, true), i) returning id into v_id;
    end if;
    v_ids := v_ids || v_id;
  end loop;
  update public.partners set is_active = false where organization_id = p_org and not (id = any (v_ids))
     and exists (select 1 from public.distribution_shares s where s.partner_id = partners.id);
  delete from public.partners where organization_id = p_org and not (id = any (v_ids))
     and not exists (select 1 from public.distribution_shares s where s.partner_id = partners.id);
  return i;
end $$;

-- Record a distribution and split it among the active partners by their %.
-- Rounding cents go to the largest share(s) so the shares add up to the total.
create or replace function public.create_distribution(p_org uuid, p_month date, p_dist_date date, p_total_cents bigint, p_note text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_left bigint;
begin
  perform private.partner_guard(p_org);
  if p_month is null or p_month < '2000-01-01' or p_month > private.org_today(p_org) then raise exception 'pick a month that has started' using errcode = '22023'; end if;
  if p_dist_date is null or p_dist_date < '2000-01-01' or p_dist_date > private.org_today(p_org) + 366 then raise exception 'enter a real date' using errcode = '22023'; end if;
  if p_total_cents is null or p_total_cents < 1 or p_total_cents > 100000000000 then raise exception 'enter an amount over zero' using errcode = '22023'; end if;
  if coalesce((select sum(pct) from public.partners where organization_id = p_org and is_active), 0) <> 100 then
    raise exception 'set up partners that add up to 100 percent first' using errcode = '22023';
  end if;
  insert into public.distributions (organization_id, month, dist_date, total_cents, note, created_by)
  values (p_org, date_trunc('month', p_month)::date, p_dist_date, p_total_cents, nullif(btrim(p_note), ''), auth.uid()) returning id into v_id;
  insert into public.distribution_shares (organization_id, distribution_id, partner_id, pct, share_cents)
  select p_org, v_id, id, pct, floor(p_total_cents * pct / 100)::bigint from public.partners where organization_id = p_org and is_active;
  select p_total_cents - sum(share_cents) into v_left from public.distribution_shares where distribution_id = v_id;
  -- Hand out leftover cents one at a time, biggest share first (ties by name).
  update public.distribution_shares s set share_cents = s.share_cents + 1
    from (select ds.id from public.distribution_shares ds join public.partners pa on pa.id = ds.partner_id
           where ds.distribution_id = v_id and ds.pct > 0 order by ds.pct desc, lower(pa.name) limit v_left) x
   where s.id = x.id;
  return v_id;
end $$;

create or replace function public.delete_distribution(p_org uuid, p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.partner_guard(p_org);
  if not exists (select 1 from public.distributions where id = p_id and organization_id = p_org) then
    raise exception 'that distribution was not found' using errcode = '22023';
  end if;
  if exists (select 1 from public.distribution_payments dp join public.distribution_shares s on s.id = dp.share_id where s.distribution_id = p_id) then
    raise exception 'remove its payments first' using errcode = '22023';
  end if;
  delete from public.distributions where id = p_id;
end $$;

-- Pay a partner's share (checks can be split into several payments).
create or replace function public.add_distribution_payment(p_org uuid, p_share uuid, p_paid_on date, p_amount_cents bigint, p_method text, p_reference text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_share bigint; v_paid bigint; v_id uuid;
begin
  perform private.partner_guard(p_org);
  select share_cents into v_share from public.distribution_shares where id = p_share and organization_id = p_org for update;
  if not found then raise exception 'that share was not found' using errcode = '22023'; end if;
  if p_paid_on is null or p_paid_on < '2000-01-01' or p_paid_on > private.org_today(p_org) then raise exception 'enter a payment date that isn''t in the future' using errcode = '22023'; end if;
  if coalesce(p_method, '') not in ('check', 'ach', 'cash', 'zelle', 'other') then raise exception 'pick how it was paid' using errcode = '22023'; end if;
  select coalesce(sum(amount_cents), 0) into v_paid from public.distribution_payments where share_id = p_share;
  if p_amount_cents is null or p_amount_cents < 1 or p_amount_cents > v_share - v_paid then
    raise exception 'the payment must be over zero and no more than what is left' using errcode = '22023';
  end if;
  insert into public.distribution_payments (organization_id, share_id, paid_on, amount_cents, method, reference, created_by)
  values (p_org, p_share, p_paid_on, p_amount_cents, p_method, nullif(btrim(p_reference), ''), auth.uid()) returning id into v_id;
  return v_id;
end $$;

create or replace function public.delete_distribution_payment(p_org uuid, p_payment uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.partner_guard(p_org);
  delete from public.distribution_payments where id = p_payment and organization_id = p_org;
  if not found then raise exception 'that payment was not found' using errcode = '22023'; end if;
end $$;

-- Set or clear manual profit for months. p: [{month, profit_cents|null, note}], up to 120.
create or replace function public.save_profit_months(p_org uuid, p jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare r jsonb; v_month date; n int := 0;
begin
  perform private.partner_guard(p_org);
  if jsonb_typeof(p) <> 'array' or jsonb_array_length(p) not between 1 and 120 then raise exception 'send 1 to 120 months' using errcode = '22023'; end if;
  for r in select * from jsonb_array_elements(p) loop
    v_month := date_trunc('month', (r ->> 'month')::date)::date;
    if v_month is null or v_month < '2000-01-01' or v_month > private.org_today(p_org) then raise exception 'pick months that have started' using errcode = '22023'; end if;
    if (r ->> 'profit_cents') is null then
      delete from public.profit_months where organization_id = p_org and month = v_month;
    else
      if abs((r ->> 'profit_cents')::bigint) > 100000000000 then raise exception 'that profit is too large' using errcode = '22023'; end if;
      insert into public.profit_months (organization_id, month, profit_cents, note, updated_by)
      values (p_org, v_month, (r ->> 'profit_cents')::bigint, nullif(btrim(left(r ->> 'note', 300)), ''), auth.uid())
      on conflict (organization_id, month) do update set profit_cents = excluded.profit_cents, note = excluded.note, updated_by = excluded.updated_by;
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

revoke all on function public.save_location_balance(uuid, uuid, jsonb), public.delete_location_balance(uuid, uuid),
  public.add_location_balance_payment(uuid, uuid, date, bigint, text, text), public.delete_location_balance_payment(uuid, uuid),
  public.save_partners(uuid, jsonb), public.create_distribution(uuid, date, date, bigint, text), public.delete_distribution(uuid, uuid),
  public.add_distribution_payment(uuid, uuid, date, bigint, text, text), public.delete_distribution_payment(uuid, uuid),
  public.save_profit_months(uuid, jsonb) from public, anon;
grant execute on function public.save_location_balance(uuid, uuid, jsonb), public.delete_location_balance(uuid, uuid),
  public.add_location_balance_payment(uuid, uuid, date, bigint, text, text), public.delete_location_balance_payment(uuid, uuid),
  public.save_partners(uuid, jsonb), public.create_distribution(uuid, date, date, bigint, text), public.delete_distribution(uuid, uuid),
  public.add_distribution_payment(uuid, uuid, date, bigint, text, text), public.delete_distribution_payment(uuid, uuid),
  public.save_profit_months(uuid, jsonb) to authenticated;

-- Paid payroll per month (gross + employer tax of non-void runs by pay date),
-- for the Profit page. Invoker: pay_runs / pay_run_lines RLS decides access.
create or replace function public.payroll_by_month(p_org uuid, p_from date, p_to date)
returns table (month date, cents bigint, runs int)
language sql stable security invoker set search_path = '' as $$
  select date_trunc('month', r.pay_date)::date, coalesce(sum(l.gross_cents + l.employer_tax_cents), 0)::bigint, count(distinct r.id)::int
    from public.pay_runs r
    left join public.pay_run_lines l on l.run_id = r.id and l.organization_id = r.organization_id
   where r.organization_id = p_org and r.voided_at is null
     and p_from is not null and p_to is not null and p_to - p_from between 0 and 1200
     and r.pay_date between p_from and p_to
   group by 1
$$;
revoke all on function public.payroll_by_month(uuid, date, date) from public, anon;
grant execute on function public.payroll_by_month(uuid, date, date) to authenticated;
