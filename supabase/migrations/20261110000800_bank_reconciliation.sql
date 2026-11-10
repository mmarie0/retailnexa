-- =============================================================================
-- Phase 2.8 — Bank statement import and reconciliation
--
-- Statement lines are imported into bank_lines (signed cents: + money in,
-- − money out). Each line is then:
--   * matched to an existing journal entry that moved the Bank account by the
--     same amount in the same direction, or
--   * categorized: a new entry is posted (Bank ↔ chosen account), or
--   * ignored (with a reason).
-- Unmatching restores 'unmatched'; a categorized line's entry is reversed.
-- Re-importing the same statement is safe: lines are de-duplicated by
-- (date, amount, normalized description, occurrence within the file).
-- Reading needs bank.view; writing needs accounting.post.
-- =============================================================================

create type public.bank_line_status as enum ('unmatched', 'matched', 'categorized', 'ignored');

create table public.bank_import_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  filename text check (filename is null or char_length(filename) <= 200),
  inserted_count int not null default 0,
  duplicate_count int not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id, id)
);

create table public.bank_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  batch_id uuid not null,
  posted_on date not null,
  description text not null check (char_length(description) between 1 and 300),
  amount_cents bigint not null check (amount_cents <> 0),
  dedupe_key text not null,
  status public.bank_line_status not null default 'unmatched',
  journal_entry_id uuid,
  note text check (note is null or char_length(note) <= 300),
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, dedupe_key),
  unique (organization_id, id),
  check ((status in ('matched', 'categorized')) = (journal_entry_id is not null)),
  foreign key (organization_id, batch_id) references public.bank_import_batches (organization_id, id),
  foreign key (organization_id, journal_entry_id) references public.journal_entries (organization_id, id)
);
-- An entry can explain at most one statement line.
create unique index bank_lines_entry_uidx on public.bank_lines (journal_entry_id) where journal_entry_id is not null;
create index bank_lines_org_status_idx on public.bank_lines (organization_id, status, posted_on);

-- Amount/date/description never change after import; lines are never deleted (org deletion aside).
create or replace function private.guard_bank_line_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (new.organization_id, new.batch_id, new.posted_on, new.description, new.amount_cents, new.dedupe_key, new.created_at)
     is distinct from (old.organization_id, old.batch_id, old.posted_on, old.description, old.amount_cents, old.dedupe_key, old.created_at) then
    raise exception 'imported bank lines cannot be edited' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger bank_lines_guard before update on public.bank_lines
  for each row execute function private.guard_bank_line_update();
create trigger bank_lines_no_delete before delete on public.bank_lines
  for each row execute function private.forbid_ledger_mutation();

-- Net movement of the org's Bank account in an entry (debits − credits).
create or replace function private.entry_bank_movement(p_org uuid, p_entry uuid)
returns bigint language sql stable security definer set search_path = '' as $$
  select coalesce(sum(l.debit_cents - l.credit_cents), 0)::bigint
    from public.journal_lines l join public.accounts a on a.id = l.account_id
   where l.entry_id = p_entry and l.organization_id = p_org and a.role = 'bank'
$$;

-- -----------------------------------------------------------------------------
-- Import
-- -----------------------------------------------------------------------------
-- p_lines: [{"date": "YYYY-MM-DD", "description": text, "amount_cents": int (signed), "occurrence": int}, ...]
create or replace function public.import_bank_lines(p_org uuid, p_filename text, p_lines jsonb)
returns table (batch_id uuid, inserted int, duplicates int)
language plpgsql security definer set search_path = '' as $$
declare v_batch uuid; v_in int; v_total int;
begin
  perform private.require_user();
  if not private.has_permission(p_org, 'accounting.post') or not private.org_is_writable(p_org) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if jsonb_typeof(p_lines) <> 'array' then raise exception 'lines must be an array' using errcode = '22023'; end if;
  v_total := jsonb_array_length(p_lines);
  if v_total < 1 or v_total > 2000 then raise exception 'import 1 to 2000 lines at a time' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_array_elements(p_lines) l
              where (l ->> 'date') is null or coalesce((l ->> 'amount_cents')::bigint, 0) = 0
                 or char_length(btrim(coalesce(l ->> 'description', ''))) = 0) then
    raise exception 'every line needs a date, a description and a non-zero amount' using errcode = '22023';
  end if;

  insert into public.bank_import_batches (organization_id, filename, created_by)
  values (p_org, left(nullif(btrim(p_filename), ''), 200), auth.uid()) returning id into v_batch;

  with ins as (
    insert into public.bank_lines (organization_id, batch_id, posted_on, description, amount_cents, dedupe_key)
    select p_org, v_batch, (l ->> 'date')::date, left(btrim(l ->> 'description'), 300), (l ->> 'amount_cents')::bigint,
           concat_ws('|', l ->> 'date', l ->> 'amount_cents',
                     lower(regexp_replace(btrim(l ->> 'description'), '\s+', ' ', 'g')), coalesce(l ->> 'occurrence', '1'))
      from jsonb_array_elements(p_lines) l
    on conflict (organization_id, dedupe_key) do nothing
    returning 1
  )
  select count(*) into v_in from ins;

  update public.bank_import_batches set inserted_count = v_in, duplicate_count = v_total - v_in where id = v_batch;
  perform private.log_audit(p_org, 'user', 'bank.statement_imported', 'bank_import_batch', v_batch::text,
    jsonb_build_object('inserted', v_in, 'duplicates', v_total - v_in));
  return query select v_batch, v_in, v_total - v_in;
end $$;

-- -----------------------------------------------------------------------------
-- Matching suggestions: unmatched lines × unclaimed entries moving Bank by the
-- same signed amount within ±p_days days.
-- -----------------------------------------------------------------------------
create or replace function public.bank_match_candidates(p_org uuid, p_days int default 7)
returns table (line_id uuid, entry_id uuid, entry_date date, memo text, source_type text, day_diff int)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (private.has_permission(p_org, 'bank.view') or private.has_support_access(p_org)) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  return query
  with moves as (
    select e.id, e.entry_date, e.memo, e.source_type, sum(l.debit_cents - l.credit_cents)::bigint as net
      from public.journal_entries e
      join public.journal_lines l on l.entry_id = e.id
      join public.accounts a on a.id = l.account_id and a.role = 'bank'
     where e.organization_id = p_org
       and not exists (select 1 from public.bank_lines b where b.journal_entry_id = e.id)
       and not exists (select 1 from public.journal_entries r where r.reverses_entry_id = e.id)
       and e.reverses_entry_id is null
     group by e.id, e.entry_date, e.memo, e.source_type
  )
  select b.id, m.id, m.entry_date, m.memo, m.source_type, abs(m.entry_date - b.posted_on)
    from public.bank_lines b
    join moves m on m.net = b.amount_cents and abs(m.entry_date - b.posted_on) <= least(greatest(coalesce(p_days, 7), 0), 31)
   where b.organization_id = p_org and b.status = 'unmatched'
   order by b.posted_on, b.id, abs(m.entry_date - b.posted_on), m.entry_date;
end $$;

-- -----------------------------------------------------------------------------
-- Resolve / unresolve
-- -----------------------------------------------------------------------------
create or replace function private.lock_bank_line(p_line uuid)
returns public.bank_lines language plpgsql security definer set search_path = '' as $$
declare v public.bank_lines;
begin
  perform private.require_user();
  select * into v from public.bank_lines where id = p_line for update;
  if v.id is null then raise exception 'bank line not found' using errcode = 'P0002'; end if;
  if not private.has_permission(v.organization_id, 'accounting.post') or not private.org_is_writable(v.organization_id) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  return v;
end $$;

create or replace function public.match_bank_line(p_line uuid, p_entry uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.bank_lines;
begin
  v := private.lock_bank_line(p_line);
  if v.status <> 'unmatched' then raise exception 'this line is already resolved' using errcode = '22023'; end if;
  if not exists (select 1 from public.journal_entries where id = p_entry and organization_id = v.organization_id) then
    raise exception 'entry not found' using errcode = 'P0002';
  end if;
  if private.entry_bank_movement(v.organization_id, p_entry) <> v.amount_cents then
    raise exception 'that entry did not move the bank account by this amount' using errcode = '22023';
  end if;
  if exists (select 1 from public.journal_entries r where r.reverses_entry_id = p_entry)
     or exists (select 1 from public.journal_entries e where e.id = p_entry and e.reverses_entry_id is not null) then
    raise exception 'reversed entries cannot be matched' using errcode = '22023';
  end if;
  update public.bank_lines set status = 'matched', journal_entry_id = p_entry, resolved_by = auth.uid(), resolved_at = now()
   where id = p_line;
exception when unique_violation then
  raise exception 'that entry is already matched to another bank line' using errcode = '23505';
end $$;

-- Posts Bank ↔ p_account for the line: money in = Dr Bank / Cr account; money out = Dr account / Cr Bank.
create or replace function public.categorize_bank_line(p_line uuid, p_account uuid, p_memo text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v public.bank_lines; v_bank uuid; v_entry uuid; v_amt bigint; v_lines jsonb;
begin
  v := private.lock_bank_line(p_line);
  if v.status <> 'unmatched' then raise exception 'this line is already resolved' using errcode = '22023'; end if;
  v_bank := private.account_by_role(v.organization_id, 'bank');
  if p_account = v_bank or not exists (select 1 from public.accounts where id = p_account and organization_id = v.organization_id and is_active) then
    raise exception 'choose an active account of this business other than the bank' using errcode = '22023';
  end if;
  v_amt := abs(v.amount_cents);
  v_lines := case when v.amount_cents > 0
    then jsonb_build_array(jsonb_build_object('account_id', v_bank, 'debit_cents', v_amt),
                           jsonb_build_object('account_id', p_account, 'credit_cents', v_amt))
    else jsonb_build_array(jsonb_build_object('account_id', p_account, 'debit_cents', v_amt),
                           jsonb_build_object('account_id', v_bank, 'credit_cents', v_amt)) end;
  v_entry := private.post_entry(v.organization_id, v.posted_on, left(coalesce(nullif(btrim(p_memo), ''), v.description), 500), v_lines,
                                'bankline:' || v.id::text || ':' || (select count(*) from public.journal_entries
                                   where organization_id = v.organization_id and source_type = 'bank_line' and source_id = v.id::text),
                                'bank_line', v.id::text, null, null, false);
  update public.bank_lines set status = 'categorized', journal_entry_id = v_entry, note = left(nullif(btrim(p_memo), ''), 300),
         resolved_by = auth.uid(), resolved_at = now()
   where id = p_line;
  return v_entry;
end $$;

create or replace function public.ignore_bank_line(p_line uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.bank_lines;
begin
  v := private.lock_bank_line(p_line);
  if v.status <> 'unmatched' then raise exception 'this line is already resolved' using errcode = '22023'; end if;
  if p_reason is null or char_length(btrim(p_reason)) < 3 then raise exception 'a reason is required' using errcode = '22023'; end if;
  update public.bank_lines set status = 'ignored', note = left(btrim(p_reason), 300), resolved_by = auth.uid(), resolved_at = now()
   where id = p_line;
end $$;

create or replace function public.unmatch_bank_line(p_line uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.bank_lines; v_lines jsonb; v_rev_key text;
begin
  v := private.lock_bank_line(p_line);
  if v.status = 'unmatched' then raise exception 'this line is not resolved' using errcode = '22023'; end if;
  if v.status = 'categorized' then
    -- Reverse the entry this line created. A previous categorize→unmatch cycle on the same line
    -- used a different entry, so the reversal key stays unique per entry.
    v_rev_key := 'reversal:' || v.journal_entry_id::text;
    select jsonb_agg(jsonb_build_object('account_id', account_id, 'debit_cents', credit_cents, 'credit_cents', debit_cents, 'memo', memo) order by id)
      into v_lines from public.journal_lines where entry_id = v.journal_entry_id;
    perform set_config('retailnexa.unmatching_bank_line', p_line::text, true);
    perform private.post_entry(v.organization_id, v.posted_on, 'Reversal: bank line uncategorized', v_lines,
                               v_rev_key, 'reversal', v.journal_entry_id::text, null, v.journal_entry_id, false);
    perform set_config('retailnexa.unmatching_bank_line', '', true);
  end if;
  update public.bank_lines set status = 'unmatched', journal_entry_id = null, note = null, resolved_by = null, resolved_at = null
   where id = p_line;
end $$;

-- A categorized line's entry must be undone with unmatch_bank_line, not reversed directly.
create or replace function private.forbid_direct_bank_line_reversal()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.reverses_entry_id is not null
     and exists (select 1 from public.journal_entries e where e.id = new.reverses_entry_id and e.source_type = 'bank_line')
     and coalesce(current_setting('retailnexa.unmatching_bank_line', true), '') = '' then
    raise exception 'bank entries cannot be reversed directly; uncategorize the bank line instead' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger journal_entries_bank_line_reversal_guard before insert on public.journal_entries
  for each row execute function private.forbid_direct_bank_line_reversal();

-- A matched entry that gets reversed elsewhere would leave a stale match: block that too.
create or replace function private.forbid_reversing_matched_entry()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.reverses_entry_id is not null
     and exists (select 1 from public.bank_lines b where b.journal_entry_id = new.reverses_entry_id and b.status = 'matched') then
    raise exception 'this entry is matched to a bank statement line; unmatch it first' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger journal_entries_matched_reversal_guard before insert on public.journal_entries
  for each row execute function private.forbid_reversing_matched_entry();

-- -----------------------------------------------------------------------------
-- RLS + grants (read-only for clients)
-- -----------------------------------------------------------------------------
alter table public.bank_import_batches enable row level security;
alter table public.bank_lines enable row level security;
revoke all on public.bank_import_batches, public.bank_lines from anon, authenticated;
grant select on public.bank_import_batches, public.bank_lines to authenticated;
create policy bank_batches_select on public.bank_import_batches for select to authenticated
  using (private.has_permission(organization_id, 'bank.view') or private.has_support_access(organization_id));
create policy bank_lines_select on public.bank_lines for select to authenticated
  using (private.has_permission(organization_id, 'bank.view') or private.has_support_access(organization_id));
grant all on public.bank_import_batches, public.bank_lines to service_role;

revoke all on function
  public.import_bank_lines(uuid, text, jsonb), public.bank_match_candidates(uuid, int),
  public.match_bank_line(uuid, uuid), public.categorize_bank_line(uuid, uuid, text),
  public.ignore_bank_line(uuid, text), public.unmatch_bank_line(uuid)
  from public, anon, authenticated;
grant execute on function
  public.import_bank_lines(uuid, text, jsonb), public.bank_match_candidates(uuid, int),
  public.match_bank_line(uuid, uuid), public.categorize_bank_line(uuid, uuid, text),
  public.ignore_bank_line(uuid, text), public.unmatch_bank_line(uuid)
  to authenticated;

revoke all on all functions in schema private from public, anon;
grant execute on function
  private.is_org_member(uuid), private.member_role(uuid), private.has_permission(uuid, text),
  private.is_platform_admin(public.platform_role[]), private.has_support_access(uuid),
  private.org_is_writable(uuid), private.shares_org_with(uuid), private.role_rank(public.member_role)
  to authenticated, service_role;
