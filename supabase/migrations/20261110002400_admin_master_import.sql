-- =============================================================================
-- Admin master import (owner request, Nov 10 2026)
-- A superadmin (MFA session) loads data into any business from HQ: the owner's
-- old RetailNexa app backup, or spreadsheets. Rows arrive already mapped by the
-- app (src/lib/import) into one of these kinds:
--   vendor · bill (with payments) · recurring (fixed cost) · sales_day · bank_line
--
-- Every row is written through the SAME public RPCs a business uses
-- (create_bill, approve_bill, record_bill_payment, save_recurring_bill,
-- record_sales_day, import_bank_lines), acting as the business's owner for the
-- duration of the call. So all validation, store scoping, ledger posting,
-- closed-period rules and audit entries apply unchanged. The admin is recorded
-- in import_runs and in an "admin.import" audit entry.
--
-- Safety:
--   * superadmin + aal2 only (is_platform_admin), business must be writable;
--   * dry run by default: each row runs and is rolled back, errors reported;
--   * idempotent: import_keys remembers each imported row's key per business,
--     so re-running the same file never duplicates;
--   * one row failing never stops the rest (per-row subtransaction).
-- =============================================================================

create table public.import_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  admin_user_id uuid references auth.users(id) on delete set null,
  source text not null check (source in ('retailnexa_backup', 'csv')),
  kind text not null,
  file_name text check (file_name is null or char_length(file_name) <= 200),
  dry_run boolean not null,
  imported int not null default 0,
  skipped int not null default 0,
  failed int not null default 0,
  errors jsonb not null default '[]',
  created_at timestamptz not null default now()
);
create index import_runs_org_idx on public.import_runs (organization_id, created_at desc);
create index import_runs_admin_idx on public.import_runs (admin_user_id);
alter table public.import_runs enable row level security;
revoke all on public.import_runs from public, anon, authenticated;
grant select on public.import_runs to authenticated;
grant all on public.import_runs to service_role;
create policy import_runs_select on public.import_runs for select to authenticated
  using (private.is_platform_admin());

create table public.import_keys (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  key text not null check (char_length(key) between 1 and 200),
  entity text not null,
  entity_id uuid,
  created_at timestamptz not null default now(),
  primary key (organization_id, key)
);
alter table public.import_keys enable row level security;
revoke all on public.import_keys from public, anon, authenticated;
grant all on public.import_keys to service_role;

-- ---------------------------------------------------------------------------
-- Row handlers. They run while acting as the business owner (see below) and
-- only call public RPCs or private helpers, never trusting row ids.
-- ---------------------------------------------------------------------------
create or replace function private.import_vendor_id(p_org uuid, p_name text, p_terms int default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v uuid; v_name text := btrim(coalesce(p_name, ''));
begin
  if v_name = '' then raise exception 'vendor name is missing' using errcode = '22023'; end if;
  select id into v from public.vendors where organization_id = p_org and lower(btrim(name)) = lower(v_name) order by created_at limit 1;
  if v is null then
    insert into public.vendors (organization_id, name, payment_terms_days)
    values (p_org, left(v_name, 120), coalesce(p_terms, 30)) returning id into v;
  end if;
  return v;
end $$;

create or replace function private.import_vendor(p_org uuid, r jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v uuid; v_name text := btrim(coalesce(r ->> 'name', ''));
begin
  if v_name = '' then raise exception 'vendor name is missing' using errcode = '22023'; end if;
  select id into v from public.vendors where organization_id = p_org and lower(btrim(name)) = lower(v_name) limit 1;
  if v is not null then return v; end if;
  insert into public.vendors (organization_id, name, contact_name, email, phone, payment_terms_days, notes)
  values (p_org, left(v_name, 120), nullif(btrim(r ->> 'contact_name'), ''), nullif(btrim(lower(r ->> 'email')), ''),
          left(nullif(btrim(r ->> 'phone'), ''), 40), coalesce((r ->> 'payment_terms_days')::int, 30),
          left(nullif(btrim(r ->> 'notes'), ''), 2000))
  returning id into v;
  return v;
end $$;

create or replace function private.import_location_id(p_org uuid, p_name text)
returns uuid language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select id from public.locations where organization_id = p_org and is_active and nullif(btrim(p_name), '') is not null
        and lower(btrim(name)) = lower(btrim(p_name)) limit 1),
    (select id from public.locations where organization_id = p_org and is_active and kind = 'store' order by created_at limit 1))
$$;

create or replace function private.import_bill(p_org uuid, r jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_vendor uuid := private.import_vendor_id(p_org, r ->> 'vendor');
  v_cents bigint := (r ->> 'amount_cents')::bigint;
  v_bill uuid;
  p jsonb; n int := 0;
begin
  if v_cents is null or v_cents <= 0 then raise exception 'amount must be positive (credits are not imported)' using errcode = '22023'; end if;
  v_bill := public.create_bill(
    p_org, v_vendor,
    coalesce(nullif(btrim(r ->> 'bill_number'), ''), 'IMP-' || left(r ->> 'key', 40)),
    (r ->> 'bill_date')::date, (r ->> 'due_date')::date,
    jsonb_build_array(jsonb_build_object(
      'account_id', private.account_by_role(p_org, coalesce(nullif(r ->> 'account_role', ''), 'other_operating')),
      'amount_cents', v_cents, 'description', left(nullif(btrim(r ->> 'memo'), ''), 300))),
    left(nullif(btrim(r ->> 'memo'), ''), 500),
    case when nullif(r ->> 'location', '') is null then null else private.import_location_id(p_org, r ->> 'location') end);
  perform public.approve_bill(v_bill);
  for p in select * from jsonb_array_elements(coalesce(r -> 'payments', '[]'::jsonb)) loop
    n := n + 1;
    if coalesce((p ->> 'amount_cents')::bigint, 0) <= 0 then continue; end if;
    perform public.record_bill_payment(
      v_bill, (p ->> 'date')::date, (p ->> 'amount_cents')::bigint,
      (case when p ->> 'source' = 'cash_on_hand' then 'cash_on_hand' else 'bank' end)::public.payment_source,
      left('imp-' || (r ->> 'key') || '-' || n, 100), left(nullif(btrim(p ->> 'reference'), ''), 100));
  end loop;
  return v_bill;
end $$;

create or replace function private.import_recurring(p_org uuid, r jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_vendor uuid := private.import_vendor_id(p_org, coalesce(r ->> 'vendor', r ->> 'name'));
begin
  if coalesce((r ->> 'amount_cents')::bigint, 0) <= 0 then raise exception 'amount must be positive' using errcode = '22023'; end if;
  return public.save_recurring_bill(
    p_org, null, v_vendor, r ->> 'name',
    jsonb_build_array(jsonb_build_object(
      'account_id', private.account_by_role(p_org, coalesce(nullif(r ->> 'account_role', ''), 'other_operating')),
      'amount_cents', (r ->> 'amount_cents')::bigint, 'description', r ->> 'name')),
    'monthly'::public.recurrence, (r ->> 'next_date')::date, (r ->> 'day_of_month')::int, 0,
    (r ->> 'end_date')::date, null, coalesce((r ->> 'active')::boolean, true));
end $$;

create or replace function private.import_sales_day(p_org uuid, r jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_loc uuid := private.import_location_id(p_org, r ->> 'location');
begin
  if v_loc is null then raise exception 'this business has no store location' using errcode = 'P0002'; end if;
  return public.record_sales_day(
    p_org, v_loc, (r ->> 'date')::date,
    coalesce((r ->> 'gross_sales_cents')::bigint, 0), coalesce((r ->> 'discounts_cents')::bigint, 0),
    coalesce((r ->> 'sales_tax_cents')::bigint, 0), coalesce((r ->> 'cash_cents')::bigint, 0),
    coalesce((r ->> 'card_cents')::bigint, 0), coalesce((r ->> 'customer_credit_cents')::bigint, 0),
    coalesce(nullif(btrim(r ->> 'register'), ''), 'All registers'), (r ->> 'transaction_count')::int, 'csv', null, null);
end $$;

-- ---------------------------------------------------------------------------
-- Entry point
-- ---------------------------------------------------------------------------
create or replace function public.admin_import_rows(
  p_org uuid, p_kind text, p_rows jsonb, p_dry_run boolean default true,
  p_source text default 'csv', p_file_name text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := auth.uid();
  v_prev text := current_setting('request.jwt.claims', true);
  v_owner uuid;
  r jsonb; i int := 0;
  v_key text; v_id uuid;
  v_ok int := 0; v_skip int := 0; v_err jsonb := '[]'::jsonb;
  v_bank record;
begin
  if v_admin is null or not private.is_platform_admin(array['superadmin']::public.platform_role[]) then
    raise exception 'permission denied: only a superadmin with two-factor can import' using errcode = '42501';
  end if;
  if p_kind not in ('vendor', 'bill', 'recurring', 'sales_day', 'bank_line') then
    raise exception 'unknown import kind' using errcode = '22023';
  end if;
  if p_source not in ('retailnexa_backup', 'csv') then raise exception 'unknown import source' using errcode = '22023'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) not between 1 and 500 then
    raise exception 'send 1 to 500 rows at a time' using errcode = '22023';
  end if;
  if not exists (select 1 from public.organizations where id = p_org) then
    raise exception 'business not found' using errcode = 'P0002';
  end if;
  if not private.org_is_writable(p_org) then
    raise exception 'this business is read-only: give it a billing waiver or a subscription first' using errcode = '42501';
  end if;
  select m.user_id into v_owner from public.memberships m
   where m.organization_id = p_org and m.role = 'owner' and m.status = 'active' order by m.created_at limit 1;
  if v_owner is null then raise exception 'this business has no active owner' using errcode = 'P0002'; end if;

  -- Act as the owner (with a completed second factor) for the business's own RPCs.
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', v_owner, 'role', 'authenticated', 'aal', 'aal2')::text, true);

  if p_kind = 'bank_line' then
    -- Bank lines import as one statement batch; the bank importer de-duplicates itself.
    if not p_dry_run then
      select * into v_bank from public.import_bank_lines(p_org, coalesce(p_file_name, 'Admin import'), p_rows);
      v_ok := v_bank.inserted; v_skip := v_bank.duplicates;
    else
      begin
        select * into v_bank from public.import_bank_lines(p_org, coalesce(p_file_name, 'Admin import'), p_rows);
        v_ok := v_bank.inserted; v_skip := v_bank.duplicates;
        raise exception using errcode = 'P0001', message = '__dry_run__';
      exception when others then
        if sqlerrm <> '__dry_run__' then v_err := v_err || jsonb_build_object('row', 0, 'error', left(sqlerrm, 300)); v_ok := 0; end if;
      end;
    end if;
  else
    for r in select * from jsonb_array_elements(p_rows) loop
      i := i + 1;
      v_key := p_kind || ':' || coalesce(nullif(btrim(r ->> 'key'), ''), md5(r::text));
      if exists (select 1 from public.import_keys where organization_id = p_org and key = left(v_key, 200)) then
        v_skip := v_skip + 1;
        continue;
      end if;
      begin
        v_id := case p_kind
          when 'vendor' then private.import_vendor(p_org, r)
          when 'bill' then private.import_bill(p_org, r)
          when 'recurring' then private.import_recurring(p_org, r)
          when 'sales_day' then private.import_sales_day(p_org, r)
        end;
        insert into public.import_keys (organization_id, key, entity, entity_id) values (p_org, left(v_key, 200), p_kind, v_id);
        if p_dry_run then raise exception using errcode = 'P0001', message = '__dry_run__'; end if;
        v_ok := v_ok + 1;
      exception when others then
        if sqlerrm = '__dry_run__' then v_ok := v_ok + 1;
        else v_err := v_err || jsonb_build_object('row', i, 'key', r ->> 'key', 'error', left(sqlerrm, 300));
        end if;
      end;
    end loop;
  end if;

  -- Back to the admin for the record of what happened.
  perform set_config('request.jwt.claims', coalesce(v_prev, ''), true);
  insert into public.import_runs (organization_id, admin_user_id, source, kind, file_name, dry_run, imported, skipped, failed, errors)
  values (p_org, v_admin, p_source, p_kind, left(p_file_name, 200), p_dry_run, v_ok, v_skip, jsonb_array_length(v_err), v_err);
  if not p_dry_run then
    perform private.log_audit(p_org, 'platform_admin', 'admin.import', 'organization', p_org::text,
      jsonb_build_object('kind', p_kind, 'source', p_source, 'file', p_file_name, 'imported', v_ok, 'skipped', v_skip, 'failed', jsonb_array_length(v_err)));
  end if;
  return jsonb_build_object('imported', v_ok, 'skipped', v_skip, 'failed', jsonb_array_length(v_err), 'errors', v_err, 'dry_run', p_dry_run);
exception when others then
  perform set_config('request.jwt.claims', coalesce(v_prev, ''), true);
  raise;
end $$;

revoke all on function
  private.import_vendor_id(uuid, text, int), private.import_vendor(uuid, jsonb), private.import_location_id(uuid, text),
  private.import_bill(uuid, jsonb), private.import_recurring(uuid, jsonb), private.import_sales_day(uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.admin_import_rows(uuid, text, jsonb, boolean, text, text) from public, anon;
grant execute on function public.admin_import_rows(uuid, text, jsonb, boolean, text, text) to authenticated;
