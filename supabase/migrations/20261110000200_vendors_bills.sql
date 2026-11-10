-- =============================================================================
-- Phase 2.2 — Vendors and bills (accounts payable)
--
-- Flow:  draft  --approve_bill-->  approved  --record_bill_payment (until settled)-->  paid
--        draft | approved (no payments)  --void_bill-->  void
--
-- Rules:
--   * Bills, bill lines and payments are written only through the RPCs below.
--   * Approving posts Dr <line accounts> / Cr Accounts payable to the ledger
--     (idempotency key "bill:<id>"), dated on the bill date.
--   * Payments post Dr Accounts payable / Cr Bank|Cash, can never exceed the
--     open balance, and are idempotent per caller-supplied key.
--   * Voiding an approved bill posts a reversing entry; bills with payments
--     cannot be voided.
--   * Amounts are bigint cents.
-- =============================================================================

create type public.bill_status as enum ('draft', 'approved', 'paid', 'void');
create type public.payment_source as enum ('bank', 'cash_on_hand');

-- -----------------------------------------------------------------------------
-- Vendors
-- -----------------------------------------------------------------------------
create table public.vendors (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  contact_name text check (contact_name is null or char_length(contact_name) <= 120),
  email text check (email is null or (char_length(email) <= 254 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  phone text check (phone is null or char_length(phone) <= 40),
  payment_terms_days int not null default 30 check (payment_terms_days between 0 and 365),
  default_account_id uuid,
  notes text check (notes is null or char_length(notes) <= 2000),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, default_account_id) references public.accounts (organization_id, id)
);
create unique index vendors_org_name_uidx on public.vendors (organization_id, lower(btrim(name)));
create trigger vendors_updated_at before update on public.vendors
  for each row execute function private.set_updated_at();
create trigger audit_vendors after insert or update or delete on public.vendors
  for each row execute function private.audit_row_change();

-- -----------------------------------------------------------------------------
-- Bills
-- -----------------------------------------------------------------------------
create table public.bills (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  vendor_id uuid not null,
  location_id uuid,
  bill_number text not null check (char_length(btrim(bill_number)) between 1 and 60),
  bill_date date not null,
  due_date date not null,
  memo text check (memo is null or char_length(memo) <= 500),
  status public.bill_status not null default 'draft',
  total_cents bigint not null check (total_cents > 0),
  paid_cents bigint not null default 0 check (paid_cents >= 0),
  journal_entry_id uuid,
  created_by uuid references auth.users(id) on delete set null,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  voided_by uuid references auth.users(id) on delete set null,
  voided_at timestamptz,
  void_reason text check (void_reason is null or char_length(void_reason) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (due_date >= bill_date),
  check (paid_cents <= total_cents),
  check ((status = 'paid') = (paid_cents = total_cents)),
  unique (organization_id, id),
  foreign key (organization_id, vendor_id) references public.vendors (organization_id, id),
  foreign key (organization_id, location_id) references public.locations (organization_id, id),
  foreign key (organization_id, journal_entry_id) references public.journal_entries (organization_id, id)
);
-- The same vendor invoice number cannot be entered twice (duplicate-bill guard); voided bills don't count.
create unique index bills_vendor_number_uidx on public.bills (organization_id, vendor_id, lower(btrim(bill_number)))
  where status <> 'void';
create index bills_org_status_due_idx on public.bills (organization_id, status, due_date);
create trigger bills_updated_at before update on public.bills
  for each row execute function private.set_updated_at();

create table public.bill_lines (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  bill_id uuid not null,
  account_id uuid not null,
  description text check (description is null or char_length(description) <= 300),
  amount_cents bigint not null check (amount_cents > 0),
  foreign key (organization_id, bill_id) references public.bills (organization_id, id) on delete cascade,
  foreign key (organization_id, account_id) references public.accounts (organization_id, id)
);
create index bill_lines_bill_idx on public.bill_lines (bill_id);

create table public.bill_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  bill_id uuid not null,
  paid_on date not null,
  amount_cents bigint not null check (amount_cents > 0),
  source public.payment_source not null,
  reference text check (reference is null or char_length(reference) <= 100),
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 200),
  journal_entry_id uuid not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id, idempotency_key),
  foreign key (organization_id, bill_id) references public.bills (organization_id, id) on delete cascade,
  foreign key (organization_id, journal_entry_id) references public.journal_entries (organization_id, id)
);
create index bill_payments_bill_idx on public.bill_payments (bill_id);

-- Bill lines and payments are insert-only (org deletion still cascades).
create trigger bill_lines_immutable before update or delete on public.bill_lines
  for each row execute function private.forbid_ledger_mutation();
create trigger bill_payments_immutable before update or delete on public.bill_payments
  for each row execute function private.forbid_ledger_mutation();

-- -----------------------------------------------------------------------------
-- RPCs
-- -----------------------------------------------------------------------------
create or replace function private.account_by_role(p_org uuid, p_role text)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v uuid;
begin
  select id into v from public.accounts where organization_id = p_org and role = p_role and is_active;
  if v is null then raise exception 'account for % is missing or inactive', p_role using errcode = '22023'; end if;
  return v;
end $$;

-- p_lines: [{"account_id": uuid, "amount_cents": int, "description": text}, ...]
create or replace function public.create_bill(
  p_org uuid, p_vendor uuid, p_bill_number text, p_bill_date date, p_due_date date,
  p_lines jsonb, p_memo text default null, p_location_id uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_total bigint;
  v_count int;
  v_bad int;
  v_due date;
begin
  perform private.require_user();
  if not private.has_permission(p_org, 'bills.create') or not private.org_is_writable(p_org) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if not exists (select 1 from public.vendors where id = p_vendor and organization_id = p_org and is_active) then
    raise exception 'vendor not found' using errcode = 'P0002';
  end if;
  if p_bill_date is null then raise exception 'bill date is required' using errcode = '22023'; end if;
  if p_location_id is not null and not exists (select 1 from public.locations where id = p_location_id and organization_id = p_org) then
    raise exception 'location not found' using errcode = 'P0002';
  end if;
  if jsonb_typeof(p_lines) <> 'array' then raise exception 'lines must be an array' using errcode = '22023'; end if;

  select count(*), coalesce(sum((l ->> 'amount_cents')::bigint), 0)
    into v_count, v_total from jsonb_array_elements(p_lines) l;
  if v_count < 1 or v_count > 100 then raise exception 'a bill needs 1 to 100 lines' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_array_elements(p_lines) l where coalesce((l ->> 'amount_cents')::bigint, 0) <= 0) then
    raise exception 'every line amount must be positive' using errcode = '22023';
  end if;

  -- Lines may only hit this org's active expense accounts or the inventory account.
  select count(*) into v_bad from jsonb_array_elements(p_lines) l
   where not exists (select 1 from public.accounts a
                     where a.id = (l ->> 'account_id')::uuid and a.organization_id = p_org and a.is_active
                       and (a.type = 'expense' or a.role = 'inventory'));
  if v_bad > 0 then
    raise exception 'bill lines must use an active expense or inventory account of this business' using errcode = '22023';
  end if;

  v_due := coalesce(p_due_date, p_bill_date + (select payment_terms_days from public.vendors where id = p_vendor));

  insert into public.bills (organization_id, vendor_id, location_id, bill_number, bill_date, due_date, memo, total_cents, created_by)
  values (p_org, p_vendor, p_location_id, btrim(p_bill_number), p_bill_date, v_due, nullif(btrim(p_memo), ''), v_total, auth.uid())
  returning id into v_id;

  insert into public.bill_lines (organization_id, bill_id, account_id, description, amount_cents)
  select p_org, v_id, (l ->> 'account_id')::uuid, nullif(btrim(l ->> 'description'), ''), (l ->> 'amount_cents')::bigint
    from jsonb_array_elements(p_lines) l;

  perform private.log_audit(p_org, 'user', 'bill.created', 'bill', v_id::text,
    jsonb_build_object('vendor_id', p_vendor, 'total_cents', v_total));
  return v_id;
exception when unique_violation then
  if sqlerrm like '%bills_vendor_number_uidx%' then
    raise exception 'a bill with this number already exists for this vendor' using errcode = '23505';
  end if;
  raise;
end $$;

create or replace function public.approve_bill(p_bill uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_bill public.bills;
  v_lines jsonb;
  v_entry uuid;
  v_vendor text;
begin
  perform private.require_user();
  select * into v_bill from public.bills where id = p_bill for update;
  if v_bill.id is null then raise exception 'bill not found' using errcode = 'P0002'; end if;
  if not private.has_permission(v_bill.organization_id, 'bills.approve') or not private.org_is_writable(v_bill.organization_id) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if v_bill.status <> 'draft' then raise exception 'only draft bills can be approved' using errcode = '22023'; end if;

  select name into v_vendor from public.vendors where id = v_bill.vendor_id;
  select jsonb_agg(jsonb_build_object('account_id', account_id, 'debit_cents', amount_cents, 'memo', description) order by id)
           || jsonb_build_array(jsonb_build_object(
                'account_id', private.account_by_role(v_bill.organization_id, 'accounts_payable'),
                'credit_cents', v_bill.total_cents, 'memo', v_vendor))
    into v_lines from public.bill_lines where bill_id = p_bill;

  v_entry := private.post_entry(v_bill.organization_id, v_bill.bill_date,
                                left('Bill ' || v_bill.bill_number || ' — ' || v_vendor, 500), v_lines,
                                'bill:' || p_bill::text, 'bill', p_bill::text, v_bill.location_id, null, false);

  update public.bills set status = 'approved', approved_by = auth.uid(), approved_at = now(), journal_entry_id = v_entry
   where id = p_bill;
  perform private.log_audit(v_bill.organization_id, 'user', 'bill.approved', 'bill', p_bill::text,
    jsonb_build_object('journal_entry_id', v_entry, 'total_cents', v_bill.total_cents));
  return v_entry;
end $$;

create or replace function public.record_bill_payment(
  p_bill uuid, p_paid_on date, p_amount_cents bigint, p_source public.payment_source,
  p_idempotency_key text, p_reference text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_bill public.bills;
  v_existing public.bill_payments;
  v_entry uuid;
  v_id uuid;
  v_vendor text;
begin
  perform private.require_user();
  select * into v_bill from public.bills where id = p_bill for update;
  if v_bill.id is null then raise exception 'bill not found' using errcode = 'P0002'; end if;
  if not private.has_permission(v_bill.organization_id, 'bills.pay') or not private.org_is_writable(v_bill.organization_id) then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  -- Idempotent retry: same key returns the original payment if it matches.
  select * into v_existing from public.bill_payments
   where organization_id = v_bill.organization_id and idempotency_key = p_idempotency_key;
  if v_existing.id is not null then
    if v_existing.bill_id <> p_bill or v_existing.amount_cents <> p_amount_cents
       or v_existing.paid_on <> p_paid_on or v_existing.source <> p_source then
      raise exception 'idempotency key reused with different payment data' using errcode = '23505';
    end if;
    return v_existing.id;
  end if;

  if v_bill.status <> 'approved' then
    raise exception 'only approved, unpaid bills can be paid' using errcode = '22023';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'payment amount must be positive' using errcode = '22023';
  end if;
  if p_amount_cents > v_bill.total_cents - v_bill.paid_cents then
    raise exception 'payment exceeds the open balance of % cents', v_bill.total_cents - v_bill.paid_cents using errcode = '22023';
  end if;
  if p_paid_on is null or p_paid_on < v_bill.bill_date then
    raise exception 'payment date cannot be before the bill date' using errcode = '22023';
  end if;

  select name into v_vendor from public.vendors where id = v_bill.vendor_id;
  v_entry := private.post_entry(v_bill.organization_id, p_paid_on,
    left('Payment — bill ' || v_bill.bill_number || ' — ' || v_vendor, 500),
    jsonb_build_array(
      jsonb_build_object('account_id', private.account_by_role(v_bill.organization_id, 'accounts_payable'), 'debit_cents', p_amount_cents),
      jsonb_build_object('account_id', private.account_by_role(v_bill.organization_id, p_source::text), 'credit_cents', p_amount_cents)),
    'billpay:' || p_idempotency_key, 'bill_payment', p_bill::text, v_bill.location_id, null, false);

  insert into public.bill_payments (organization_id, bill_id, paid_on, amount_cents, source, reference, idempotency_key, journal_entry_id, created_by)
  values (v_bill.organization_id, p_bill, p_paid_on, p_amount_cents, p_source, nullif(btrim(p_reference), ''), p_idempotency_key, v_entry, auth.uid())
  returning id into v_id;

  update public.bills
     set paid_cents = paid_cents + p_amount_cents,
         status = case when paid_cents + p_amount_cents = total_cents then 'paid'::public.bill_status else status end
   where id = p_bill;

  perform private.log_audit(v_bill.organization_id, 'user', 'bill.payment_recorded', 'bill', p_bill::text,
    jsonb_build_object('payment_id', v_id, 'amount_cents', p_amount_cents, 'journal_entry_id', v_entry));
  return v_id;
end $$;

create or replace function public.void_bill(p_bill uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_bill public.bills;
  v_lines jsonb;
begin
  perform private.require_user();
  select * into v_bill from public.bills where id = p_bill for update;
  if v_bill.id is null then raise exception 'bill not found' using errcode = 'P0002'; end if;
  if not private.has_permission(v_bill.organization_id, 'bills.approve') or not private.org_is_writable(v_bill.organization_id) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 3 then
    raise exception 'a reason is required' using errcode = '22023';
  end if;
  if v_bill.status = 'void' then raise exception 'bill is already void' using errcode = '22023'; end if;
  if v_bill.paid_cents > 0 then
    raise exception 'bills with payments cannot be voided' using errcode = '22023';
  end if;

  if v_bill.journal_entry_id is not null
     and not exists (select 1 from public.journal_entries where reverses_entry_id = v_bill.journal_entry_id) then
    select jsonb_agg(jsonb_build_object('account_id', account_id, 'debit_cents', credit_cents,
                                        'credit_cents', debit_cents, 'memo', memo) order by id)
      into v_lines from public.journal_lines where entry_id = v_bill.journal_entry_id;
    perform set_config('retailnexa.voiding_bill', p_bill::text, true);
    perform private.post_entry(v_bill.organization_id, greatest(v_bill.bill_date, current_date),
                               left('Reversal: ' || btrim(p_reason), 500), v_lines,
                               'reversal:' || v_bill.journal_entry_id::text, 'reversal', v_bill.journal_entry_id::text,
                               v_bill.location_id, v_bill.journal_entry_id, false);
  end if;

  perform set_config('retailnexa.voiding_bill', '', true);
  update public.bills set status = 'void', voided_by = auth.uid(), voided_at = now(), void_reason = left(btrim(p_reason), 500)
   where id = p_bill;
  perform private.log_audit(v_bill.organization_id, 'user', 'bill.voided', 'bill', p_bill::text,
    jsonb_build_object('reason', left(btrim(p_reason), 500), 'was', v_bill.status));
end $$;

-- Accounts a bill line may use, for people who can enter or view bills but not the books.
create or replace function public.bill_account_options(p_org uuid)
returns table (id uuid, code text, name text, type public.account_type)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (private.has_permission(p_org, 'bills.view') or private.has_permission(p_org, 'bills.create')
          or private.has_support_access(p_org)) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  return query
  select a.id, a.code, a.name, a.type from public.accounts a
   where a.organization_id = p_org and (a.type = 'expense' or a.role = 'inventory')
   order by a.code;
end $$;

-- Bill and bill-payment entries must be undone through void_bill, never reversed
-- directly (that would leave the bill's status out of step with the ledger).
create or replace function private.forbid_direct_bill_reversal()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.reverses_entry_id is not null and new.source_type = 'reversal'
     and exists (select 1 from public.journal_entries e
                  where e.id = new.reverses_entry_id and e.source_type in ('bill', 'bill_payment'))
     and not exists (select 1 from public.bills b
                      where b.journal_entry_id = new.reverses_entry_id and b.status = 'approved'
                        and b.paid_cents = 0 and current_setting('retailnexa.voiding_bill', true) = b.id::text) then
    raise exception 'bill entries cannot be reversed directly; void the bill instead' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger journal_entries_bill_reversal_guard before insert on public.journal_entries
  for each row execute function private.forbid_direct_bill_reversal();

-- -----------------------------------------------------------------------------
-- RLS + grants
-- -----------------------------------------------------------------------------
alter table public.vendors enable row level security;
alter table public.bills enable row level security;
alter table public.bill_lines enable row level security;
alter table public.bill_payments enable row level security;

revoke all on public.vendors, public.bills, public.bill_lines, public.bill_payments from anon, authenticated;

grant select on public.vendors to authenticated;
grant insert (organization_id, name, contact_name, email, phone, payment_terms_days, default_account_id, notes)
  on public.vendors to authenticated;
grant update (name, contact_name, email, phone, payment_terms_days, default_account_id, notes, is_active)
  on public.vendors to authenticated;
create policy vendors_select on public.vendors for select to authenticated
  using (private.has_permission(organization_id, 'vendors.view') or private.has_support_access(organization_id));
create policy vendors_insert on public.vendors for insert to authenticated
  with check (private.has_permission(organization_id, 'vendors.manage') and private.org_is_writable(organization_id));
create policy vendors_update on public.vendors for update to authenticated
  using (private.has_permission(organization_id, 'vendors.manage') and private.org_is_writable(organization_id))
  with check (private.has_permission(organization_id, 'vendors.manage'));

-- Bills are read-only to clients; all writes go through the RPCs above.
grant select on public.bills, public.bill_lines, public.bill_payments to authenticated;
create policy bills_select on public.bills for select to authenticated
  using (private.has_permission(organization_id, 'bills.view') or private.has_support_access(organization_id));
create policy bill_lines_select on public.bill_lines for select to authenticated
  using (private.has_permission(organization_id, 'bills.view') or private.has_support_access(organization_id));
create policy bill_payments_select on public.bill_payments for select to authenticated
  using (private.has_permission(organization_id, 'bills.view') or private.has_support_access(organization_id));

grant all on public.vendors, public.bills, public.bill_lines, public.bill_payments to service_role;
grant all on all sequences in schema public to service_role;

revoke all on function
  public.create_bill(uuid, uuid, text, date, date, jsonb, text, uuid),
  public.approve_bill(uuid),
  public.record_bill_payment(uuid, date, bigint, public.payment_source, text, text),
  public.void_bill(uuid, text),
  public.bill_account_options(uuid)
  from public, anon, authenticated;
grant execute on function
  public.create_bill(uuid, uuid, text, date, date, jsonb, text, uuid),
  public.approve_bill(uuid),
  public.record_bill_payment(uuid, date, bigint, public.payment_source, text, text),
  public.void_bill(uuid, text),
  public.bill_account_options(uuid)
  to authenticated;

-- New private helpers must never be callable by API roles.
revoke all on all functions in schema private from public, anon;
grant execute on function
  private.is_org_member(uuid), private.member_role(uuid), private.has_permission(uuid, text),
  private.is_platform_admin(public.platform_role[]), private.has_support_access(uuid),
  private.org_is_writable(uuid), private.shares_org_with(uuid), private.role_rank(public.member_role)
  to authenticated, service_role;
