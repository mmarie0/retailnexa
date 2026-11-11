-- =============================================================================
-- Parity batch D (part 2), #110 Vendor statements: enter or import a vendor's
-- statement, match each line to a bill, and flag lines with no bill.
-- Statements list every invoice a vendor sent, whichever store it was for, so
-- they're read by members with bills.view who see every store. Entered and
-- changed with bills.create. No money moves: bills for missing lines are
-- created with the existing create_bill (normal approval applies).
-- =============================================================================
create table public.vendor_statements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  vendor_id uuid not null,
  statement_date date not null,
  note text check (note is null or char_length(note) <= 300),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, vendor_id) references public.vendors (organization_id, id) on delete cascade
);
create index vendor_statements_vendor_idx on public.vendor_statements (organization_id, vendor_id);
create index vendor_statements_created_by_idx on public.vendor_statements (created_by);

create table public.vendor_statement_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  statement_id uuid not null,
  line_date date,
  reference text check (reference is null or char_length(reference) <= 100),
  description text check (description is null or char_length(description) <= 200),
  -- Negative = a credit or payment on the statement.
  amount_cents bigint not null check (amount_cents <> 0 and abs(amount_cents) <= 100000000000),
  bill_id uuid references public.bills(id) on delete set null,
  dismissed boolean not null default false,
  foreign key (organization_id, statement_id) references public.vendor_statements (organization_id, id) on delete cascade
);
create index vendor_statement_lines_stmt_idx on public.vendor_statement_lines (organization_id, statement_id);
create index vendor_statement_lines_bill_idx on public.vendor_statement_lines (bill_id);

create trigger audit_vendor_statements after insert or update or delete on public.vendor_statements for each row execute function private.audit_row_change();

alter table public.vendor_statements enable row level security;
alter table public.vendor_statement_lines enable row level security;
revoke all on public.vendor_statements, public.vendor_statement_lines from anon, authenticated;
grant select on public.vendor_statements, public.vendor_statement_lines to authenticated;
grant all on public.vendor_statements, public.vendor_statement_lines to service_role;

create or replace function private.can_see_statements(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (private.has_permission(p_org, 'bills.view') and private.can_access_location(p_org, null)) or private.has_support_access(p_org)
$$;
revoke all on function private.can_see_statements(uuid) from public, anon;
grant execute on function private.can_see_statements(uuid) to authenticated;
create policy vendor_statements_select on public.vendor_statements for select to authenticated using (private.can_see_statements(organization_id));
create policy vendor_statement_lines_select on public.vendor_statement_lines for select to authenticated using (private.can_see_statements(organization_id));

create or replace function private.statement_guard(p_org uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_user();
  if not (private.has_permission(p_org, 'bills.create') and private.can_access_location(p_org, null)) or not private.org_is_writable(p_org) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
end $$;
revoke all on function private.statement_guard(uuid) from public, anon, authenticated;

-- p_lines: [{line_date, reference, description, amount_cents}], 1 to 500.
create or replace function public.create_vendor_statement(p_org uuid, p_vendor uuid, p_date date, p_lines jsonb, p_note text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform private.statement_guard(p_org);
  if not exists (select 1 from public.vendors where id = p_vendor and organization_id = p_org) then raise exception 'pick a vendor' using errcode = '22023'; end if;
  if p_date is null or p_date < '2000-01-01' or p_date > private.org_today(p_org) + 31 then raise exception 'enter the statement date' using errcode = '22023'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) not between 1 and 500 then raise exception 'a statement needs 1 to 500 lines' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_array_elements(p_lines) l
              where (l ->> 'amount_cents') is null or (l ->> 'amount_cents')::bigint = 0 or abs((l ->> 'amount_cents')::bigint) > 100000000000
                 or char_length(coalesce(l ->> 'reference', '')) > 100 or char_length(coalesce(l ->> 'description', '')) > 200
                 or (nullif(l ->> 'line_date', '')::date is not null and (nullif(l ->> 'line_date', '')::date < '2000-01-01' or nullif(l ->> 'line_date', '')::date > private.org_today(p_org) + 31))) then
    raise exception 'each line needs an amount (not zero) and a real date' using errcode = '22023';
  end if;
  insert into public.vendor_statements (organization_id, vendor_id, statement_date, note, created_by)
  values (p_org, p_vendor, p_date, nullif(btrim(p_note), ''), auth.uid()) returning id into v_id;
  insert into public.vendor_statement_lines (organization_id, statement_id, line_date, reference, description, amount_cents)
  select p_org, v_id, nullif(l ->> 'line_date', '')::date, nullif(btrim(l ->> 'reference'), ''), nullif(btrim(l ->> 'description'), ''), (l ->> 'amount_cents')::bigint
    from jsonb_array_elements(p_lines) l;
  return v_id;
end $$;

-- Link a line to a bill of the same vendor (or clear it), or set it aside.
create or replace function public.set_statement_line(p_org uuid, p_line uuid, p_bill uuid, p_dismissed boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_vendor uuid;
begin
  perform private.statement_guard(p_org);
  select s.vendor_id into v_vendor from public.vendor_statement_lines l join public.vendor_statements s on s.id = l.statement_id
   where l.id = p_line and l.organization_id = p_org;
  if not found then raise exception 'that line was not found' using errcode = '22023'; end if;
  if p_bill is not null and not exists (select 1 from public.bills b where b.id = p_bill and b.organization_id = p_org and b.vendor_id = v_vendor) then
    raise exception 'pick a bill from the same vendor' using errcode = '22023';
  end if;
  update public.vendor_statement_lines set bill_id = p_bill, dismissed = coalesce(p_dismissed, false) where id = p_line;
end $$;

create or replace function public.delete_vendor_statement(p_org uuid, p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.statement_guard(p_org);
  delete from public.vendor_statements where id = p_id and organization_id = p_org;
  if not found then raise exception 'that statement was not found' using errcode = '22023'; end if;
end $$;

revoke all on function public.create_vendor_statement(uuid, uuid, date, jsonb, text), public.set_statement_line(uuid, uuid, uuid, boolean),
  public.delete_vendor_statement(uuid, uuid) from public, anon;
grant execute on function public.create_vendor_statement(uuid, uuid, date, jsonb, text), public.set_statement_line(uuid, uuid, uuid, boolean),
  public.delete_vendor_statement(uuid, uuid) to authenticated;
