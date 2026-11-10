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
--   * superadmin with a completed second factor (aal2) only, AND a live support
--     access grant from the business (Settings → Support access), the same
--     consent HQ needs to read a business's data (#128);
--   * the business must be writable;
--   * every record is attributed to the admin, not the owner: every audit row
--     written during the call is actor_type 'platform_admin' with the admin's id,
--     on_behalf_of (the owner) and import_run_id; created_by / approved_by /
--     posted_by name the admin (#128);
--   * dates must be real and in range, store names must match (#130, #131);
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
  created_at timestamptz not null default now(),
  -- Set when the call ends; the import context is only live while this is null.
  finished_at timestamptz
);
create index import_runs_org_idx on public.import_runs (organization_id, created_at desc);
create index import_runs_admin_idx on public.import_runs (admin_user_id);
alter table public.import_runs enable row level security;
revoke all on public.import_runs from public, anon, authenticated;
grant select on public.import_runs to authenticated;
grant all on public.import_runs to service_role;
create policy import_runs_select on public.import_runs for select to authenticated
  using (private.is_platform_admin(array['superadmin']::public.platform_role[]));

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
-- Attribution (#128). While admin_import_rows runs it sets the transaction-local
-- setting app.import_run to its import_runs row. import_actor() returns that
-- run's admin only if the row was created in THIS transaction (created_at =
-- now()) and isn't finished, so the setting can't be forged from outside:
-- clients can't insert import_runs rows.
-- ---------------------------------------------------------------------------
create or replace function private.import_actor()
returns uuid language sql stable security definer set search_path = '' as $$
  select r.admin_user_id from public.import_runs r
   where r.id = case when current_setting('app.import_run', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                     then current_setting('app.import_run', true)::uuid end
     and r.created_at = now() and r.finished_at is null
$$;

-- Every audit row written during an import names the admin (all writers, including
-- the ledger poster's direct insert), keeps the owner as on_behalf_of and points at the run.
create or replace function private.audit_import_actor()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_admin uuid := private.import_actor();
begin
  if v_admin is null then return new; end if;
  new.metadata := coalesce(new.metadata, '{}'::jsonb)
    || case when new.actor_user_id is distinct from v_admin then jsonb_build_object('on_behalf_of', new.actor_user_id) else '{}'::jsonb end
    || jsonb_build_object('import_run_id', current_setting('app.import_run', true));
  new.actor_user_id := v_admin;
  new.actor_type := 'platform_admin';
  return new;
end $$;
create trigger aa_import_actor before insert on public.audit_logs
  for each row execute function private.audit_import_actor();

-- created_by / approved_by / posted_by name the admin during an import.
create or replace function private.stamp_import_actor()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_admin uuid := private.import_actor(); c text; v jsonb := '{}';
begin
  if v_admin is null then return new; end if;
  foreach c in array tg_argv loop
    if (to_jsonb(new) ->> c) is not null
       and (tg_op = 'INSERT' or (to_jsonb(new) -> c) is distinct from (to_jsonb(old) -> c)) then
      v := v || jsonb_build_object(c, v_admin);
    end if;
  end loop;
  if v <> '{}'::jsonb then new := jsonb_populate_record(new, v); end if;
  return new;
end $$;
create trigger zz_import_actor before insert or update on public.bills
  for each row execute function private.stamp_import_actor('created_by', 'approved_by');
create trigger zz_import_actor before insert on public.bill_payments
  for each row execute function private.stamp_import_actor('created_by');
create trigger zz_import_actor before insert on public.journal_entries
  for each row execute function private.stamp_import_actor('posted_by');
create trigger zz_import_actor before insert on public.sales_days
  for each row execute function private.stamp_import_actor('created_by');
create trigger zz_import_actor before insert on public.recurring_bills
  for each row execute function private.stamp_import_actor('created_by');
create trigger zz_import_actor before insert on public.bank_import_batches
  for each row execute function private.stamp_import_actor('created_by');

-- A real calendar date in [p_min, p_max] (#130). Empty → null.
create or replace function private.import_date(p_val text, p_what text, p_min date, p_max date)
returns date language plpgsql stable set search_path = '' as $$
declare d date;
begin
  if p_val is null or btrim(p_val) = '' then return null; end if;
  if btrim(p_val) !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception '% must be a date like 2026-10-31', p_what using errcode = '22023';
  end if;
  begin d := btrim(p_val)::date;
  exception when others then raise exception '% % is not a real date', p_what, p_val using errcode = '22023';
  end;
  if d < p_min or d > p_max then
    raise exception '% % is outside % to %', p_what, d, p_min, p_max using errcode = '22023';
  end if;
  return d;
end $$;

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

-- A store by name (#131). A name that doesn't match is an error, never "the first
-- store". With no name: null, unless p_required, when the business must have
-- exactly one active store.
create or replace function private.import_location_id(p_org uuid, p_name text, p_required boolean default false)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v uuid; n int;
begin
  if nullif(btrim(p_name), '') is not null then
    select id into v from public.locations where organization_id = p_org and is_active
       and lower(btrim(name)) = lower(btrim(p_name)) order by created_at limit 1;
    if v is null then raise exception 'store "%" not found in this business', left(btrim(p_name), 60) using errcode = 'P0002'; end if;
    return v;
  end if;
  if not p_required then return null; end if;
  select count(*), min(id::text)::uuid into n, v from public.locations where organization_id = p_org and is_active and kind = 'store';
  if n = 1 then return v; end if;
  if n = 0 then raise exception 'this business has no store location' using errcode = 'P0002'; end if;
  raise exception 'this business has % stores: pick the store for these sales', n using errcode = '22023';
end $$;

create or replace function private.import_bill(p_org uuid, r jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_vendor uuid := private.import_vendor_id(p_org, r ->> 'vendor');
  v_cents bigint := (r ->> 'amount_cents')::bigint;
  v_today date := private.org_today(p_org);
  v_bill_date date := private.import_date(r ->> 'bill_date', 'bill date', '2000-01-01', v_today + 366);
  v_due date := private.import_date(r ->> 'due_date', 'due date', '2000-01-01', v_today + 731);
  v_bill uuid;
  p jsonb; n int := 0;
begin
  if v_cents is null or v_cents <= 0 then raise exception 'amount must be positive (credits are not imported)' using errcode = '22023'; end if;
  if v_bill_date is null then raise exception 'bill date is missing' using errcode = '22023'; end if;
  if jsonb_typeof(coalesce(r -> 'payments', '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(r -> 'payments', '[]'::jsonb)) > 100 then
    raise exception 'a bill can have at most 100 payments' using errcode = '22023';
  end if;
  v_bill := public.create_bill(
    p_org, v_vendor,
    coalesce(nullif(btrim(r ->> 'bill_number'), ''), 'IMP-' || left(r ->> 'key', 40)),
    v_bill_date, v_due,
    jsonb_build_array(jsonb_build_object(
      'account_id', private.account_by_role(p_org, coalesce(nullif(r ->> 'account_role', ''), 'other_operating')),
      'amount_cents', v_cents, 'description', left(nullif(btrim(r ->> 'memo'), ''), 300))),
    left(nullif(btrim(r ->> 'memo'), ''), 500),
    private.import_location_id(p_org, r ->> 'location'));
  perform public.approve_bill(v_bill);
  for p in select * from jsonb_array_elements(coalesce(r -> 'payments', '[]'::jsonb)) loop
    n := n + 1;
    if coalesce((p ->> 'amount_cents')::bigint, 0) <= 0 then
      raise exception 'payment % must be a positive amount', n using errcode = '22023';
    end if;
    perform public.record_bill_payment(
      v_bill, coalesce(private.import_date(p ->> 'date', 'payment date', '2000-01-01', v_today), v_bill_date), (p ->> 'amount_cents')::bigint,
      (case when p ->> 'source' = 'cash_on_hand' then 'cash_on_hand' else 'bank' end)::public.payment_source,
      left('imp-' || (r ->> 'key') || '-' || n, 100), left(nullif(btrim(p ->> 'reference'), ''), 100));
  end loop;
  return v_bill;
end $$;

create or replace function private.import_recurring(p_org uuid, r jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_vendor uuid := private.import_vendor_id(p_org, coalesce(r ->> 'vendor', r ->> 'name'));
  v_today date := private.org_today(p_org);
  v_next date := private.import_date(r ->> 'next_date', 'next date', '2000-01-01', v_today + 731);
  v_end date := private.import_date(r ->> 'end_date', 'end date', '2000-01-01', '2100-12-31');
begin
  if coalesce((r ->> 'amount_cents')::bigint, 0) <= 0 then raise exception 'amount must be positive' using errcode = '22023'; end if;
  return public.save_recurring_bill(
    p_org, null, v_vendor, r ->> 'name',
    jsonb_build_array(jsonb_build_object(
      'account_id', private.account_by_role(p_org, coalesce(nullif(r ->> 'account_role', ''), 'other_operating')),
      'amount_cents', (r ->> 'amount_cents')::bigint, 'description', r ->> 'name')),
    'monthly'::public.recurrence, v_next, (r ->> 'day_of_month')::int, 0,
    v_end, null, coalesce((r ->> 'active')::boolean, true));
end $$;

create or replace function private.import_sales_day(p_org uuid, r jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_loc uuid := private.import_location_id(p_org, r ->> 'location', true);
  v_date date := private.import_date(r ->> 'date', 'sales date', '2000-01-01', private.org_today(p_org));
begin
  if v_date is null then raise exception 'sales date is missing' using errcode = '22023'; end if;
  return public.record_sales_day(
    p_org, v_loc, v_date,
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
  v_run uuid;
  v_today date;
  r jsonb; l jsonb; i int := 0;
  v_raw text; v_key text; v_id uuid;
  v_ok int := 0; v_skip int := 0; v_err jsonb := '[]'::jsonb;
  v_bank record;
begin
  if v_admin is null or not private.is_platform_admin(array['superadmin']::public.platform_role[])
     or coalesce(nullif(v_prev, '')::jsonb ->> 'aal', '') <> 'aal2' then
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
  -- Writing into a business needs its consent, the same as reading it (#128).
  if not private.has_support_access(p_org) then
    raise exception 'permission denied: the business must give HQ support access first (Settings → Support access)' using errcode = '42501';
  end if;
  if not private.org_is_writable(p_org) then
    raise exception 'this business is read-only: give it a billing waiver or a subscription first' using errcode = '42501';
  end if;
  select m.user_id into v_owner from public.memberships m
   where m.organization_id = p_org and m.role = 'owner' and m.status = 'active' order by m.created_at limit 1;
  if v_owner is null then raise exception 'this business has no active owner' using errcode = 'P0002'; end if;
  v_today := private.org_today(p_org);

  -- The run row comes first so every record written below can point at it.
  insert into public.import_runs (organization_id, admin_user_id, source, kind, file_name, dry_run)
  values (p_org, v_admin, p_source, p_kind, left(p_file_name, 200), p_dry_run) returning id into v_run;
  perform set_config('app.import_run', v_run::text, true);
  -- Act as the owner (with a completed second factor) for the business's own RPCs.
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', v_owner, 'role', 'authenticated', 'aal', 'aal2')::text, true);

  if p_kind = 'bank_line' then
    -- Bank lines import as one statement batch; the bank importer de-duplicates itself.
    for l in select * from jsonb_array_elements(p_rows) loop
      i := i + 1;
      begin
        perform private.import_date(coalesce(l ->> 'date', l ->> 'posted_on'), 'bank date', '2000-01-01', v_today);
        if coalesce(l ->> 'date', l ->> 'posted_on') is null then raise exception 'bank date is missing' using errcode = '22023'; end if;
      exception when others then
        v_err := v_err || jsonb_build_object('row', i, 'error', left(sqlerrm, 300));
      end;
    end loop;
    if jsonb_array_length(v_err) = 0 then
      begin
        select * into v_bank from public.import_bank_lines(p_org, coalesce(p_file_name, 'Admin import'), p_rows);
        v_ok := v_bank.inserted; v_skip := v_bank.duplicates;
        if p_dry_run then raise exception using errcode = 'P0001', message = '__dry_run__'; end if;
      exception when others then
        if sqlerrm <> '__dry_run__' then v_err := v_err || jsonb_build_object('row', 0, 'error', left(sqlerrm, 300)); v_ok := 0; v_skip := 0; end if;
      end;
    end if;
  else
    for r in select * from jsonb_array_elements(p_rows) loop
      i := i + 1;
      begin
        if jsonb_typeof(r) <> 'object' then raise exception 'row is not an object' using errcode = '22023'; end if;
        -- Rows without a key get one from their content; long keys are hashed, never cut (they'd collide).
        v_raw := coalesce(nullif(btrim(r ->> 'key'), ''), 'auto:' || md5(r::text));
        r := r || jsonb_build_object('key', v_raw);
        if char_length(v_raw) > 150 then v_raw := 'h:' || md5(v_raw); end if;
        -- Sales days are per store: the store is part of the key (#131).
        v_key := p_kind || ':' || case when p_kind = 'sales_day'
          then private.import_location_id(p_org, r ->> 'location', true)::text || ':' else '' end || v_raw;
        if exists (select 1 from public.import_keys where organization_id = p_org and key = v_key) then
          v_skip := v_skip + 1;
        else
          v_id := case p_kind
            when 'vendor' then private.import_vendor(p_org, r)
            when 'bill' then private.import_bill(p_org, r)
            when 'recurring' then private.import_recurring(p_org, r)
            when 'sales_day' then private.import_sales_day(p_org, r)
          end;
          insert into public.import_keys (organization_id, key, entity, entity_id) values (p_org, v_key, p_kind, v_id);
          if p_dry_run then raise exception using errcode = 'P0001', message = '__dry_run__'; end if;
          v_ok := v_ok + 1;
        end if;
      exception when others then
        if sqlerrm = '__dry_run__' then v_ok := v_ok + 1;
        else v_err := v_err || jsonb_build_object('row', i, 'key', r ->> 'key', 'error', left(sqlerrm, 300));
        end if;
      end;
    end loop;
  end if;

  -- Back to the admin for the record of what happened; the import context ends here.
  perform set_config('request.jwt.claims', coalesce(v_prev, ''), true);
  update public.import_runs set imported = v_ok, skipped = v_skip, failed = jsonb_array_length(v_err), errors = v_err, finished_at = clock_timestamp()
   where id = v_run;
  perform set_config('app.import_run', '', true);
  if not p_dry_run then
    perform private.log_audit(p_org, 'platform_admin', 'admin.import', 'organization', p_org::text,
      jsonb_build_object('kind', p_kind, 'source', p_source, 'file', p_file_name, 'import_run_id', v_run,
                         'imported', v_ok, 'skipped', v_skip, 'failed', jsonb_array_length(v_err)));
  end if;
  return jsonb_build_object('imported', v_ok, 'skipped', v_skip, 'failed', jsonb_array_length(v_err), 'errors', v_err, 'dry_run', p_dry_run, 'run', v_run);
exception when others then
  perform set_config('request.jwt.claims', coalesce(v_prev, ''), true);
  perform set_config('app.import_run', '', true);
  raise;
end $$;

revoke all on function
  private.import_actor(), private.stamp_import_actor(), private.audit_import_actor(), private.import_date(text, text, date, date),
  private.import_vendor_id(uuid, text, int), private.import_vendor(uuid, jsonb), private.import_location_id(uuid, text, boolean),
  private.import_bill(uuid, jsonb), private.import_recurring(uuid, jsonb), private.import_sales_day(uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.admin_import_rows(uuid, text, jsonb, boolean, text, text) from public, anon;
grant execute on function public.admin_import_rows(uuid, text, jsonb, boolean, text, text) to authenticated;
