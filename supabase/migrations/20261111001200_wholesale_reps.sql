-- =============================================================================
-- Wholesale sales reps and commission (owner request: "under Staff let them
-- manage salespeople and commission payouts").
--
-- * sales_reps: rate %, basis (sales or gross profit), when it's earned
--   (when invoiced, or as the customer pays), monthly target, optional link to
--   a team member's login (Sales rep role) so they can see their own numbers.
-- * Customers, orders and invoices carry a rep. New orders default to the
--   rep who entered them (if they are one), else the customer's rep; invoices
--   take the order's rep, else the customer's.
-- * commission_payouts: insert-only record of what was paid; a mistaken payout
--   is voided (kept, with a reason), never deleted.
-- * Earned commission is worked out on the server (rep_commission_summary /
--   rep_commission_lines) so everyone sees the same number.
-- Money in integer cents. Payouts are records only: nothing posts to the books.
-- =============================================================================

create table public.sales_reps (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  email text check (email is null or char_length(email) <= 200),
  phone text check (phone is null or char_length(phone) <= 40),
  user_id uuid references auth.users(id) on delete set null,
  rate_pct numeric(5,2) not null default 0 check (rate_pct >= 0 and rate_pct <= 100),
  basis text not null default 'sales' check (basis in ('sales', 'profit')),
  earn_on text not null default 'paid' check (earn_on in ('invoiced', 'paid')),
  monthly_target_cents bigint check (monthly_target_cents is null or monthly_target_cents between 0 and 100000000000),
  is_active boolean not null default true,
  notes text check (notes is null or char_length(notes) <= 1000),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);
create unique index sales_reps_org_user_uidx on public.sales_reps (organization_id, user_id) where user_id is not null;
create index sales_reps_user_idx on public.sales_reps (user_id);
create index sales_reps_created_by_idx on public.sales_reps (created_by);
create trigger sales_reps_updated_at before update on public.sales_reps for each row execute function private.set_updated_at();
create trigger audit_sales_reps after insert or update or delete on public.sales_reps for each row execute function private.audit_row_change();

alter table public.customers add column rep_id uuid, add constraint customers_rep_fk foreign key (organization_id, rep_id) references public.sales_reps (organization_id, id);
alter table public.sales_orders add column rep_id uuid, add constraint sales_orders_rep_fk foreign key (organization_id, rep_id) references public.sales_reps (organization_id, id);
alter table public.customer_invoices add column rep_id uuid, add constraint customer_invoices_rep_fk foreign key (organization_id, rep_id) references public.sales_reps (organization_id, id);
create index customers_org_rep_idx on public.customers (organization_id, rep_id);
create index sales_orders_org_rep_idx on public.sales_orders (organization_id, rep_id);
create index customer_invoices_org_rep_idx on public.customer_invoices (organization_id, rep_id, invoice_date);

create table public.commission_payouts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  rep_id uuid not null,
  paid_on date not null,
  amount_cents bigint not null check (amount_cents between 1 and 100000000000),
  method text not null check (method in ('check', 'cash', 'ach', 'zelle', 'payroll', 'other')),
  reference text check (reference is null or char_length(reference) <= 60),
  note text check (note is null or char_length(note) <= 300),
  voided_at timestamptz,
  void_reason text check (void_reason is null or char_length(void_reason) <= 200),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (organization_id, rep_id) references public.sales_reps (organization_id, id)
);
create index commission_payouts_org_rep_idx on public.commission_payouts (organization_id, rep_id, paid_on);
create index commission_payouts_created_by_idx on public.commission_payouts (created_by);
create trigger audit_commission_payouts after insert or update or delete on public.commission_payouts for each row execute function private.audit_row_change();

-- Read access: managers of commissions or receivables see every rep; a rep sees only their own record and payouts.
create or replace function private.rep_admin(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.ws_can(p_org, array['commissions.manage', 'wholesale.receivables.view', 'wholesale.customers.manage'])
$$;
create or replace function private.own_rep(p_org uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select r.id from public.sales_reps r
   where r.organization_id = p_org and r.user_id = auth.uid() and r.is_active and private.has_permission(p_org, 'commissions.view')
$$;
revoke all on function private.rep_admin(uuid), private.own_rep(uuid) from public, anon;
grant execute on function private.rep_admin(uuid), private.own_rep(uuid) to authenticated;

alter table public.sales_reps enable row level security;
alter table public.commission_payouts enable row level security;
revoke all on public.sales_reps, public.commission_payouts from anon, authenticated;
grant select on public.sales_reps, public.commission_payouts to authenticated;
grant all on public.sales_reps, public.commission_payouts to service_role;
create policy sales_reps_select on public.sales_reps for select to authenticated
  using (private.rep_admin(organization_id) or id = private.own_rep(organization_id));
create policy commission_payouts_select on public.commission_payouts for select to authenticated
  using (private.ws_can(organization_id, array['commissions.manage', 'wholesale.receivables.view']) or rep_id = private.own_rep(organization_id));

-- ---------------------------------------------------------------------------
-- Defaults: who gets credit for a new order or invoice
-- ---------------------------------------------------------------------------
create or replace function private.ws_default_rep()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.rep_id is null then
    if tg_table_name = 'sales_orders' then
      new.rep_id := coalesce(
        (select r.id from public.sales_reps r where r.organization_id = new.organization_id and r.user_id = auth.uid() and r.is_active),
        (select c.rep_id from public.customers c where c.id = new.customer_id));
    else
      new.rep_id := coalesce(
        (select o.rep_id from public.sales_orders o where o.id = new.order_id),
        (select c.rep_id from public.customers c where c.id = new.customer_id));
    end if;
  end if;
  return new;
end $$;
revoke all on function private.ws_default_rep() from public, anon, authenticated;
create trigger sales_orders_default_rep before insert on public.sales_orders for each row execute function private.ws_default_rep();
create trigger customer_invoices_default_rep before insert on public.customer_invoices for each row execute function private.ws_default_rep();

-- ---------------------------------------------------------------------------
-- Managing reps and who's credited
-- ---------------------------------------------------------------------------
-- p: name, email, phone, user_id (a team member of this business), rate_pct, basis, earn_on, monthly_target_cents, active, notes
create or replace function public.save_sales_rep(p_org uuid, p_id uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_user uuid := nullif(p ->> 'user_id', '')::uuid; v_rate numeric := coalesce(nullif(p ->> 'rate_pct', '')::numeric, 0);
begin
  perform private.ws_guard(p_org, 'commissions.manage');
  if nullif(btrim(p ->> 'name'), '') is null or char_length(btrim(p ->> 'name')) > 120 then raise exception 'enter the rep''s name' using errcode = '22023'; end if;
  if v_rate < 0 or v_rate > 100 then raise exception 'the rate is 0 to 100 percent' using errcode = '22023'; end if;
  if coalesce(p ->> 'basis', 'sales') not in ('sales', 'profit') or coalesce(p ->> 'earn_on', 'paid') not in ('invoiced', 'paid') then
    raise exception 'pick what the rate is on and when it''s earned' using errcode = '22023';
  end if;
  if v_user is not null and not exists (select 1 from public.memberships m where m.organization_id = p_org and m.user_id = v_user and m.status = 'active') then
    raise exception 'that login isn''t on your team' using errcode = '22023';
  end if;
  if v_user is not null and exists (select 1 from public.sales_reps where organization_id = p_org and user_id = v_user and id is distinct from p_id) then
    raise exception 'that login is already linked to another rep' using errcode = '22023';
  end if;
  if p_id is null then
    insert into public.sales_reps (organization_id, name, email, phone, user_id, rate_pct, basis, earn_on, monthly_target_cents, is_active, notes, created_by)
    values (p_org, btrim(left(p ->> 'name', 120)), nullif(btrim(left(p ->> 'email', 200)), ''), nullif(btrim(left(p ->> 'phone', 40)), ''), v_user, round(v_rate, 2),
            coalesce(p ->> 'basis', 'sales'), coalesce(p ->> 'earn_on', 'paid'), nullif(p ->> 'monthly_target_cents', '')::bigint, coalesce((p ->> 'active')::boolean, true),
            nullif(btrim(left(p ->> 'notes', 1000)), ''), auth.uid())
    returning id into v_id;
    return v_id;
  end if;
  update public.sales_reps set name = btrim(left(p ->> 'name', 120)), email = nullif(btrim(left(p ->> 'email', 200)), ''), phone = nullif(btrim(left(p ->> 'phone', 40)), ''),
         user_id = v_user, rate_pct = round(v_rate, 2), basis = coalesce(p ->> 'basis', 'sales'), earn_on = coalesce(p ->> 'earn_on', 'paid'),
         monthly_target_cents = nullif(p ->> 'monthly_target_cents', '')::bigint, is_active = coalesce((p ->> 'active')::boolean, true), notes = nullif(btrim(left(p ->> 'notes', 1000)), '')
   where id = p_id and organization_id = p_org;
  if not found then raise exception 'that rep was not found' using errcode = '22023'; end if;
  return p_id;
end $$;

create or replace function private.ws_check_rep(p_org uuid, p_rep uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if p_rep is not null and not exists (select 1 from public.sales_reps where id = p_rep and organization_id = p_org and is_active) then
    raise exception 'pick one of your active reps' using errcode = '22023';
  end if;
end $$;
revoke all on function private.ws_check_rep(uuid, uuid) from public, anon, authenticated;

-- A customer's rep (their new orders default to this rep).
create or replace function public.set_customer_rep(p_org uuid, p_customer uuid, p_rep uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.ws_guard(p_org, 'wholesale.customers.manage');
  perform private.ws_check_rep(p_org, p_rep);
  update public.customers set rep_id = p_rep where id = p_customer and organization_id = p_org;
  if not found then raise exception 'that customer was not found' using errcode = '22023'; end if;
end $$;

-- Who's credited for an order (and its invoice, if it has one). Managers only, so a rep can't move credit.
create or replace function public.set_order_rep(p_org uuid, p_order uuid, p_rep uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_inv uuid;
begin
  if not (private.has_permission(p_org, 'commissions.manage') or private.has_permission(p_org, 'wholesale.customers.manage')) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  perform private.ws_guard(p_org, 'wholesale.orders.view');
  perform private.ws_check_rep(p_org, p_rep);
  update public.sales_orders set rep_id = p_rep where id = p_order and organization_id = p_org returning invoice_id into v_inv;
  if not found then raise exception 'that order was not found' using errcode = '22023'; end if;
  if v_inv is not null then update public.customer_invoices set rep_id = p_rep where id = v_inv; end if;
end $$;

-- ---------------------------------------------------------------------------
-- Commission: earned, paid out, balance
-- ---------------------------------------------------------------------------
-- What each invoice (or payment, for reps paid "as the customer pays") earns, dated.
create or replace function private.commission_events(p_org uuid, p_to date)
returns table (rep_id uuid, invoice_id uuid, on_date date, sales_cents bigint, profit_cents bigint, earned_cents bigint)
language sql stable security definer set search_path = '' as $$
  -- When invoiced: the whole invoice on its date.
  select i.rep_id, i.id, i.invoice_date, i.subtotal_cents - i.discount_cents, i.subtotal_cents - i.discount_cents - i.cost_cents,
         round((case r.basis when 'sales' then i.subtotal_cents - i.discount_cents else i.subtotal_cents - i.discount_cents - i.cost_cents end) * r.rate_pct / 100)::bigint
    from public.customer_invoices i join public.sales_reps r on r.id = i.rep_id
   where i.organization_id = p_org and i.voided_at is null and r.earn_on = 'invoiced' and i.invoice_date <= p_to
  union all
  -- As paid: each payment's share of the invoice on the day it came in.
  select i.rep_id, i.id, p.paid_on,
         round((i.subtotal_cents - i.discount_cents)::numeric * p.amount_cents / i.total_cents)::bigint,
         round((i.subtotal_cents - i.discount_cents - i.cost_cents)::numeric * p.amount_cents / i.total_cents)::bigint,
         round((case r.basis when 'sales' then i.subtotal_cents - i.discount_cents else i.subtotal_cents - i.discount_cents - i.cost_cents end)::numeric
               * p.amount_cents / i.total_cents * r.rate_pct / 100)::bigint
    from public.customer_payments p
    join public.customer_invoices i on i.id = p.invoice_id
    join public.sales_reps r on r.id = i.rep_id
   where i.organization_id = p_org and i.voided_at is null and r.earn_on = 'paid' and i.total_cents > 0 and p.paid_on <= p_to
$$;
revoke all on function private.commission_events(uuid, date) from public, anon, authenticated;

-- One row per rep (all reps for managers; just your own if you're a rep): this period and the running balance.
create or replace function public.rep_commission_summary(p_org uuid, p_from date, p_to date)
returns table (rep_id uuid, name text, is_active boolean, rate_pct numeric, basis text, earn_on text, monthly_target_cents bigint,
               invoiced_sales_cents bigint, invoiced_profit_cents bigint, earned_cents bigint, paid_out_cents bigint,
               earned_to_date_cents bigint, paid_to_date_cents bigint, balance_cents bigint)
language plpgsql stable security definer set search_path = '' as $$
declare v_own uuid := private.own_rep(p_org); v_all boolean := private.rep_admin(p_org);
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 3660 then raise exception 'pick a date range' using errcode = '22023'; end if;
  if not v_all and v_own is null then return; end if;
  return query
  with ev as (select * from private.commission_events(p_org, p_to)),
       inv as (select i.rep_id, sum(i.subtotal_cents - i.discount_cents)::bigint as s, sum(i.subtotal_cents - i.discount_cents - i.cost_cents)::bigint as gp
                 from public.customer_invoices i where i.organization_id = p_org and i.voided_at is null and i.invoice_date between p_from and p_to group by 1),
       po as (select c.rep_id, coalesce(sum(c.amount_cents) filter (where c.paid_on between p_from and p_to), 0)::bigint as period, coalesce(sum(c.amount_cents), 0)::bigint as total
                from public.commission_payouts c where c.organization_id = p_org and c.voided_at is null and c.paid_on <= p_to group by 1)
  select r.id, r.name, r.is_active, r.rate_pct, r.basis, r.earn_on, r.monthly_target_cents,
         coalesce(inv.s, 0), coalesce(inv.gp, 0),
         coalesce((select sum(e.earned_cents) from ev e where e.rep_id = r.id and e.on_date between p_from and p_to), 0)::bigint,
         coalesce(po.period, 0),
         coalesce((select sum(e.earned_cents) from ev e where e.rep_id = r.id), 0)::bigint,
         coalesce(po.total, 0),
         coalesce((select sum(e.earned_cents) from ev e where e.rep_id = r.id), 0)::bigint - coalesce(po.total, 0)
    from public.sales_reps r
    left join inv on inv.rep_id = r.id
    left join po on po.rep_id = r.id
   where r.organization_id = p_org and (v_all or r.id = v_own)
   order by r.is_active desc, r.name;
end $$;

-- The invoices behind a rep's commission for a period.
create or replace function public.rep_commission_lines(p_org uuid, p_rep uuid, p_from date, p_to date)
returns table (invoice_id uuid, number text, customer text, on_date date, sales_cents bigint, profit_cents bigint, earned_cents bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.rep_admin(p_org) and private.own_rep(p_org) is distinct from p_rep then return; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 3660 then raise exception 'pick a date range' using errcode = '22023'; end if;
  return query
  select e.invoice_id, i.number, c.name, e.on_date, e.sales_cents, e.profit_cents, e.earned_cents
    from private.commission_events(p_org, p_to) e
    join public.customer_invoices i on i.id = e.invoice_id
    join public.customers c on c.id = i.customer_id
   where e.rep_id = p_rep and e.on_date between p_from and p_to
   order by e.on_date, i.number
   limit 2000;
end $$;

create or replace function public.record_commission_payout(p_org uuid, p_rep uuid, p_paid_on date, p_amount_cents bigint, p_method text, p_reference text, p_note text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform private.ws_guard(p_org, 'commissions.manage');
  if not exists (select 1 from public.sales_reps where id = p_rep and organization_id = p_org) then raise exception 'pick the rep' using errcode = '22023'; end if;
  if p_paid_on is null or p_paid_on > private.org_today(p_org) or p_paid_on < '2000-01-01' then raise exception 'enter the day you paid, not in the future' using errcode = '22023'; end if;
  if p_amount_cents is null or p_amount_cents < 1 or p_amount_cents > 100000000000 then raise exception 'enter the amount paid' using errcode = '22023'; end if;
  if coalesce(p_method, '') not in ('check', 'cash', 'ach', 'zelle', 'payroll', 'other') then raise exception 'pick how you paid' using errcode = '22023'; end if;
  insert into public.commission_payouts (organization_id, rep_id, paid_on, amount_cents, method, reference, note, created_by)
  values (p_org, p_rep, p_paid_on, p_amount_cents, p_method, nullif(btrim(left(p_reference, 60)), ''), nullif(btrim(left(p_note, 300)), ''), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.void_commission_payout(p_org uuid, p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.ws_guard(p_org, 'commissions.manage');
  if nullif(btrim(p_reason), '') is null then raise exception 'say why it''s being voided' using errcode = '22023'; end if;
  update public.commission_payouts set voided_at = now(), void_reason = btrim(left(p_reason, 200))
   where id = p_id and organization_id = p_org and voided_at is null;
  if not found then raise exception 'that payout was not found or is already void' using errcode = '22023'; end if;
end $$;

revoke all on function public.save_sales_rep(uuid, uuid, jsonb), public.set_customer_rep(uuid, uuid, uuid), public.set_order_rep(uuid, uuid, uuid),
  public.rep_commission_summary(uuid, date, date), public.rep_commission_lines(uuid, uuid, date, date),
  public.record_commission_payout(uuid, uuid, date, bigint, text, text, text), public.void_commission_payout(uuid, uuid, text) from public, anon;
grant execute on function public.save_sales_rep(uuid, uuid, jsonb), public.set_customer_rep(uuid, uuid, uuid), public.set_order_rep(uuid, uuid, uuid),
  public.rep_commission_summary(uuid, date, date), public.rep_commission_lines(uuid, uuid, date, date),
  public.record_commission_payout(uuid, uuid, date, bigint, text, text, text), public.void_commission_payout(uuid, uuid, text) to authenticated;
