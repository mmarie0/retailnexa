-- =============================================================================
-- Phase 2.1 — Double-entry ledger
-- Chart of accounts, accounting periods, journal entries + lines.
--
-- Rules (SECURITY_RULES §15):
--   * Entries are posted only through post_journal_entry(): balanced, >= 2 lines,
--     accounts of the same org, open period, idempotent per (org, idempotency_key).
--   * Posted rows are immutable (no UPDATE/DELETE for anyone, trigger-enforced).
--     Corrections are reversing entries; an entry can be reversed once.
--   * Amounts are bigint cents; each line is either a debit or a credit.
-- =============================================================================

create type public.account_type as enum ('asset', 'liability', 'equity', 'revenue', 'expense');

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code text not null check (code ~ '^[0-9A-Za-z.-]{1,20}$'),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  type public.account_type not null,
  -- Semantic role used by posting helpers (one account per role per org).
  role text check (role is null or role ~ '^[a-z_]+$'),
  is_active boolean not null default true,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, code),
  unique (organization_id, id)
);
create unique index accounts_org_role_uidx on public.accounts (organization_id, role) where role is not null;
create trigger accounts_updated_at before update on public.accounts
  for each row execute function private.set_updated_at();
create trigger audit_accounts after insert or update or delete on public.accounts
  for each row execute function private.audit_row_change();

create table public.accounting_periods (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  closed_through date not null,           -- everything on or before this date is closed
  closed_by uuid references auth.users(id) on delete set null,
  closed_at timestamptz not null default now(),
  note text check (note is null or char_length(note) <= 500)
);
create index accounting_periods_org_idx on public.accounting_periods (organization_id, closed_through desc);

create table public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entry_date date not null,
  memo text not null check (char_length(btrim(memo)) between 1 and 500),
  source_type text check (source_type is null or source_type ~ '^[a-z_]+$'),
  source_id text check (source_id is null or char_length(source_id) <= 100),
  location_id uuid,
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 200),
  payload_hash text not null,
  reverses_entry_id uuid references public.journal_entries(id),
  posted_by uuid references auth.users(id) on delete set null,
  posted_by_system boolean not null default false,
  created_at timestamptz not null default now(),
  unique (organization_id, idempotency_key),
  unique (organization_id, id),
  foreign key (organization_id, location_id) references public.locations (organization_id, id)
);
create unique index journal_entries_reverses_uidx on public.journal_entries (reverses_entry_id) where reverses_entry_id is not null;
create index journal_entries_org_date_idx on public.journal_entries (organization_id, entry_date);
create index journal_entries_source_idx on public.journal_entries (organization_id, source_type, source_id);

create table public.journal_lines (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  entry_id uuid not null,
  account_id uuid not null,
  debit_cents bigint not null default 0 check (debit_cents >= 0),
  credit_cents bigint not null default 0 check (credit_cents >= 0),
  memo text check (memo is null or char_length(memo) <= 300),
  check ((debit_cents > 0) <> (credit_cents > 0)),
  foreign key (organization_id, entry_id) references public.journal_entries (organization_id, id) on delete cascade,
  foreign key (organization_id, account_id) references public.accounts (organization_id, id)
);
create index journal_lines_entry_idx on public.journal_lines (entry_id);
create index journal_lines_account_idx on public.journal_lines (organization_id, account_id);

-- Immutability: posted ledger rows can never change. (Org deletion still cascades.)
create or replace function private.forbid_ledger_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.organizations o where o.id = old.organization_id) then
    return old; -- cascade from an owner-approved organization deletion
  end if;
  raise exception 'posted ledger entries are immutable; post a reversing entry instead' using errcode = '42501';
end $$;
create trigger journal_entries_immutable before update or delete on public.journal_entries
  for each row execute function private.forbid_ledger_mutation();
create trigger journal_lines_immutable before update or delete on public.journal_lines
  for each row execute function private.forbid_ledger_mutation();

-- -----------------------------------------------------------------------------
-- Default chart of accounts (seeded for every organization)
-- -----------------------------------------------------------------------------
create or replace function private.seed_default_accounts(p_org uuid)
returns void language sql security definer set search_path = '' as $$
  insert into public.accounts (organization_id, code, name, type, role, is_system)
  values
    (p_org, '1000', 'Cash on hand',                 'asset',     'cash_on_hand', true),
    (p_org, '1010', 'Bank account',                 'asset',     'bank', true),
    (p_org, '1050', 'Card payments in transit',     'asset',     'card_clearing', true),
    (p_org, '1100', 'Accounts receivable',          'asset',     'accounts_receivable', true),
    (p_org, '1200', 'Inventory',                    'asset',     'inventory', true),
    (p_org, '2000', 'Accounts payable',             'liability', 'accounts_payable', true),
    (p_org, '2100', 'Sales tax payable',            'liability', 'sales_tax_payable', true),
    (p_org, '2200', 'Payroll liabilities',          'liability', 'payroll_liabilities', true),
    (p_org, '2300', 'Customer credits',             'liability', 'customer_credits', true),
    (p_org, '3000', 'Owner''s equity',              'equity',    'owner_equity', true),
    (p_org, '3100', 'Owner draws / distributions',  'equity',    'owner_draws', true),
    (p_org, '3900', 'Retained earnings',            'equity',    'retained_earnings', true),
    (p_org, '4000', 'Sales',                        'revenue',   'sales', true),
    (p_org, '4100', 'Discounts and returns',        'revenue',   'sales_discounts', true),
    (p_org, '4900', 'Other income',                 'revenue',   'other_income', true),
    (p_org, '5000', 'Cost of goods sold',           'expense',   'cogs', true),
    (p_org, '5100', 'Inventory shrink and adjustments', 'expense', 'inventory_adjustments', true),
    (p_org, '6000', 'Payroll',                      'expense',   'payroll', true),
    (p_org, '6100', 'Rent',                         'expense',   'rent', true),
    (p_org, '6200', 'Utilities',                    'expense',   'utilities', true),
    (p_org, '6300', 'Card processing fees',         'expense',   'card_fees', true),
    (p_org, '6900', 'Other operating expenses',     'expense',   'other_operating', true),
    (p_org, '7000', 'Interest expense',             'expense',   'interest', true),
    (p_org, '7100', 'Other expenses',               'expense',   'other_expense', true),
    (p_org, '8000', 'Income taxes',                 'expense',   'income_taxes', true)
  on conflict do nothing
$$;

create or replace function private.on_org_created_seed_accounts()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.seed_default_accounts(new.id);
  return new;
end $$;
create trigger organizations_seed_accounts after insert on public.organizations
  for each row execute function private.on_org_created_seed_accounts();

-- Backfill organizations created before this migration.
select private.seed_default_accounts(id) from public.organizations;

-- -----------------------------------------------------------------------------
-- Posting
-- -----------------------------------------------------------------------------
create or replace function private.closed_through(p_org uuid)
returns date language sql stable security definer set search_path = '' as $$
  select max(closed_through) from public.accounting_periods where organization_id = p_org
$$;

-- Core posting routine (no caller checks — callers must authorize first).
create or replace function private.post_entry(
  p_org uuid, p_entry_date date, p_memo text, p_lines jsonb, p_idempotency_key text,
  p_source_type text, p_source_id text, p_location_id uuid, p_reverses uuid, p_system boolean
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_hash text := encode(sha256(convert_to(jsonb_build_object(
    'd', p_entry_date, 'm', p_memo, 'l', p_lines, 's', p_source_type, 'i', p_source_id, 'loc', p_location_id, 'r', p_reverses
  )::text, 'UTF8')), 'hex');
  v_existing public.journal_entries;
  v_id uuid;
  v_debits bigint;
  v_credits bigint;
  v_count int;
  v_bad int;
  v_closed date := private.closed_through(p_org);
begin
  -- Idempotency: same key + same payload returns the original entry; a different payload is an error.
  perform pg_advisory_xact_lock(hashtextextended('ledger:' || p_org::text || ':' || p_idempotency_key, 0));
  select * into v_existing from public.journal_entries where organization_id = p_org and idempotency_key = p_idempotency_key;
  if v_existing.id is not null then
    if v_existing.payload_hash <> v_hash then
      raise exception 'idempotency key reused with different entry data' using errcode = '23505';
    end if;
    return v_existing.id;
  end if;

  if p_entry_date is null then raise exception 'entry date is required' using errcode = '22023'; end if;
  if v_closed is not null and p_entry_date <= v_closed then
    raise exception 'the books are closed through %; post in an open period', v_closed using errcode = '42501';
  end if;
  if jsonb_typeof(p_lines) <> 'array' then raise exception 'lines must be an array' using errcode = '22023'; end if;

  select count(*),
         coalesce(sum((l ->> 'debit_cents')::bigint), 0),
         coalesce(sum((l ->> 'credit_cents')::bigint), 0)
    into v_count, v_debits, v_credits
    from jsonb_array_elements(p_lines) l;
  if v_count < 2 then raise exception 'an entry needs at least two lines' using errcode = '22023'; end if;
  if v_debits <> v_credits then
    raise exception 'entry does not balance: debits % vs credits %', v_debits, v_credits using errcode = '22023';
  end if;
  if v_debits = 0 then raise exception 'entry total cannot be zero' using errcode = '22023'; end if;

  select count(*) into v_bad from jsonb_array_elements(p_lines) l
   where not exists (select 1 from public.accounts a
                     where a.id = (l ->> 'account_id')::uuid and a.organization_id = p_org and a.is_active);
  if v_bad > 0 then raise exception 'every line must use an active account of this business' using errcode = '42501'; end if;

  insert into public.journal_entries (organization_id, entry_date, memo, source_type, source_id, location_id,
                                      idempotency_key, payload_hash, reverses_entry_id, posted_by, posted_by_system)
  values (p_org, p_entry_date, btrim(p_memo), p_source_type, p_source_id, p_location_id,
          p_idempotency_key, v_hash, p_reverses, auth.uid(), p_system)
  returning id into v_id;

  insert into public.journal_lines (organization_id, entry_id, account_id, debit_cents, credit_cents, memo)
  select p_org, v_id, (l ->> 'account_id')::uuid,
         coalesce((l ->> 'debit_cents')::bigint, 0), coalesce((l ->> 'credit_cents')::bigint, 0),
         nullif(btrim(l ->> 'memo'), '')
    from jsonb_array_elements(p_lines) l;

  insert into public.audit_logs (organization_id, actor_user_id, actor_type, action, target_type, target_id, metadata)
  values (p_org, auth.uid(), case when p_system then 'system' else 'user' end,
          case when p_reverses is null then 'ledger.entry_posted' else 'ledger.entry_reversed' end,
          'journal_entry', v_id::text,
          jsonb_build_object('total_cents', v_debits, 'source_type', p_source_type, 'source_id', p_source_id, 'reverses', p_reverses));
  return v_id;
end $$;

-- p_lines: [{"account_id": uuid, "debit_cents": int, "credit_cents": int, "memo": text}, ...]
create or replace function public.post_journal_entry(
  p_org uuid, p_entry_date date, p_memo text, p_lines jsonb, p_idempotency_key text,
  p_source_type text default 'manual', p_source_id text default null, p_location_id uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_user();
  if not private.has_permission(p_org, 'accounting.post') or not private.org_is_writable(p_org) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  return private.post_entry(p_org, p_entry_date, p_memo, p_lines, p_idempotency_key,
                            p_source_type, p_source_id, p_location_id, null, false);
end $$;

-- System postings from trusted server jobs (imports, POS sync). Service role only.
create or replace function public.system_post_journal_entry(
  p_org uuid, p_entry_date date, p_memo text, p_lines jsonb, p_idempotency_key text,
  p_source_type text, p_source_id text default null, p_location_id uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if not private.org_is_writable(p_org) then
    raise exception 'organization is not writable' using errcode = '42501';
  end if;
  return private.post_entry(p_org, p_entry_date, p_memo, p_lines, p_idempotency_key,
                            p_source_type, p_source_id, p_location_id, null, true);
end $$;

create or replace function public.reverse_journal_entry(p_entry uuid, p_reversal_date date, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_entry public.journal_entries;
  v_lines jsonb;
begin
  perform private.require_user();
  select * into v_entry from public.journal_entries where id = p_entry;
  if v_entry.id is null then raise exception 'entry not found' using errcode = 'P0002'; end if;
  if not private.has_permission(v_entry.organization_id, 'accounting.post') or not private.org_is_writable(v_entry.organization_id) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if v_entry.reverses_entry_id is not null then
    raise exception 'a reversing entry cannot itself be reversed; post a new entry' using errcode = '22023';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 3 then
    raise exception 'a reason is required' using errcode = '22023';
  end if;
  select jsonb_agg(jsonb_build_object('account_id', account_id, 'debit_cents', credit_cents,
                                      'credit_cents', debit_cents, 'memo', memo) order by id)
    into v_lines from public.journal_lines where entry_id = p_entry;
  return private.post_entry(v_entry.organization_id, p_reversal_date,
                            'Reversal: ' || left(btrim(p_reason), 480), v_lines,
                            'reversal:' || p_entry::text, 'reversal', p_entry::text,
                            v_entry.location_id, p_entry, false);
exception when unique_violation then
  if sqlerrm like '%journal_entries_reverses_uidx%' or sqlerrm like '%idempotency%' then
    raise exception 'this entry has already been reversed' using errcode = '23505';
  end if;
  raise;
end $$;

create or replace function public.close_books_through(p_org uuid, p_through date, p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_prev date;
begin
  perform private.require_user();
  if not private.has_permission(p_org, 'accounting.close') or not private.org_is_writable(p_org) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  v_prev := private.closed_through(p_org);
  if v_prev is not null and p_through <= v_prev then
    raise exception 'books are already closed through %', v_prev using errcode = '22023';
  end if;
  if p_through >= current_date then
    raise exception 'you can only close periods that have ended' using errcode = '22023';
  end if;
  insert into public.accounting_periods (organization_id, closed_through, closed_by, note)
  values (p_org, p_through, auth.uid(), p_note) returning id into v_id;
  perform private.log_audit(p_org, 'user', 'ledger.books_closed', 'accounting_period', v_id::text,
    jsonb_build_object('through', p_through));
  return v_id;
end $$;

-- Trial balance as of a date. Debit-normal balance = debits - credits.
create or replace function public.trial_balance(p_org uuid, p_as_of date)
returns table (account_id uuid, code text, name text, type public.account_type, debit_cents bigint, credit_cents bigint, balance_cents bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (private.has_permission(p_org, 'accounting.view') or private.has_support_access(p_org)) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  return query
  select a.id, a.code, a.name, a.type,
         coalesce(sum(l.debit_cents), 0)::bigint,
         coalesce(sum(l.credit_cents), 0)::bigint,
         (coalesce(sum(l.debit_cents), 0) - coalesce(sum(l.credit_cents), 0))::bigint
    from public.accounts a
    left join public.journal_lines l on l.account_id = a.id
    left join public.journal_entries e on e.id = l.entry_id
   where a.organization_id = p_org and (e.id is null or e.entry_date <= p_as_of)
   group by a.id, a.code, a.name, a.type
   order by a.code;
end $$;

-- -----------------------------------------------------------------------------
-- RLS + grants (read-only for clients; writes only via RPCs)
-- -----------------------------------------------------------------------------
alter table public.accounts enable row level security;
alter table public.accounting_periods enable row level security;
alter table public.journal_entries enable row level security;
alter table public.journal_lines enable row level security;

revoke all on public.accounts, public.accounting_periods, public.journal_entries, public.journal_lines from anon, authenticated;

grant select on public.accounts to authenticated;
grant insert (organization_id, code, name, type) on public.accounts to authenticated;
grant update (name, is_active) on public.accounts to authenticated;
create policy accounts_select on public.accounts for select to authenticated
  using (private.has_permission(organization_id, 'accounting.view') or private.has_support_access(organization_id));
create policy accounts_insert on public.accounts for insert to authenticated
  with check (private.has_permission(organization_id, 'accounting.post') and private.org_is_writable(organization_id));
create policy accounts_update on public.accounts for update to authenticated
  using (private.has_permission(organization_id, 'accounting.post') and private.org_is_writable(organization_id) and not is_system)
  with check (private.has_permission(organization_id, 'accounting.post'));

grant select on public.accounting_periods, public.journal_entries, public.journal_lines to authenticated;
create policy periods_select on public.accounting_periods for select to authenticated
  using (private.has_permission(organization_id, 'accounting.view') or private.has_support_access(organization_id));
create policy entries_select on public.journal_entries for select to authenticated
  using (private.has_permission(organization_id, 'accounting.view') or private.has_support_access(organization_id));
create policy lines_select on public.journal_lines for select to authenticated
  using (private.has_permission(organization_id, 'accounting.view') or private.has_support_access(organization_id));

grant all on public.accounts, public.accounting_periods, public.journal_entries, public.journal_lines to service_role;
grant all on all sequences in schema public to service_role;

revoke all on function
  public.post_journal_entry(uuid, date, text, jsonb, text, text, text, uuid),
  public.system_post_journal_entry(uuid, date, text, jsonb, text, text, text, uuid),
  public.reverse_journal_entry(uuid, date, text),
  public.close_books_through(uuid, date, text),
  public.trial_balance(uuid, date)
  from public, anon, authenticated;
grant execute on function
  public.post_journal_entry(uuid, date, text, jsonb, text, text, text, uuid),
  public.reverse_journal_entry(uuid, date, text),
  public.close_books_through(uuid, date, text),
  public.trial_balance(uuid, date)
  to authenticated;
grant execute on function
  public.system_post_journal_entry(uuid, date, text, jsonb, text, text, text, uuid),
  public.trial_balance(uuid, date)
  to service_role;
revoke all on function private.post_entry(uuid, date, text, jsonb, text, text, text, uuid, uuid, boolean),
  private.seed_default_accounts(uuid), private.closed_through(uuid) from public;

-- New private helpers must never be callable by API roles (functions default to PUBLIC execute).
revoke all on all functions in schema private from public, anon;
grant execute on function
  private.is_org_member(uuid), private.member_role(uuid), private.has_permission(uuid, text),
  private.is_platform_admin(public.platform_role[]), private.has_support_access(uuid),
  private.org_is_writable(uuid), private.shares_org_with(uuid), private.role_rank(public.member_role)
  to authenticated, service_role;
