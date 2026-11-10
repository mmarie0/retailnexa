-- =============================================================================
-- Recurring bills (rent, utilities, card-terminal fees, …)
--
-- A template holds the vendor, store, lines and schedule. create_due_recurring_bills()
-- turns every period that is due (next_date ≤ the business's today, or a given
-- date) into a DRAFT bill — approval and payment work exactly as for any bill.
-- Idempotent: a template creates at most one bill per period (unique index), so
-- running it twice, from two browsers or from a cron job, never duplicates.
-- Location scoping and billing state apply as for bills.
-- =============================================================================

create type public.recurrence as enum ('weekly', 'monthly', 'quarterly', 'yearly');

create table public.recurring_bills (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  vendor_id uuid not null,
  location_id uuid,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  lines jsonb not null check (jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) between 1 and 50),
  frequency public.recurrence not null,
  -- For monthly/quarterly/yearly: day of the month (29–31 fall back to the month's last day).
  day_of_month int check (day_of_month between 1 and 31),
  next_date date not null,
  end_date date,
  due_days int not null default 0 check (due_days between 0 and 365),
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date is null or end_date >= next_date or not is_active),
  unique (organization_id, id),
  foreign key (organization_id, vendor_id) references public.vendors (organization_id, id),
  foreign key (organization_id, location_id) references public.locations (organization_id, id)
);
create index recurring_bills_org_next_idx on public.recurring_bills (organization_id, next_date) where is_active;
create index recurring_bills_vendor_idx on public.recurring_bills (organization_id, vendor_id);
create index recurring_bills_location_idx on public.recurring_bills (organization_id, location_id);
create index recurring_bills_created_by_idx on public.recurring_bills (created_by);
create trigger recurring_bills_updated_at before update on public.recurring_bills
  for each row execute function private.set_updated_at();
create trigger audit_recurring_bills after insert or update or delete on public.recurring_bills
  for each row execute function private.audit_row_change();

alter table public.bills add column recurring_bill_id uuid, add column recurring_period date;
alter table public.bills add constraint bills_recurring_fk
  foreign key (organization_id, recurring_bill_id) references public.recurring_bills (organization_id, id);
create unique index bills_recurring_period_uidx on public.bills (recurring_bill_id, recurring_period)
  where recurring_bill_id is not null and status <> 'void';
create index bills_recurring_fk_idx on public.bills (organization_id, recurring_bill_id);

-- Next occurrence after p_date.
create or replace function private.next_occurrence(p_date date, p_freq public.recurrence, p_day int)
returns date language plpgsql immutable set search_path = '' as $$
declare v_month date; v_months int;
begin
  if p_freq = 'weekly' then return p_date + 7; end if;
  v_months := case p_freq when 'monthly' then 1 when 'quarterly' then 3 else 12 end;
  v_month := (date_trunc('month', p_date) + make_interval(months => v_months))::date;
  return least(v_month + (coalesce(p_day, extract(day from p_date)::int) - 1),
               (v_month + interval '1 month' - interval '1 day')::date);
end $$;

-- ---------------------------------------------------------------------------
-- Templates (bills.create to manage; location-scoped)
-- ---------------------------------------------------------------------------
-- p_lines: [{"account_id": uuid, "amount_cents": int, "description": text}, ...]
create or replace function public.save_recurring_bill(
  p_org uuid, p_id uuid, p_vendor uuid, p_name text, p_lines jsonb, p_frequency public.recurrence,
  p_next_date date, p_day_of_month int default null, p_due_days int default 0,
  p_end_date date default null, p_location_id uuid default null, p_is_active boolean default true
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid := p_id; v_bad int;
begin
  perform private.require_user();
  if not private.has_permission(p_org, 'bills.create') or not private.org_is_writable(p_org) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if not exists (select 1 from public.vendors where id = p_vendor and organization_id = p_org and is_active) then
    raise exception 'vendor not found' using errcode = 'P0002';
  end if;
  if p_next_date is null then raise exception 'pick the first bill date' using errcode = '22023'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) not between 1 and 50 then
    raise exception 'a recurring bill needs 1 to 50 lines' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_lines) l where coalesce((l ->> 'amount_cents')::bigint, 0) <= 0) then
    raise exception 'every line amount must be positive' using errcode = '22023';
  end if;
  select count(*) into v_bad from jsonb_array_elements(p_lines) l
   where not exists (select 1 from public.accounts a where a.id = (l ->> 'account_id')::uuid and a.organization_id = p_org
                       and a.is_active and (a.type = 'expense' or a.role = 'inventory'));
  if v_bad > 0 then raise exception 'bill lines must use an active expense or inventory account of this business' using errcode = '22023'; end if;
  if not private.can_access_location(p_org, p_location_id) then
    raise exception 'permission denied: this record belongs to a store you don''t have access to' using errcode = '42501';
  end if;

  if v_id is null then
    insert into public.recurring_bills (organization_id, vendor_id, location_id, name, lines, frequency, day_of_month,
                                        next_date, end_date, due_days, is_active, created_by)
    values (p_org, p_vendor, p_location_id, btrim(p_name), p_lines, p_frequency,
            case when p_frequency = 'weekly' then null else coalesce(p_day_of_month, extract(day from p_next_date)::int) end,
            p_next_date, p_end_date, coalesce(p_due_days, 0), coalesce(p_is_active, true), auth.uid())
    returning id into v_id;
  else
    update public.recurring_bills
       set vendor_id = p_vendor, location_id = p_location_id, name = btrim(p_name), lines = p_lines, frequency = p_frequency,
           day_of_month = case when p_frequency = 'weekly' then null else coalesce(p_day_of_month, extract(day from p_next_date)::int) end,
           next_date = p_next_date, end_date = p_end_date, due_days = coalesce(p_due_days, 0), is_active = coalesce(p_is_active, true)
     where id = v_id and organization_id = p_org;
    if not found then raise exception 'recurring bill not found' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end $$;

-- Create a draft bill for every due period up to p_through (default: business-local today).
-- Returns the number of bills created. At most 60 periods per template per run (catch-up guard).
create or replace function public.create_due_recurring_bills(p_org uuid, p_through date default null)
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_through date := coalesce(p_through, private.org_today(p_org));
  r public.recurring_bills;
  v_period date;
  v_bill uuid;
  v_made int := 0;
  v_steps int;
begin
  perform private.require_user();
  if not private.has_permission(p_org, 'bills.create') or not private.org_is_writable(p_org) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if v_through > private.org_today(p_org) + 31 then
    raise exception 'can only create bills up to a month ahead' using errcode = '22023';
  end if;
  for r in select * from public.recurring_bills
            where organization_id = p_org and is_active and next_date <= v_through
              and private.can_access_location(p_org, location_id)
            order by next_date for update
  loop
    v_period := r.next_date; v_steps := 0;
    while v_period <= v_through and (r.end_date is null or v_period <= r.end_date) and v_steps < 60 loop
      if not exists (select 1 from public.bills where recurring_bill_id = r.id and recurring_period = v_period and status <> 'void') then
        v_bill := public.create_bill(p_org, r.vendor_id, left(r.name, 40) || ' ' || to_char(v_period, 'YYYY-MM-DD'),
                                     v_period, v_period + r.due_days, r.lines, 'Recurring: ' || r.name, r.location_id);
        update public.bills set recurring_bill_id = r.id, recurring_period = v_period where id = v_bill;
        v_made := v_made + 1;
      end if;
      v_period := private.next_occurrence(v_period, r.frequency, r.day_of_month);
      v_steps := v_steps + 1;
    end loop;
    update public.recurring_bills
       set next_date = v_period, is_active = case when r.end_date is not null and v_period > r.end_date then false else is_active end
     where id = r.id;
  end loop;
  return v_made;
end $$;

-- ---------------------------------------------------------------------------
-- Location scope + RLS
-- ---------------------------------------------------------------------------
create or replace function private.enforce_location_scope()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_loc uuid;
begin
  if tg_table_name in ('sales_days', 'bills', 'recurring_bills') then
    v_org := new.organization_id; v_loc := new.location_id;
    if tg_op = 'UPDATE' and not private.can_access_location(old.organization_id, old.location_id) then
      raise exception 'permission denied: this record belongs to a store you don''t have access to' using errcode = '42501';
    end if;
  elsif tg_table_name = 'bill_payments' then
    select b.organization_id, b.location_id into v_org, v_loc from public.bills b where b.id = new.bill_id;
  elsif tg_table_name = 'bill_payment_voids' then
    select b.organization_id, b.location_id into v_org, v_loc
      from public.bill_payments p join public.bills b on b.id = p.bill_id where p.id = new.payment_id;
  end if;
  if not private.can_access_location(v_org, v_loc) then
    raise exception 'permission denied: this record belongs to a store you don''t have access to' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger recurring_bills_location_scope before insert or update on public.recurring_bills
  for each row execute function private.enforce_location_scope();

alter table public.recurring_bills enable row level security;
revoke all on public.recurring_bills from anon, authenticated;
grant select on public.recurring_bills to authenticated;
grant all on public.recurring_bills to service_role;
create policy recurring_bills_select on public.recurring_bills for select to authenticated
  using ((private.has_permission(organization_id, 'bills.view') and private.can_access_location(organization_id, location_id))
         or private.has_support_access(organization_id));

revoke all on function
  public.save_recurring_bill(uuid, uuid, uuid, text, jsonb, public.recurrence, date, int, int, date, uuid, boolean),
  public.create_due_recurring_bills(uuid, date)
  from public, anon, authenticated;
grant execute on function
  public.save_recurring_bill(uuid, uuid, uuid, text, jsonb, public.recurrence, date, int, int, date, uuid, boolean),
  public.create_due_recurring_bills(uuid, date)
  to authenticated;

revoke all on all functions in schema private from public, anon;
grant execute on function
  private.is_org_member(uuid), private.member_role(uuid), private.has_permission(uuid, text),
  private.is_platform_admin(public.platform_role[]), private.has_support_access(uuid),
  private.org_is_writable(uuid), private.shares_org_with(uuid), private.role_rank(public.member_role),
  private.can_access_location(uuid, uuid)
  to authenticated, service_role;
