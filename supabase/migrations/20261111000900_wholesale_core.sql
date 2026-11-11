-- =============================================================================
-- Wholesale account type, batch W1 (from the owner's Wholesale Ledger app):
-- price tiers, customers (terms, tier, credit limit, resale certificate, hold),
-- items (cost, price, case pack, bin, reorder point) with an insert-only stock
-- history, quotes and sales orders (pick, ready, invoice), customer invoices,
-- customer payments (check numbers, deposit dates) and payment plans
-- (expected payments that are applied to the oldest open invoices).
--
-- Only businesses whose type is Wholesale or Both can write here
-- (private.ws_guard). Every table: RLS on, SELECT only for authenticated,
-- writes only through SECURITY DEFINER functions below. Totals, numbers, due
-- dates, costs and stock are worked out on the server, never trusted from the
-- browser. Money in integer cents. These are records: nothing posts to the
-- books yet.
-- =============================================================================

-- New permissions for receivables (invoices and customer payments).
insert into public.permissions (key, description, sensitive) values
  ('wholesale.receivables.view', 'View wholesale invoices, balances and customer payments', false),
  ('wholesale.receivables.manage', 'Invoice wholesale orders and record customer payments', true)
on conflict (key) do nothing;
insert into public.role_permissions (role, permission) values
  ('owner', 'wholesale.receivables.view'), ('owner', 'wholesale.receivables.manage'),
  ('admin', 'wholesale.receivables.view'), ('admin', 'wholesale.receivables.manage'),
  ('manager', 'wholesale.receivables.view'),
  ('accountant', 'wholesale.receivables.view'), ('accountant', 'wholesale.receivables.manage')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.wholesale_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  default_terms int not null default 30 check (default_terms between 0 and 365),
  tax_rate numeric(6,3) not null default 0 check (tax_rate >= 0 and tax_rate <= 30),
  inv_prefix text not null default 'INV-' check (char_length(inv_prefix) <= 10),
  next_inv int not null default 1001 check (next_inv between 1 and 999999999),
  so_prefix text not null default 'SO-' check (char_length(so_prefix) <= 10),
  next_so int not null default 1 check (next_so between 1 and 999999999),
  markup numeric(6,2) not null default 40 check (markup >= 0 and markup <= 1000),
  pay_instructions text check (pay_instructions is null or char_length(pay_instructions) <= 500),
  updated_at timestamptz not null default now()
);

create table public.price_tiers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  pct numeric(5,2) not null default 0 check (pct >= 0 and pct <= 90),
  sort int not null default 0,
  unique (organization_id, id)
);
create unique index price_tiers_org_name_uidx on public.price_tiers (organization_id, lower(btrim(name)));

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  contact text check (contact is null or char_length(contact) <= 80),
  email text check (email is null or (char_length(email) <= 200 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  phone text check (phone is null or char_length(phone) <= 40),
  address text check (address is null or char_length(address) <= 300),
  ship_address text check (ship_address is null or char_length(ship_address) <= 300),
  terms int not null default 30 check (terms between 0 and 365),
  tier_id uuid,
  credit_limit_cents bigint check (credit_limit_cents is null or credit_limit_cents between 0 and 100000000000),
  tax_exempt boolean not null default false,
  resale_cert text check (resale_cert is null or char_length(resale_cert) <= 60),
  cert_expiry date,
  auto_email boolean not null default false,
  on_hold boolean not null default false,
  notes text check (notes is null or char_length(notes) <= 1000),
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, tier_id) references public.price_tiers (organization_id, id)
);
create index customers_org_name_idx on public.customers (organization_id, lower(name));
create index customers_org_tier_idx on public.customers (organization_id, tier_id);
create index customers_created_by_idx on public.customers (created_by);

create table public.items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 160),
  sku text check (sku is null or char_length(sku) <= 60),
  upc text check (upc is null or char_length(upc) <= 40),
  brand text check (brand is null or char_length(brand) <= 60),
  category text check (category is null or char_length(category) <= 60),
  vendor text check (vendor is null or char_length(vendor) <= 120),
  bin text check (bin is null or char_length(bin) <= 30),
  unit text check (unit is null or char_length(unit) <= 20),
  cost_cents bigint not null default 0 check (cost_cents between 0 and 10000000000),
  price_cents bigint not null default 0 check (price_cents between 0 and 10000000000),
  case_pack int check (case_pack is null or case_pack between 1 and 100000),
  reorder_at numeric(14,3) check (reorder_at is null or reorder_at between 0 and 100000000),
  reorder_qty numeric(14,3) check (reorder_qty is null or reorder_qty between 0 and 100000000),
  -- On hand. Changed only by the functions below, each with a stock_moves row.
  qty numeric(14,3) not null default 0 check (qty between -100000000 and 100000000),
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);
create unique index items_org_sku_uidx on public.items (organization_id, lower(sku)) where sku is not null;
create index items_org_name_idx on public.items (organization_id, lower(name));
create index items_created_by_idx on public.items (created_by);

-- Insert-only stock history.
create table public.stock_moves (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  item_id uuid not null,
  qty numeric(14,3) not null check (qty <> 0 and abs(qty) <= 100000000),
  reason text not null check (reason in ('start', 'adjust', 'invoice', 'invoice_void')),
  note text check (note is null or char_length(note) <= 120),
  invoice_id uuid,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (organization_id, item_id) references public.items (organization_id, id) on delete cascade
);
create index stock_moves_item_idx on public.stock_moves (organization_id, item_id, created_at);
create index stock_moves_invoice_idx on public.stock_moves (invoice_id);
create index stock_moves_created_by_idx on public.stock_moves (created_by);

create table public.sales_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null check (kind in ('quote', 'order')),
  number text not null check (char_length(number) between 1 and 30),
  customer_id uuid not null,
  order_date date not null,
  need_by date,
  valid_until date,
  customer_po text check (customer_po is null or char_length(customer_po) <= 60),
  status text not null default 'open' check (status in ('open', 'picking', 'ready', 'invoiced', 'cancelled')),
  discount_cents bigint not null default 0 check (discount_cents between 0 and 10000000000),
  shipping_cents bigint not null default 0 check (shipping_cents between 0 and 10000000000),
  tax_rate numeric(6,3) not null default 0 check (tax_rate >= 0 and tax_rate <= 30),
  subtotal_cents bigint not null default 0,
  cost_cents bigint not null default 0,
  tax_cents bigint not null default 0,
  total_cents bigint not null default 0,
  notes text check (notes is null or char_length(notes) <= 1000),
  invoice_id uuid,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, number),
  foreign key (organization_id, customer_id) references public.customers (organization_id, id)
);
create index sales_orders_org_cust_idx on public.sales_orders (organization_id, customer_id);
create index sales_orders_org_status_idx on public.sales_orders (organization_id, status, order_date);
create index sales_orders_invoice_idx on public.sales_orders (invoice_id);
create index sales_orders_created_by_idx on public.sales_orders (created_by);

create table public.sales_order_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  order_id uuid not null,
  line_no int not null,
  item_id uuid,
  sku text check (sku is null or char_length(sku) <= 60),
  name text not null check (char_length(name) between 1 and 160),
  qty numeric(14,3) not null check (qty > 0 and qty <= 100000000),
  price_cents bigint not null check (price_cents between 0 and 10000000000),
  cost_cents bigint not null default 0 check (cost_cents between 0 and 10000000000),
  picked boolean not null default false,
  unique (order_id, line_no),
  foreign key (organization_id, order_id) references public.sales_orders (organization_id, id) on delete cascade,
  foreign key (organization_id, item_id) references public.items (organization_id, id)
);
create index sales_order_lines_order_idx on public.sales_order_lines (organization_id, order_id);
create index sales_order_lines_item_idx on public.sales_order_lines (organization_id, item_id);

create table public.customer_invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  number text not null check (char_length(number) between 1 and 30),
  customer_id uuid not null,
  order_id uuid,
  invoice_date date not null,
  terms int not null check (terms between 0 and 365),
  due_date date not null,
  customer_po text check (customer_po is null or char_length(customer_po) <= 60),
  discount_cents bigint not null default 0 check (discount_cents between 0 and 10000000000),
  shipping_cents bigint not null default 0 check (shipping_cents between 0 and 10000000000),
  tax_rate numeric(6,3) not null default 0 check (tax_rate >= 0 and tax_rate <= 30),
  subtotal_cents bigint not null,
  cost_cents bigint not null,
  tax_cents bigint not null,
  total_cents bigint not null check (total_cents >= 0),
  notes text check (notes is null or char_length(notes) <= 1000),
  voided_at timestamptz,
  void_reason text check (void_reason is null or char_length(void_reason) <= 200),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, number),
  check (due_date >= invoice_date),
  foreign key (organization_id, customer_id) references public.customers (organization_id, id),
  foreign key (organization_id, order_id) references public.sales_orders (organization_id, id)
);
create index customer_invoices_org_cust_idx on public.customer_invoices (organization_id, customer_id, invoice_date);
create index customer_invoices_org_order_idx on public.customer_invoices (organization_id, order_id);
create index customer_invoices_org_due_idx on public.customer_invoices (organization_id, due_date);
create index customer_invoices_created_by_idx on public.customer_invoices (created_by);
alter table public.sales_orders add constraint sales_orders_invoice_fk foreign key (organization_id, invoice_id) references public.customer_invoices (organization_id, id);
drop index public.sales_orders_invoice_idx;
create index sales_orders_org_invoice_idx on public.sales_orders (organization_id, invoice_id);
alter table public.stock_moves add constraint stock_moves_invoice_fk foreign key (organization_id, invoice_id) references public.customer_invoices (organization_id, id);
drop index public.stock_moves_invoice_idx;
create index stock_moves_org_invoice_idx on public.stock_moves (organization_id, invoice_id);

create table public.customer_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  invoice_id uuid not null,
  line_no int not null,
  item_id uuid,
  sku text check (sku is null or char_length(sku) <= 60),
  name text not null check (char_length(name) between 1 and 160),
  qty numeric(14,3) not null check (qty > 0 and qty <= 100000000),
  price_cents bigint not null check (price_cents between 0 and 10000000000),
  cost_cents bigint not null default 0 check (cost_cents between 0 and 10000000000),
  unique (invoice_id, line_no),
  foreign key (organization_id, invoice_id) references public.customer_invoices (organization_id, id) on delete cascade,
  foreign key (organization_id, item_id) references public.items (organization_id, id)
);
create index customer_invoice_lines_inv_idx on public.customer_invoice_lines (organization_id, invoice_id);
create index customer_invoice_lines_item_idx on public.customer_invoice_lines (organization_id, item_id);

-- A payment plan: dated payments a customer promised (post-dated checks too).
create table public.expected_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  customer_id uuid not null,
  due_date date not null,
  amount_cents bigint not null check (amount_cents between 1 and 100000000000),
  method text not null default 'check' check (method in ('check', 'cash', 'ach', 'zelle', 'card', 'other')),
  check_no text check (check_no is null or char_length(check_no) <= 30),
  bank text check (bank is null or char_length(bank) <= 60),
  note text check (note is null or char_length(note) <= 200),
  status text not null default 'expected' check (status in ('expected', 'received', 'cancelled')),
  received_on date,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, customer_id) references public.customers (organization_id, id) on delete cascade
);
create index expected_payments_org_cust_idx on public.expected_payments (organization_id, customer_id, due_date);
create index expected_payments_created_by_idx on public.expected_payments (created_by);

create table public.customer_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  invoice_id uuid not null,
  paid_on date not null,
  amount_cents bigint not null check (amount_cents between 1 and 100000000000),
  method text not null check (method in ('check', 'cash', 'ach', 'zelle', 'card', 'other')),
  check_no text check (check_no is null or char_length(check_no) <= 30),
  bank text check (bank is null or char_length(bank) <= 60),
  deposit_date date,
  expected_payment_id uuid,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (deposit_date is null or deposit_date >= paid_on),
  foreign key (organization_id, invoice_id) references public.customer_invoices (organization_id, id) on delete cascade,
  foreign key (organization_id, expected_payment_id) references public.expected_payments (organization_id, id) on delete set null (expected_payment_id)
);
create index customer_payments_org_inv_idx on public.customer_payments (organization_id, invoice_id);
create index customer_payments_org_exp_idx on public.customer_payments (organization_id, expected_payment_id);
create index customer_payments_org_deposit_idx on public.customer_payments (organization_id, deposit_date);
create index customer_payments_created_by_idx on public.customer_payments (created_by);

-- updated_at + audit
create trigger customers_updated_at before update on public.customers for each row execute function private.set_updated_at();
create trigger items_updated_at before update on public.items for each row execute function private.set_updated_at();
create trigger sales_orders_updated_at before update on public.sales_orders for each row execute function private.set_updated_at();
create trigger wholesale_settings_updated_at before update on public.wholesale_settings for each row execute function private.set_updated_at();
create trigger audit_customers after insert or update or delete on public.customers for each row execute function private.audit_row_change();
create trigger audit_items after insert or update or delete on public.items for each row execute function private.audit_row_change();
create trigger audit_sales_orders after insert or update or delete on public.sales_orders for each row execute function private.audit_row_change();
create trigger audit_customer_invoices after insert or update or delete on public.customer_invoices for each row execute function private.audit_row_change();
create trigger audit_customer_payments after insert or update or delete on public.customer_payments for each row execute function private.audit_row_change();
create trigger audit_expected_payments after insert or update or delete on public.expected_payments for each row execute function private.audit_row_change();
create trigger audit_price_tiers after insert or update or delete on public.price_tiers for each row execute function private.audit_row_change();

-- ---------------------------------------------------------------------------
-- Read access
-- ---------------------------------------------------------------------------
create or replace function private.ws_can(p_org uuid, p_perms text[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from unnest(p_perms) p where private.has_permission(p_org, p)) or private.has_support_access(p_org)
$$;
revoke all on function private.ws_can(uuid, text[]) from public, anon;
grant execute on function private.ws_can(uuid, text[]) to authenticated;

alter table public.wholesale_settings enable row level security;
alter table public.price_tiers enable row level security;
alter table public.customers enable row level security;
alter table public.items enable row level security;
alter table public.stock_moves enable row level security;
alter table public.sales_orders enable row level security;
alter table public.sales_order_lines enable row level security;
alter table public.customer_invoices enable row level security;
alter table public.customer_invoice_lines enable row level security;
alter table public.expected_payments enable row level security;
alter table public.customer_payments enable row level security;
revoke all on public.wholesale_settings, public.price_tiers, public.customers, public.items, public.stock_moves, public.sales_orders, public.sales_order_lines,
  public.customer_invoices, public.customer_invoice_lines, public.expected_payments, public.customer_payments from anon, authenticated;
grant select on public.wholesale_settings, public.price_tiers, public.customers, public.items, public.stock_moves, public.sales_orders, public.sales_order_lines,
  public.customer_invoices, public.customer_invoice_lines, public.expected_payments, public.customer_payments to authenticated;
grant all on public.wholesale_settings, public.price_tiers, public.customers, public.items, public.stock_moves, public.sales_orders, public.sales_order_lines,
  public.customer_invoices, public.customer_invoice_lines, public.expected_payments, public.customer_payments to service_role;

create policy wholesale_settings_select on public.wholesale_settings for select to authenticated
  using (private.ws_can(organization_id, array['wholesale.orders.view', 'wholesale.catalog.manage', 'wholesale.receivables.view']));
create policy price_tiers_select on public.price_tiers for select to authenticated
  using (private.ws_can(organization_id, array['wholesale.orders.view', 'wholesale.catalog.manage', 'wholesale.customers.manage']));
create policy customers_select on public.customers for select to authenticated
  using (private.ws_can(organization_id, array['wholesale.orders.view', 'wholesale.customers.manage', 'wholesale.receivables.view']));
create policy items_select on public.items for select to authenticated
  using (private.ws_can(organization_id, array['inventory.view', 'wholesale.orders.view', 'wholesale.catalog.manage']));
create policy stock_moves_select on public.stock_moves for select to authenticated
  using (private.ws_can(organization_id, array['inventory.view', 'inventory.manage']));
create policy sales_orders_select on public.sales_orders for select to authenticated
  using (private.ws_can(organization_id, array['wholesale.orders.view']));
create policy sales_order_lines_select on public.sales_order_lines for select to authenticated
  using (private.ws_can(organization_id, array['wholesale.orders.view']));
create policy customer_invoices_select on public.customer_invoices for select to authenticated
  using (private.ws_can(organization_id, array['wholesale.receivables.view']));
create policy customer_invoice_lines_select on public.customer_invoice_lines for select to authenticated
  using (private.ws_can(organization_id, array['wholesale.receivables.view']));
create policy expected_payments_select on public.expected_payments for select to authenticated
  using (private.ws_can(organization_id, array['wholesale.receivables.view']));
create policy customer_payments_select on public.customer_payments for select to authenticated
  using (private.ws_can(organization_id, array['wholesale.receivables.view']));

-- ---------------------------------------------------------------------------
-- Guards and helpers
-- ---------------------------------------------------------------------------
-- Writer guard: signed in, holds the permission, business writable, and the
-- business is a Wholesale or Both account.
create or replace function private.ws_guard(p_org uuid, p_perm text)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_user();
  if not private.has_permission(p_org, p_perm) or not private.org_is_writable(p_org) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if not exists (select 1 from public.organizations o where o.id = p_org and o.business_type in ('wholesale', 'both')) then
    raise exception 'wholesale features are for Wholesale accounts' using errcode = '42501';
  end if;
end $$;
revoke all on function private.ws_guard(uuid, text) from public, anon, authenticated;

-- The business's settings row, created with defaults the first time.
create or replace function private.ws_settings(p_org uuid)
returns public.wholesale_settings language plpgsql security definer set search_path = '' as $$
declare r public.wholesale_settings;
begin
  insert into public.wholesale_settings (organization_id) values (p_org) on conflict do nothing;
  select * into r from public.wholesale_settings where organization_id = p_org;
  return r;
end $$;
revoke all on function private.ws_settings(uuid) from public, anon, authenticated;

-- Next order or invoice number, serialized by a row lock on the settings row.
create or replace function private.ws_next_number(p_org uuid, p_kind text)
returns text language plpgsql security definer set search_path = '' as $$
declare s public.wholesale_settings; v text; n int;
begin
  perform private.ws_settings(p_org);
  select * into s from public.wholesale_settings where organization_id = p_org for update;
  if p_kind = 'inv' then
    n := s.next_inv;
    loop
      v := s.inv_prefix || n;
      exit when not exists (select 1 from public.customer_invoices where organization_id = p_org and number = v);
      n := n + 1;
    end loop;
    update public.wholesale_settings set next_inv = n + 1 where organization_id = p_org;
  else
    n := s.next_so;
    loop
      v := s.so_prefix || lpad(n::text, 4, '0');
      exit when not exists (select 1 from public.sales_orders where organization_id = p_org and number = v);
      n := n + 1;
    end loop;
    update public.wholesale_settings set next_so = n + 1 where organization_id = p_org;
  end if;
  return v;
end $$;
revoke all on function private.ws_next_number(uuid, text) from public, anon, authenticated;

-- Validate a lines array and return it normalized: [{item_id, sku, name, qty, price_cents, cost_cents}].
-- Item lines take name/SKU/cost from the item; cost is never taken from the browser.
create or replace function private.ws_lines(p_org uuid, p_lines jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare l jsonb; out jsonb := '[]'; it public.items; v_qty numeric; v_price bigint; v_item uuid;
begin
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) not between 1 and 300 then
    raise exception 'add 1 to 300 lines' using errcode = '22023';
  end if;
  for l in select * from jsonb_array_elements(p_lines) loop
    v_qty := nullif(l ->> 'qty', '')::numeric;
    v_price := nullif(l ->> 'price_cents', '')::bigint;
    if v_qty is null or v_qty <= 0 or v_qty > 100000000 or round(v_qty, 3) <> v_qty then raise exception 'each line needs a quantity over zero' using errcode = '22023'; end if;
    if v_price is null or v_price < 0 or v_price > 10000000000 then raise exception 'each line needs a price of zero or more' using errcode = '22023'; end if;
    v_item := nullif(l ->> 'item_id', '')::uuid;
    if v_item is not null then
      select * into it from public.items where id = v_item and organization_id = p_org;
      if not found then raise exception 'an item on this order was not found' using errcode = '22023'; end if;
      out := out || jsonb_build_object('item_id', it.id, 'sku', it.sku, 'name', it.name, 'qty', v_qty, 'price_cents', v_price, 'cost_cents', it.cost_cents);
    else
      if nullif(btrim(l ->> 'name'), '') is null or char_length(btrim(l ->> 'name')) > 160 then raise exception 'each custom line needs a description' using errcode = '22023'; end if;
      out := out || jsonb_build_object('item_id', null, 'sku', nullif(btrim(left(l ->> 'sku', 60)), ''), 'name', btrim(l ->> 'name'), 'qty', v_qty, 'price_cents', v_price,
        'cost_cents', least(greatest(coalesce(nullif(l ->> 'cost_cents', '')::bigint, 0), 0), 10000000000));
    end if;
  end loop;
  return out;
end $$;
revoke all on function private.ws_lines(uuid, jsonb) from public, anon, authenticated;

-- Totals for normalized lines: subtotal, cost, tax on (subtotal - discount), total.
create or replace function private.ws_totals(p_lines jsonb, p_discount bigint, p_shipping bigint, p_tax_rate numeric)
returns jsonb language sql immutable set search_path = '' as $$
  with t as (
    select coalesce(sum(round((l ->> 'qty')::numeric * (l ->> 'price_cents')::bigint)), 0)::bigint as sub,
           coalesce(sum(round((l ->> 'qty')::numeric * (l ->> 'cost_cents')::bigint)), 0)::bigint as cost
      from jsonb_array_elements(p_lines) l)
  select jsonb_build_object('subtotal', sub, 'cost', cost,
           'tax', round(greatest(sub - p_discount, 0) * p_tax_rate / 100)::bigint,
           'total', sub - p_discount + p_shipping + round(greatest(sub - p_discount, 0) * p_tax_rate / 100)::bigint)
    from t
$$;
revoke all on function private.ws_totals(jsonb, bigint, bigint, numeric) from public, anon, authenticated;

-- Move stock with a history row.
create or replace function private.ws_move(p_org uuid, p_item uuid, p_qty numeric, p_reason text, p_note text, p_invoice uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_item is null or p_qty = 0 then return; end if;
  update public.items set qty = qty + p_qty where id = p_item and organization_id = p_org;
  insert into public.stock_moves (organization_id, item_id, qty, reason, note, invoice_id, created_by)
  values (p_org, p_item, p_qty, p_reason, p_note, p_invoice, auth.uid());
end $$;
revoke all on function private.ws_move(uuid, uuid, numeric, text, text, uuid) from public, anon, authenticated;

create or replace function private.ws_invoice_paid(p_invoice uuid)
returns bigint language sql stable security definer set search_path = '' as $$
  select coalesce(sum(amount_cents), 0)::bigint from public.customer_payments where invoice_id = p_invoice
$$;
revoke all on function private.ws_invoice_paid(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Settings and price tiers
-- ---------------------------------------------------------------------------
create or replace function public.save_wholesale_settings(p_org uuid, p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.ws_guard(p_org, 'wholesale.catalog.manage');
  perform private.ws_settings(p_org);
  update public.wholesale_settings set
    default_terms = coalesce(nullif(p ->> 'default_terms', '')::int, default_terms),
    tax_rate = coalesce(nullif(p ->> 'tax_rate', '')::numeric, tax_rate),
    inv_prefix = coalesce(left(p ->> 'inv_prefix', 10), inv_prefix),
    next_inv = coalesce(nullif(p ->> 'next_inv', '')::int, next_inv),
    so_prefix = coalesce(left(p ->> 'so_prefix', 10), so_prefix),
    next_so = coalesce(nullif(p ->> 'next_so', '')::int, next_so),
    markup = coalesce(nullif(p ->> 'markup', '')::numeric, markup),
    pay_instructions = case when p ? 'pay_instructions' then nullif(btrim(left(p ->> 'pay_instructions', 500)), '') else pay_instructions end
  where organization_id = p_org;
end $$;

-- Replace the tier list: [{id?, name, pct}]. The first is the default. A tier
-- still used by a customer can't be dropped.
create or replace function public.save_price_tiers(p_org uuid, p jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare r jsonb; v_ids uuid[] := '{}'; v_id uuid; i int := 0;
begin
  perform private.ws_guard(p_org, 'wholesale.catalog.manage');
  if jsonb_typeof(p) <> 'array' or jsonb_array_length(p) not between 1 and 12 then raise exception 'keep 1 to 12 price tiers' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_array_elements(p) x where nullif(btrim(x ->> 'name'), '') is null or char_length(btrim(x ->> 'name')) > 40
              or (x ->> 'pct') is null or (x ->> 'pct')::numeric < 0 or (x ->> 'pct')::numeric > 90) then
    raise exception 'each tier needs a name and a discount from 0 to 90 percent' using errcode = '22023';
  end if;
  if (select count(distinct lower(btrim(x ->> 'name'))) from jsonb_array_elements(p) x) < jsonb_array_length(p) then
    raise exception 'each tier needs a different name' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('tiers:' || p_org::text, 0));
  for r in select * from jsonb_array_elements(p) loop
    i := i + 1;
    v_id := nullif(r ->> 'id', '')::uuid;
    if v_id is not null and exists (select 1 from public.price_tiers where id = v_id and organization_id = p_org) then
      update public.price_tiers set name = btrim(r ->> 'name'), pct = round((r ->> 'pct')::numeric, 2), sort = i where id = v_id;
    else
      insert into public.price_tiers (organization_id, name, pct, sort) values (p_org, btrim(r ->> 'name'), round((r ->> 'pct')::numeric, 2), i) returning id into v_id;
    end if;
    v_ids := v_ids || v_id;
  end loop;
  if exists (select 1 from public.customers c where c.organization_id = p_org and c.tier_id is not null and not (c.tier_id = any (v_ids))) then
    raise exception 'a tier you removed is still used by a customer; move them first' using errcode = '22023';
  end if;
  delete from public.price_tiers where organization_id = p_org and not (id = any (v_ids));
  return i;
end $$;

-- ---------------------------------------------------------------------------
-- Customers
-- ---------------------------------------------------------------------------
create or replace function public.save_customer(p_org uuid, p_id uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_tier uuid := nullif(p ->> 'tier_id', '')::uuid; v_terms int; v_email text := nullif(lower(btrim(p ->> 'email')), '');
begin
  perform private.ws_guard(p_org, 'wholesale.customers.manage');
  if nullif(btrim(p ->> 'name'), '') is null or char_length(btrim(p ->> 'name')) > 120 then raise exception 'enter the business name' using errcode = '22023'; end if;
  if v_tier is not null and not exists (select 1 from public.price_tiers where id = v_tier and organization_id = p_org) then raise exception 'pick one of your price tiers' using errcode = '22023'; end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'that email doesn''t look right' using errcode = '22023'; end if;
  v_terms := coalesce(nullif(p ->> 'terms', '')::int, (private.ws_settings(p_org)).default_terms);
  if v_terms not between 0 and 365 then raise exception 'terms are 0 to 365 days' using errcode = '22023'; end if;
  if p_id is null then
    insert into public.customers (organization_id, name, contact, email, phone, address, ship_address, terms, tier_id, credit_limit_cents, tax_exempt, resale_cert, cert_expiry, auto_email, on_hold, notes, created_by)
    values (p_org, btrim(p ->> 'name'), nullif(btrim(left(p ->> 'contact', 80)), ''), v_email, nullif(btrim(left(p ->> 'phone', 40)), ''), nullif(btrim(left(p ->> 'address', 300)), ''),
            nullif(btrim(left(p ->> 'ship_address', 300)), ''), v_terms, v_tier, nullif(p ->> 'credit_limit_cents', '')::bigint, coalesce((p ->> 'tax_exempt')::boolean, false),
            nullif(btrim(left(p ->> 'resale_cert', 60)), ''), nullif(p ->> 'cert_expiry', '')::date, coalesce((p ->> 'auto_email')::boolean, false), coalesce((p ->> 'on_hold')::boolean, false),
            nullif(btrim(left(p ->> 'notes', 1000)), ''), auth.uid())
    returning id into v_id;
    return v_id;
  end if;
  update public.customers set name = btrim(p ->> 'name'), contact = nullif(btrim(left(p ->> 'contact', 80)), ''), email = v_email, phone = nullif(btrim(left(p ->> 'phone', 40)), ''),
         address = nullif(btrim(left(p ->> 'address', 300)), ''), ship_address = nullif(btrim(left(p ->> 'ship_address', 300)), ''), terms = v_terms, tier_id = v_tier,
         credit_limit_cents = nullif(p ->> 'credit_limit_cents', '')::bigint, tax_exempt = coalesce((p ->> 'tax_exempt')::boolean, false),
         resale_cert = nullif(btrim(left(p ->> 'resale_cert', 60)), ''), cert_expiry = nullif(p ->> 'cert_expiry', '')::date,
         auto_email = coalesce((p ->> 'auto_email')::boolean, false), on_hold = coalesce((p ->> 'on_hold')::boolean, false),
         notes = nullif(btrim(left(p ->> 'notes', 1000)), ''), is_active = coalesce((p ->> 'active')::boolean, true)
   where id = p_id and organization_id = p_org;
  if not found then raise exception 'that customer was not found' using errcode = '22023'; end if;
  return p_id;
end $$;

-- Delete a customer with no orders or invoices; otherwise make them inactive.
create or replace function public.delete_customer(p_org uuid, p_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
begin
  perform private.ws_guard(p_org, 'wholesale.customers.manage');
  if not exists (select 1 from public.customers where id = p_id and organization_id = p_org) then raise exception 'that customer was not found' using errcode = '22023'; end if;
  if exists (select 1 from public.sales_orders where customer_id = p_id and organization_id = p_org)
     or exists (select 1 from public.customer_invoices where customer_id = p_id and organization_id = p_org) then
    update public.customers set is_active = false where id = p_id;
    return 'inactive';
  end if;
  delete from public.customers where id = p_id;
  return 'deleted';
end $$;

-- ---------------------------------------------------------------------------
-- Items and stock
-- ---------------------------------------------------------------------------
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
    if v_start <> 0 then perform private.ws_move(p_org, v_id, v_start, 'start', 'Starting quantity', null); end if;
    return v_id;
  end if;
  -- On-hand quantity is never set here; use adjust_stock.
  update public.items set name = btrim(p ->> 'name'), sku = nullif(btrim(left(p ->> 'sku', 60)), ''), upc = nullif(btrim(left(p ->> 'upc', 40)), ''),
         brand = nullif(btrim(left(p ->> 'brand', 60)), ''), category = nullif(btrim(left(p ->> 'category', 60)), ''), vendor = nullif(btrim(left(p ->> 'vendor', 120)), ''),
         bin = nullif(btrim(left(p ->> 'bin', 30)), ''), unit = nullif(btrim(left(p ->> 'unit', 20)), ''),
         cost_cents = coalesce(nullif(p ->> 'cost_cents', '')::bigint, 0), price_cents = coalesce(nullif(p ->> 'price_cents', '')::bigint, 0),
         case_pack = nullif(p ->> 'case_pack', '')::int, reorder_at = nullif(p ->> 'reorder_at', '')::numeric, reorder_qty = nullif(p ->> 'reorder_qty', '')::numeric,
         is_active = coalesce((p ->> 'active')::boolean, true)
   where id = p_id and organization_id = p_org;
  if not found then raise exception 'that item was not found' using errcode = '22023'; end if;
  return p_id;
end $$;

create or replace function public.adjust_stock(p_org uuid, p_item uuid, p_qty numeric, p_reason text)
returns numeric language plpgsql security definer set search_path = '' as $$
declare v numeric;
begin
  perform private.ws_guard(p_org, 'inventory.manage');
  if p_qty is null or p_qty = 0 or abs(p_qty) > 100000000 or round(p_qty, 3) <> p_qty then raise exception 'enter how many to add (or remove, with a minus)' using errcode = '22023'; end if;
  if coalesce(p_reason, '') not in ('Cycle count', 'Damaged', 'Expired', 'Sample / promo', 'Theft / loss', 'Received', 'Other') then raise exception 'pick a reason' using errcode = '22023'; end if;
  perform 1 from public.items where id = p_item and organization_id = p_org for update;
  if not found then raise exception 'that item was not found' using errcode = '22023'; end if;
  perform private.ws_move(p_org, p_item, p_qty, 'adjust', p_reason, null);
  select qty into v from public.items where id = p_item;
  return v;
end $$;

create or replace function public.delete_item(p_org uuid, p_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
begin
  perform private.ws_guard(p_org, 'wholesale.catalog.manage');
  if not exists (select 1 from public.items where id = p_id and organization_id = p_org) then raise exception 'that item was not found' using errcode = '22023'; end if;
  if exists (select 1 from public.sales_order_lines where item_id = p_id) or exists (select 1 from public.customer_invoice_lines where item_id = p_id) then
    update public.items set is_active = false where id = p_id;
    return 'inactive';
  end if;
  delete from public.items where id = p_id;
  return 'deleted';
end $$;

-- ---------------------------------------------------------------------------
-- Quotes and sales orders
-- ---------------------------------------------------------------------------
-- p: kind, customer_id, order_date, need_by, valid_until, customer_po, discount_cents,
-- shipping_cents, tax_rate (ignored for tax-exempt customers), notes, lines[].
create or replace function public.save_sales_order(p_org uuid, p_id uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid := p_id; v_cust public.customers; v_lines jsonb; v_t jsonb; v_disc bigint; v_ship bigint; v_rate numeric; v_old public.sales_orders; v_date date;
begin
  perform private.ws_guard(p_org, 'wholesale.orders.create');
  select * into v_cust from public.customers where id = nullif(p ->> 'customer_id', '')::uuid and organization_id = p_org;
  if not found then raise exception 'choose the customer' using errcode = '22023'; end if;
  v_date := coalesce(nullif(p ->> 'order_date', '')::date, private.org_today(p_org));
  if v_date < '2000-01-01' or v_date > private.org_today(p_org) + 366 then raise exception 'enter a real date' using errcode = '22023'; end if;
  v_lines := private.ws_lines(p_org, p -> 'lines');
  v_disc := coalesce(nullif(p ->> 'discount_cents', '')::bigint, 0);
  v_ship := coalesce(nullif(p ->> 'shipping_cents', '')::bigint, 0);
  v_rate := case when v_cust.tax_exempt then 0 else coalesce(nullif(p ->> 'tax_rate', '')::numeric, (private.ws_settings(p_org)).tax_rate) end;
  if v_disc < 0 or v_ship < 0 or v_disc > 10000000000 or v_ship > 10000000000 or v_rate < 0 or v_rate > 30 then raise exception 'check the discount, shipping and tax' using errcode = '22023'; end if;
  v_t := private.ws_totals(v_lines, v_disc, v_ship, v_rate);
  if (v_t ->> 'subtotal')::bigint < v_disc then raise exception 'the discount is more than the order' using errcode = '22023'; end if;
  if v_id is null then
    insert into public.sales_orders (organization_id, kind, number, customer_id, order_date, need_by, valid_until, customer_po, discount_cents, shipping_cents, tax_rate,
                                     subtotal_cents, cost_cents, tax_cents, total_cents, notes, created_by)
    values (p_org, case when p ->> 'kind' = 'quote' then 'quote' else 'order' end, private.ws_next_number(p_org, 'so'), v_cust.id, v_date,
            nullif(p ->> 'need_by', '')::date, nullif(p ->> 'valid_until', '')::date, nullif(btrim(left(p ->> 'customer_po', 60)), ''), v_disc, v_ship, v_rate,
            (v_t ->> 'subtotal')::bigint, (v_t ->> 'cost')::bigint, (v_t ->> 'tax')::bigint, (v_t ->> 'total')::bigint, nullif(btrim(left(p ->> 'notes', 1000)), ''), auth.uid())
    returning id into v_id;
  else
    select * into v_old from public.sales_orders where id = v_id and organization_id = p_org for update;
    if not found then raise exception 'that order was not found' using errcode = '22023'; end if;
    if v_old.status in ('invoiced', 'cancelled') then raise exception 'this order is closed' using errcode = '22023'; end if;
    update public.sales_orders set customer_id = v_cust.id, order_date = v_date, need_by = nullif(p ->> 'need_by', '')::date, valid_until = nullif(p ->> 'valid_until', '')::date,
           customer_po = nullif(btrim(left(p ->> 'customer_po', 60)), ''), discount_cents = v_disc, shipping_cents = v_ship, tax_rate = v_rate,
           subtotal_cents = (v_t ->> 'subtotal')::bigint, cost_cents = (v_t ->> 'cost')::bigint, tax_cents = (v_t ->> 'tax')::bigint, total_cents = (v_t ->> 'total')::bigint,
           notes = nullif(btrim(left(p ->> 'notes', 1000)), '')
     where id = v_id;
    delete from public.sales_order_lines where order_id = v_id;
  end if;
  insert into public.sales_order_lines (organization_id, order_id, line_no, item_id, sku, name, qty, price_cents, cost_cents)
  select p_org, v_id, ord, (l ->> 'item_id')::uuid, l ->> 'sku', l ->> 'name', (l ->> 'qty')::numeric, (l ->> 'price_cents')::bigint, (l ->> 'cost_cents')::bigint
    from jsonb_array_elements(v_lines) with ordinality as x(l, ord);
  return v_id;
end $$;

-- Quote → sales order, start picking, mark ready, cancel. Invoicing is invoice_order.
create or replace function public.set_order_status(p_org uuid, p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare o public.sales_orders;
begin
  perform private.ws_guard(p_org, 'wholesale.orders.create');
  select * into o from public.sales_orders where id = p_id and organization_id = p_org for update;
  if not found then raise exception 'that order was not found' using errcode = '22023'; end if;
  if o.status in ('invoiced', 'cancelled') then raise exception 'this order is closed' using errcode = '22023'; end if;
  if p_status = 'order' then
    if o.kind <> 'quote' then raise exception 'this is already a sales order' using errcode = '22023'; end if;
    update public.sales_orders set kind = 'order', status = 'open' where id = p_id;
  elsif p_status in ('picking', 'ready') then
    if o.kind <> 'order' then raise exception 'make the quote a sales order first' using errcode = '22023'; end if;
    update public.sales_orders set status = p_status where id = p_id;
  elsif p_status = 'cancelled' then
    update public.sales_orders set status = 'cancelled' where id = p_id;
  else
    raise exception 'that status isn''t allowed' using errcode = '22023';
  end if;
end $$;

create or replace function public.set_line_picked(p_org uuid, p_line uuid, p_picked boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.ws_guard(p_org, 'wholesale.orders.create');
  update public.sales_order_lines l set picked = coalesce(p_picked, false)
    from public.sales_orders o
   where l.id = p_line and l.organization_id = p_org and o.id = l.order_id and o.status in ('open', 'picking', 'ready');
  if not found then raise exception 'that line was not found or the order is closed' using errcode = '22023'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- Invoices
-- ---------------------------------------------------------------------------
create or replace function private.ws_make_invoice(p_org uuid, p_cust uuid, p_order uuid, p_date date, p_terms int, p_po text, p_disc bigint, p_ship bigint, p_rate numeric,
                                                   p_lines jsonb, p_notes text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_t jsonb; v_number text; l record;
begin
  if p_date is null or p_date < '2000-01-01' or p_date > private.org_today(p_org) + 31 then raise exception 'enter the invoice date' using errcode = '22023'; end if;
  if p_terms is null or p_terms not between 0 and 365 then raise exception 'terms are 0 to 365 days' using errcode = '22023'; end if;
  v_t := private.ws_totals(p_lines, p_disc, p_ship, p_rate);
  if (v_t ->> 'subtotal')::bigint < p_disc then raise exception 'the discount is more than the invoice' using errcode = '22023'; end if;
  v_number := private.ws_next_number(p_org, 'inv');
  insert into public.customer_invoices (organization_id, number, customer_id, order_id, invoice_date, terms, due_date, customer_po, discount_cents, shipping_cents, tax_rate,
                                        subtotal_cents, cost_cents, tax_cents, total_cents, notes, created_by)
  values (p_org, v_number, p_cust, p_order, p_date, p_terms, p_date + p_terms, p_po, p_disc, p_ship, p_rate,
          (v_t ->> 'subtotal')::bigint, (v_t ->> 'cost')::bigint, (v_t ->> 'tax')::bigint, (v_t ->> 'total')::bigint, p_notes, auth.uid())
  returning id into v_id;
  insert into public.customer_invoice_lines (organization_id, invoice_id, line_no, item_id, sku, name, qty, price_cents, cost_cents)
  select p_org, v_id, ord, (x ->> 'item_id')::uuid, x ->> 'sku', x ->> 'name', (x ->> 'qty')::numeric, (x ->> 'price_cents')::bigint, (x ->> 'cost_cents')::bigint
    from jsonb_array_elements(p_lines) with ordinality as t(x, ord);
  -- Stock goes out when invoiced (locks items in a fixed order to avoid deadlocks).
  for l in select (x ->> 'item_id')::uuid as item, sum((x ->> 'qty')::numeric) as q
             from jsonb_array_elements(p_lines) x where x ->> 'item_id' is not null group by 1 order by 1 loop
    perform 1 from public.items where id = l.item for update;
    perform private.ws_move(p_org, l.item, -l.q, 'invoice', v_number, v_id);
  end loop;
  return v_id;
end $$;
revoke all on function private.ws_make_invoice(uuid, uuid, uuid, date, int, text, bigint, bigint, numeric, jsonb, text) from public, anon, authenticated;

-- Invoice a sales order (or a quote, which becomes the order): same lines, prices and costs.
create or replace function public.invoice_order(p_org uuid, p_order uuid, p_date date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare o public.sales_orders; c public.customers; v_lines jsonb; v_id uuid;
begin
  perform private.ws_guard(p_org, 'wholesale.receivables.manage');
  select * into o from public.sales_orders where id = p_order and organization_id = p_org for update;
  if not found then raise exception 'that order was not found' using errcode = '22023'; end if;
  if o.status in ('invoiced', 'cancelled') then raise exception 'this order is closed' using errcode = '22023'; end if;
  select * into c from public.customers where id = o.customer_id;
  select jsonb_agg(jsonb_build_object('item_id', item_id, 'sku', sku, 'name', name, 'qty', qty, 'price_cents', price_cents, 'cost_cents', cost_cents) order by line_no)
    into v_lines from public.sales_order_lines where order_id = o.id;
  if v_lines is null then raise exception 'the order has no lines' using errcode = '22023'; end if;
  v_id := private.ws_make_invoice(p_org, o.customer_id, o.id, coalesce(p_date, private.org_today(p_org)), c.terms, o.customer_po, o.discount_cents, o.shipping_cents,
                                  case when c.tax_exempt then 0 else o.tax_rate end, v_lines, o.notes);
  update public.sales_orders set status = 'invoiced', kind = 'order', invoice_id = v_id where id = o.id;
  return v_id;
end $$;

-- A direct invoice (no order). p: customer_id, invoice_date, terms, customer_po, discount_cents, shipping_cents, tax_rate, notes, lines[].
create or replace function public.create_customer_invoice(p_org uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare c public.customers; v_disc bigint := coalesce(nullif(p ->> 'discount_cents', '')::bigint, 0); v_ship bigint := coalesce(nullif(p ->> 'shipping_cents', '')::bigint, 0); v_rate numeric;
begin
  perform private.ws_guard(p_org, 'wholesale.receivables.manage');
  select * into c from public.customers where id = nullif(p ->> 'customer_id', '')::uuid and organization_id = p_org;
  if not found then raise exception 'choose the customer' using errcode = '22023'; end if;
  v_rate := case when c.tax_exempt then 0 else coalesce(nullif(p ->> 'tax_rate', '')::numeric, (private.ws_settings(p_org)).tax_rate) end;
  if v_disc < 0 or v_ship < 0 or v_disc > 10000000000 or v_ship > 10000000000 or v_rate < 0 or v_rate > 30 then raise exception 'check the discount, shipping and tax' using errcode = '22023'; end if;
  return private.ws_make_invoice(p_org, c.id, null, coalesce(nullif(p ->> 'invoice_date', '')::date, private.org_today(p_org)),
                                 coalesce(nullif(p ->> 'terms', '')::int, c.terms), nullif(btrim(left(p ->> 'customer_po', 60)), ''), v_disc, v_ship, v_rate,
                                 private.ws_lines(p_org, p -> 'lines'), nullif(btrim(left(p ->> 'notes', 1000)), ''));
end $$;

-- Void an invoice with no payments: stock comes back, its order reopens.
create or replace function public.void_customer_invoice(p_org uuid, p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare i public.customer_invoices; l record;
begin
  perform private.ws_guard(p_org, 'wholesale.receivables.manage');
  select * into i from public.customer_invoices where id = p_id and organization_id = p_org for update;
  if not found then raise exception 'that invoice was not found' using errcode = '22023'; end if;
  if i.voided_at is not null then raise exception 'this invoice is already void' using errcode = '22023'; end if;
  if exists (select 1 from public.customer_payments where invoice_id = p_id) then raise exception 'remove its payments first' using errcode = '22023'; end if;
  update public.customer_invoices set voided_at = now(), void_reason = nullif(btrim(left(p_reason, 200)), '') where id = p_id;
  for l in select item_id, sum(qty) as q from public.customer_invoice_lines where invoice_id = p_id and item_id is not null group by 1 order by 1 loop
    perform 1 from public.items where id = l.item_id for update;
    perform private.ws_move(p_org, l.item_id, l.q, 'invoice_void', i.number, p_id);
  end loop;
  update public.sales_orders set status = 'ready', invoice_id = null where invoice_id = p_id and organization_id = p_org;
end $$;

-- ---------------------------------------------------------------------------
-- Customer payments
-- ---------------------------------------------------------------------------
create or replace function public.record_customer_payment(p_org uuid, p_invoice uuid, p_paid_on date, p_amount_cents bigint, p_method text, p_check_no text, p_bank text, p_deposit_date date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare i public.customer_invoices; v_id uuid;
begin
  perform private.ws_guard(p_org, 'wholesale.receivables.manage');
  select * into i from public.customer_invoices where id = p_invoice and organization_id = p_org for update;
  if not found then raise exception 'that invoice was not found' using errcode = '22023'; end if;
  if i.voided_at is not null then raise exception 'this invoice is void' using errcode = '22023'; end if;
  if p_paid_on is null or p_paid_on < i.invoice_date - 366 or p_paid_on > private.org_today(p_org) then raise exception 'enter the day it was received, not in the future' using errcode = '22023'; end if;
  if coalesce(p_method, '') not in ('check', 'cash', 'ach', 'zelle', 'card', 'other') then raise exception 'pick how they paid' using errcode = '22023'; end if;
  if p_deposit_date is not null and (p_deposit_date < p_paid_on or p_deposit_date > private.org_today(p_org)) then raise exception 'the deposit date must be on or after the day received, not in the future' using errcode = '22023'; end if;
  if p_amount_cents is null or p_amount_cents < 1 or p_amount_cents > i.total_cents - private.ws_invoice_paid(p_invoice) then
    raise exception 'the payment must be over zero and no more than the balance' using errcode = '22023';
  end if;
  insert into public.customer_payments (organization_id, invoice_id, paid_on, amount_cents, method, check_no, bank, deposit_date, created_by)
  values (p_org, p_invoice, p_paid_on, p_amount_cents, p_method, nullif(btrim(left(regexp_replace(coalesce(p_check_no, ''), '^#', ''), 30)), ''),
          nullif(btrim(left(p_bank, 60)), ''), case when p_method in ('check', 'cash') then p_deposit_date else coalesce(p_deposit_date, p_paid_on) end, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.delete_customer_payment(p_org uuid, p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_exp uuid;
begin
  perform private.ws_guard(p_org, 'wholesale.receivables.manage');
  delete from public.customer_payments where id = p_id and organization_id = p_org returning expected_payment_id into v_exp;
  if not found then raise exception 'that payment was not found' using errcode = '22023'; end if;
  -- A payment from a plan reopens that expected payment when its last applied part is removed.
  if v_exp is not null and not exists (select 1 from public.customer_payments where expected_payment_id = v_exp) then
    update public.expected_payments set status = 'expected', received_on = null where id = v_exp;
  end if;
end $$;

-- Mark checks and cash deposited on a date.
create or replace function public.mark_payments_deposited(p_org uuid, p_ids uuid[], p_date date)
returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  perform private.ws_guard(p_org, 'wholesale.receivables.manage');
  if p_ids is null or cardinality(p_ids) not between 1 and 500 then raise exception 'pick 1 to 500 payments' using errcode = '22023'; end if;
  if p_date is null or p_date > private.org_today(p_org) then raise exception 'pick the deposit date, not in the future' using errcode = '22023'; end if;
  if exists (select 1 from public.customer_payments where id = any (p_ids) and organization_id = p_org and paid_on > p_date) then
    raise exception 'a payment was received after that deposit date' using errcode = '22023';
  end if;
  update public.customer_payments set deposit_date = p_date where id = any (p_ids) and organization_id = p_org and deposit_date is null;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- Payment plans
-- ---------------------------------------------------------------------------
-- Add expected payments for a customer: [{due_date, amount_cents, method, check_no, bank, note}].
create or replace function public.add_expected_payments(p_org uuid, p_customer uuid, p jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  perform private.ws_guard(p_org, 'wholesale.receivables.manage');
  if not exists (select 1 from public.customers where id = p_customer and organization_id = p_org) then raise exception 'choose the customer' using errcode = '22023'; end if;
  if jsonb_typeof(p) <> 'array' or jsonb_array_length(p) not between 1 and 60 then raise exception 'add 1 to 60 payments' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_array_elements(p) x where nullif(x ->> 'due_date', '')::date is null or (x ->> 'due_date')::date < '2000-01-01'
               or (x ->> 'due_date')::date > private.org_today(p_org) + 1100
               or nullif(x ->> 'amount_cents', '')::bigint is null or (x ->> 'amount_cents')::bigint not between 1 and 100000000000
               or coalesce(x ->> 'method', 'check') not in ('check', 'cash', 'ach', 'zelle', 'card', 'other')) then
    raise exception 'each payment needs a date and an amount over zero' using errcode = '22023';
  end if;
  insert into public.expected_payments (organization_id, customer_id, due_date, amount_cents, method, check_no, bank, note, created_by)
  select p_org, p_customer, (x ->> 'due_date')::date, (x ->> 'amount_cents')::bigint, coalesce(x ->> 'method', 'check'),
         nullif(btrim(left(regexp_replace(coalesce(x ->> 'check_no', ''), '^#', ''), 30)), ''), nullif(btrim(left(x ->> 'bank', 60)), ''), nullif(btrim(left(x ->> 'note', 200)), ''), auth.uid()
    from jsonb_array_elements(p) x;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.cancel_expected_payment(p_org uuid, p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.ws_guard(p_org, 'wholesale.receivables.manage');
  update public.expected_payments set status = 'cancelled' where id = p_id and organization_id = p_org and status = 'expected';
  if not found then raise exception 'that payment is not waiting to be received' using errcode = '22023'; end if;
end $$;

-- Receive an expected payment: the amount is applied to the customer's oldest
-- open invoices (by due date). Anything left over is refused rather than lost.
create or replace function public.receive_expected_payment(p_org uuid, p_id uuid, p_received_on date, p_amount_cents bigint, p_method text, p_check_no text, p_deposit_date date)
returns int language plpgsql security definer set search_path = '' as $$
declare e public.expected_payments; v_left bigint; v_bal bigint; v_part bigint; n int := 0; i record; v_method text;
begin
  perform private.ws_guard(p_org, 'wholesale.receivables.manage');
  select * into e from public.expected_payments where id = p_id and organization_id = p_org for update;
  if not found or e.status <> 'expected' then raise exception 'that payment is not waiting to be received' using errcode = '22023'; end if;
  v_left := coalesce(p_amount_cents, e.amount_cents);
  v_method := coalesce(nullif(p_method, ''), e.method);
  if v_left < 1 or v_left > 100000000000 then raise exception 'enter the amount received' using errcode = '22023'; end if;
  if coalesce(v_method, '') not in ('check', 'cash', 'ach', 'zelle', 'card', 'other') then raise exception 'pick how they paid' using errcode = '22023'; end if;
  if p_received_on is null or p_received_on > private.org_today(p_org) then raise exception 'enter the day it was received, not in the future' using errcode = '22023'; end if;
  if p_deposit_date is not null and (p_deposit_date < p_received_on or p_deposit_date > private.org_today(p_org)) then raise exception 'the deposit date must be on or after the day received' using errcode = '22023'; end if;
  for i in select ci.id, ci.total_cents from public.customer_invoices ci
            where ci.organization_id = p_org and ci.customer_id = e.customer_id and ci.voided_at is null
            order by ci.due_date, ci.invoice_date, ci.number for update loop
    exit when v_left = 0;
    v_bal := i.total_cents - private.ws_invoice_paid(i.id);
    continue when v_bal <= 0;
    v_part := least(v_bal, v_left);
    insert into public.customer_payments (organization_id, invoice_id, paid_on, amount_cents, method, check_no, bank, deposit_date, expected_payment_id, created_by)
    values (p_org, i.id, p_received_on, v_part, v_method, nullif(btrim(left(regexp_replace(coalesce(p_check_no, e.check_no, ''), '^#', ''), 30)), ''), e.bank,
            case when v_method in ('check', 'cash') then p_deposit_date else coalesce(p_deposit_date, p_received_on) end, e.id, auth.uid());
    v_left := v_left - v_part; n := n + 1;
  end loop;
  if v_left > 0 then
    raise exception 'that is % more than this customer owes; record the extra separately', to_char(v_left / 100.0, 'FM999999990.00') using errcode = '22023';
  end if;
  update public.expected_payments set status = 'received', received_on = p_received_on where id = e.id;
  return n;
end $$;

-- ---------------------------------------------------------------------------
revoke all on function public.save_wholesale_settings(uuid, jsonb), public.save_price_tiers(uuid, jsonb), public.save_customer(uuid, uuid, jsonb), public.delete_customer(uuid, uuid),
  public.save_item(uuid, uuid, jsonb), public.adjust_stock(uuid, uuid, numeric, text), public.delete_item(uuid, uuid), public.save_sales_order(uuid, uuid, jsonb),
  public.set_order_status(uuid, uuid, text), public.set_line_picked(uuid, uuid, boolean), public.invoice_order(uuid, uuid, date), public.create_customer_invoice(uuid, jsonb),
  public.void_customer_invoice(uuid, uuid, text), public.record_customer_payment(uuid, uuid, date, bigint, text, text, text, date), public.delete_customer_payment(uuid, uuid),
  public.mark_payments_deposited(uuid, uuid[], date), public.add_expected_payments(uuid, uuid, jsonb), public.cancel_expected_payment(uuid, uuid),
  public.receive_expected_payment(uuid, uuid, date, bigint, text, text, date) from public, anon;
grant execute on function public.save_wholesale_settings(uuid, jsonb), public.save_price_tiers(uuid, jsonb), public.save_customer(uuid, uuid, jsonb), public.delete_customer(uuid, uuid),
  public.save_item(uuid, uuid, jsonb), public.adjust_stock(uuid, uuid, numeric, text), public.delete_item(uuid, uuid), public.save_sales_order(uuid, uuid, jsonb),
  public.set_order_status(uuid, uuid, text), public.set_line_picked(uuid, uuid, boolean), public.invoice_order(uuid, uuid, date), public.create_customer_invoice(uuid, jsonb),
  public.void_customer_invoice(uuid, uuid, text), public.record_customer_payment(uuid, uuid, date, bigint, text, text, text, date), public.delete_customer_payment(uuid, uuid),
  public.mark_payments_deposited(uuid, uuid[], date), public.add_expected_payments(uuid, uuid, jsonb), public.cancel_expected_payment(uuid, uuid),
  public.receive_expected_payment(uuid, uuid, date, bigint, text, text, date) to authenticated;
