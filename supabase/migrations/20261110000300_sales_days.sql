-- =============================================================================
-- Phase 2.3 — Daily sales (register Z-reports) and imports
--
-- One row per location + register + business date. Recording a day posts:
--   Dr Cash on hand (cash) / Dr Card clearing (card) / Dr Customer credits (store credit)
--   Dr Discounts and returns (discounts)
--   Cr Sales (gross, excl. tax) / Cr Sales tax payable (tax)
-- Same rule as src/lib/accounting/postings.ts dailySales().
--
-- Rules:
--   * Written only through record_sales_day / void_sales_day.
--   * Tenders must equal gross − discounts + tax.
--   * A location/register/date can be recorded once; to correct it, void it
--     (posts a reversal) and record it again.
--   * Rows are never deleted; amounts are bigint cents.
-- =============================================================================

create table public.sales_import_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source text not null check (source in ('csv', 'vela')),
  filename text check (filename is null or char_length(filename) <= 200),
  row_count int not null default 0 check (row_count >= 0),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id, id)
);

create table public.sales_days (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  location_id uuid not null,
  register text not null default 'All registers' check (char_length(btrim(register)) between 1 and 60),
  business_date date not null,
  gross_sales_cents bigint not null check (gross_sales_cents >= 0),
  discounts_cents bigint not null default 0 check (discounts_cents >= 0),
  sales_tax_cents bigint not null default 0 check (sales_tax_cents >= 0),
  cash_cents bigint not null default 0 check (cash_cents >= 0),
  card_cents bigint not null default 0 check (card_cents >= 0),
  customer_credit_cents bigint not null default 0 check (customer_credit_cents >= 0),
  transaction_count int check (transaction_count is null or transaction_count >= 0),
  source text not null check (source in ('manual', 'csv', 'vela')),
  import_batch_id uuid,
  journal_entry_id uuid not null,
  voided_at timestamptz,
  voided_by uuid references auth.users(id) on delete set null,
  void_reason text check (void_reason is null or char_length(void_reason) <= 500),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (discounts_cents <= gross_sales_cents),
  check (cash_cents + card_cents + customer_credit_cents = gross_sales_cents - discounts_cents + sales_tax_cents),
  unique (organization_id, id),
  foreign key (organization_id, location_id) references public.locations (organization_id, id),
  foreign key (organization_id, import_batch_id) references public.sales_import_batches (organization_id, id),
  foreign key (organization_id, journal_entry_id) references public.journal_entries (organization_id, id)
);
create unique index sales_days_unique_live on public.sales_days (organization_id, location_id, lower(btrim(register)), business_date)
  where voided_at is null;
create index sales_days_org_date_idx on public.sales_days (organization_id, business_date desc);

-- Optional per-category breakdown (from category reports). Reporting only; not posted.
create table public.sales_day_categories (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  sales_day_id uuid not null,
  category text not null check (char_length(btrim(category)) between 1 and 120),
  net_sales_cents bigint not null check (net_sales_cents >= 0),
  quantity numeric(12, 2) check (quantity is null or quantity >= 0),
  foreign key (organization_id, sales_day_id) references public.sales_days (organization_id, id) on delete cascade
);
create index sales_day_categories_day_idx on public.sales_day_categories (sales_day_id);

-- Only the void columns may ever change, and only once.
create or replace function private.guard_sales_day_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.voided_at is not null then
    raise exception 'a voided sales day cannot be changed' using errcode = '42501';
  end if;
  if (new.organization_id, new.location_id, new.register, new.business_date, new.gross_sales_cents, new.discounts_cents,
      new.sales_tax_cents, new.cash_cents, new.card_cents, new.customer_credit_cents, new.transaction_count,
      new.source, new.import_batch_id, new.journal_entry_id, new.created_by, new.created_at)
     is distinct from
     (old.organization_id, old.location_id, old.register, old.business_date, old.gross_sales_cents, old.discounts_cents,
      old.sales_tax_cents, old.cash_cents, old.card_cents, old.customer_credit_cents, old.transaction_count,
      old.source, old.import_batch_id, old.journal_entry_id, old.created_by, old.created_at) then
    raise exception 'recorded sales days are immutable; void and re-record instead' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger sales_days_guard before update on public.sales_days
  for each row execute function private.guard_sales_day_update();
create trigger sales_days_no_delete before delete on public.sales_days
  for each row execute function private.forbid_ledger_mutation();
create trigger sales_day_categories_immutable before update or delete on public.sales_day_categories
  for each row execute function private.forbid_ledger_mutation();

-- -----------------------------------------------------------------------------
-- RPCs
-- -----------------------------------------------------------------------------
create or replace function public.create_sales_import_batch(p_org uuid, p_source text, p_filename text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform private.require_user();
  if not private.has_permission(p_org, 'sales.import') or not private.org_is_writable(p_org) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if p_source not in ('csv', 'vela') then raise exception 'unknown import source' using errcode = '22023'; end if;
  insert into public.sales_import_batches (organization_id, source, filename, created_by)
  values (p_org, p_source, left(nullif(btrim(p_filename), ''), 200), auth.uid()) returning id into v_id;
  return v_id;
end $$;

-- p_categories (optional): [{"category": text, "net_sales_cents": int, "quantity": number}, ...]
create or replace function public.record_sales_day(
  p_org uuid, p_location_id uuid, p_business_date date,
  p_gross_sales_cents bigint, p_discounts_cents bigint, p_sales_tax_cents bigint,
  p_cash_cents bigint, p_card_cents bigint,
  p_customer_credit_cents bigint default 0, p_register text default 'All registers',
  p_transaction_count int default null, p_source text default 'manual',
  p_import_batch_id uuid default null, p_categories jsonb default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := gen_random_uuid();
  v_entry uuid;
  v_loc text;
  v_reg text := coalesce(nullif(btrim(p_register), ''), 'All registers');
  v_lines jsonb := '[]'::jsonb;
  v_credit bigint := coalesce(p_customer_credit_cents, 0);
  v_disc bigint := coalesce(p_discounts_cents, 0);
  v_tax bigint := coalesce(p_sales_tax_cents, 0);
  v_cash bigint := coalesce(p_cash_cents, 0);
  v_card bigint := coalesce(p_card_cents, 0);
begin
  perform private.require_user();
  if not private.has_permission(p_org, 'sales.import') or not private.org_is_writable(p_org) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  select name into v_loc from public.locations where id = p_location_id and organization_id = p_org;
  if v_loc is null then raise exception 'location not found' using errcode = 'P0002'; end if;
  if p_business_date is null then raise exception 'business date is required' using errcode = '22023'; end if;
  if p_business_date > current_date + 1 then raise exception 'business date is in the future' using errcode = '22023'; end if;
  if p_source not in ('manual', 'csv', 'vela') then raise exception 'unknown sales source' using errcode = '22023'; end if;
  if p_gross_sales_cents is null or least(p_gross_sales_cents, v_disc, v_tax, v_cash, v_card, v_credit) < 0 then
    raise exception 'amounts cannot be negative' using errcode = '22023';
  end if;
  if v_disc > p_gross_sales_cents then raise exception 'discounts cannot exceed gross sales' using errcode = '22023'; end if;
  if v_cash + v_card + v_credit <> p_gross_sales_cents - v_disc + v_tax then
    raise exception 'payments (% cents) must equal sales minus discounts plus tax (% cents)',
      v_cash + v_card + v_credit, p_gross_sales_cents - v_disc + v_tax using errcode = '22023';
  end if;
  if p_import_batch_id is not null and not exists (
       select 1 from public.sales_import_batches where id = p_import_batch_id and organization_id = p_org) then
    raise exception 'import batch not found' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.sales_days where organization_id = p_org and location_id = p_location_id
               and lower(btrim(register)) = lower(v_reg) and business_date = p_business_date and voided_at is null) then
    raise exception 'sales for % at % (%) are already recorded; void that day first to replace it', p_business_date, v_loc, v_reg
      using errcode = '23505';
  end if;
  if p_categories is not null and jsonb_typeof(p_categories) <> 'array' then
    raise exception 'categories must be an array' using errcode = '22023';
  end if;
  if p_categories is not null and jsonb_array_length(p_categories) > 500 then
    raise exception 'too many categories' using errcode = '22023';
  end if;

  -- Same lines as postings.ts dailySales(); zero lines are skipped.
  select coalesce(jsonb_agg(l), '[]'::jsonb) into v_lines from (
    select jsonb_build_object('account_id', private.account_by_role(p_org, r.role), 'debit_cents', r.d, 'credit_cents', r.c, 'memo', r.memo) as l
      from (values ('cash_on_hand', v_cash, 0::bigint, 'Cash sales'),
                   ('card_clearing', v_card, 0, 'Card sales awaiting deposit'),
                   ('customer_credits', v_credit, 0, 'Store credit redeemed'),
                   ('sales_discounts', v_disc, 0, 'Discounts'),
                   ('sales', 0, p_gross_sales_cents, 'Sales'),
                   ('sales_tax_payable', 0, v_tax, 'Sales tax collected')) as r(role, d, c, memo)
     where r.d > 0 or r.c > 0) x;

  v_entry := private.post_entry(p_org, p_business_date, left('Sales — ' || v_loc || ' — ' || v_reg, 500), v_lines,
                                'sales:' || v_id::text, 'sales_day', v_id::text, p_location_id, null, false);

  insert into public.sales_days (id, organization_id, location_id, register, business_date, gross_sales_cents, discounts_cents,
    sales_tax_cents, cash_cents, card_cents, customer_credit_cents, transaction_count, source, import_batch_id,
    journal_entry_id, created_by)
  values (v_id, p_org, p_location_id, v_reg, p_business_date, p_gross_sales_cents, v_disc, v_tax, v_cash, v_card, v_credit,
    p_transaction_count, p_source, p_import_batch_id, v_entry, auth.uid());

  if p_categories is not null then
    insert into public.sales_day_categories (organization_id, sales_day_id, category, net_sales_cents, quantity)
    select p_org, v_id, btrim(c ->> 'category'), (c ->> 'net_sales_cents')::bigint, (c ->> 'quantity')::numeric
      from jsonb_array_elements(p_categories) c;
  end if;

  if p_import_batch_id is not null then
    update public.sales_import_batches set row_count = row_count + 1 where id = p_import_batch_id;
  end if;
  return v_id;
end $$;

create or replace function public.void_sales_day(p_sales_day uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_day public.sales_days;
  v_lines jsonb;
begin
  perform private.require_user();
  select * into v_day from public.sales_days where id = p_sales_day for update;
  if v_day.id is null then raise exception 'sales day not found' using errcode = 'P0002'; end if;
  if not private.has_permission(v_day.organization_id, 'sales.edit') or not private.org_is_writable(v_day.organization_id) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if v_day.voided_at is not null then raise exception 'this day is already void' using errcode = '22023'; end if;
  if p_reason is null or char_length(btrim(p_reason)) < 3 then raise exception 'a reason is required' using errcode = '22023'; end if;

  select jsonb_agg(jsonb_build_object('account_id', account_id, 'debit_cents', credit_cents,
                                      'credit_cents', debit_cents, 'memo', memo) order by id)
    into v_lines from public.journal_lines where entry_id = v_day.journal_entry_id;
  perform set_config('retailnexa.voiding_sales_day', p_sales_day::text, true);
  -- The reversal is dated on the original day so daily totals net to zero (fails if that period is closed).
  perform private.post_entry(v_day.organization_id, v_day.business_date, left('Reversal: ' || btrim(p_reason), 500), v_lines,
                             'reversal:' || v_day.journal_entry_id::text, 'reversal', v_day.journal_entry_id::text,
                             v_day.location_id, v_day.journal_entry_id, false);
  perform set_config('retailnexa.voiding_sales_day', '', true);

  update public.sales_days set voided_at = now(), voided_by = auth.uid(), void_reason = left(btrim(p_reason), 500)
   where id = p_sales_day;
  perform private.log_audit(v_day.organization_id, 'user', 'sales_day.voided', 'sales_day', p_sales_day::text,
    jsonb_build_object('reason', left(btrim(p_reason), 500), 'business_date', v_day.business_date));
end $$;

-- Sales-day entries must be undone through void_sales_day so the day and the ledger stay in step.
create or replace function private.forbid_direct_sales_reversal()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.reverses_entry_id is not null
     and exists (select 1 from public.journal_entries e where e.id = new.reverses_entry_id and e.source_type = 'sales_day')
     and coalesce(current_setting('retailnexa.voiding_sales_day', true), '') = '' then
    raise exception 'sales entries cannot be reversed directly; void the sales day instead' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger journal_entries_sales_reversal_guard before insert on public.journal_entries
  for each row execute function private.forbid_direct_sales_reversal();

-- -----------------------------------------------------------------------------
-- RLS + grants (read-only for clients)
-- -----------------------------------------------------------------------------
alter table public.sales_import_batches enable row level security;
alter table public.sales_days enable row level security;
alter table public.sales_day_categories enable row level security;

revoke all on public.sales_import_batches, public.sales_days, public.sales_day_categories from anon, authenticated;
grant select on public.sales_import_batches, public.sales_days, public.sales_day_categories to authenticated;

create policy sales_batches_select on public.sales_import_batches for select to authenticated
  using (private.has_permission(organization_id, 'sales.view') or private.has_support_access(organization_id));
create policy sales_days_select on public.sales_days for select to authenticated
  using (private.has_permission(organization_id, 'sales.view') or private.has_support_access(organization_id));
create policy sales_day_categories_select on public.sales_day_categories for select to authenticated
  using (private.has_permission(organization_id, 'sales.view') or private.has_support_access(organization_id));

grant all on public.sales_import_batches, public.sales_days, public.sales_day_categories to service_role;
grant all on all sequences in schema public to service_role;

revoke all on function
  public.create_sales_import_batch(uuid, text, text),
  public.record_sales_day(uuid, uuid, date, bigint, bigint, bigint, bigint, bigint, bigint, text, int, text, uuid, jsonb),
  public.void_sales_day(uuid, text)
  from public, anon, authenticated;
grant execute on function
  public.create_sales_import_batch(uuid, text, text),
  public.record_sales_day(uuid, uuid, date, bigint, bigint, bigint, bigint, bigint, bigint, text, int, text, uuid, jsonb),
  public.void_sales_day(uuid, text)
  to authenticated;

revoke all on all functions in schema private from public, anon;
grant execute on function
  private.is_org_member(uuid), private.member_role(uuid), private.has_permission(uuid, text),
  private.is_platform_admin(public.platform_role[]), private.has_support_access(uuid),
  private.org_is_writable(uuid), private.shares_org_with(uuid), private.role_rank(public.member_role)
  to authenticated, service_role;
