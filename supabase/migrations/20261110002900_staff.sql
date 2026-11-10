-- =============================================================================
-- Batch B (#102): Staff — employees, weekly schedule, payroll (pay runs and
-- advances), paystubs and labor %, copied from the owner's RetailNexa app.
--
-- Access:
--   employees  (names, roles, store, regular weekly schedule)
--              read: employees.view, schedule.view or payroll.view + store access
--              write: save_employee (employees.manage)
--   employee_pay (pay type, rate, employer taxes %, tax type, paid by)
--              read: payroll.view;  write: save_employee with payroll.manage
--   shifts     read: schedule.view (or payroll.view);  write: set_week_shifts,
--              copy_week (schedule.manage)
--   staff_settings  payroll rules + labor target; read: any staff permission;
--              write: save_staff_settings (payroll.manage)
--   pay_runs / pay_run_lines / employee_advances
--              read: payroll.view;  write: create_pay_run, void_pay_run,
--              add_advance (payroll.manage)
-- Pay runs are payroll RECORDS: they are not posted to the books in this batch.
-- Money is integer cents; hours are numeric(6,2).
-- =============================================================================

create table public.staff_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  paid_lunch boolean not null default true,
  overtime boolean not null default false,
  overtime_after_hours numeric(5,2) not null default 40 check (overtime_after_hours between 1 and 168),
  overtime_multiplier numeric(4,2) not null default 1.5 check (overtime_multiplier between 1 and 3),
  pay_week_start smallint not null default 0 check (pay_week_start between 0 and 6),
  pay_every_weeks smallint not null default 1 check (pay_every_weeks in (1, 2)),
  labor_target_pct numeric(5,2) not null default 12 check (labor_target_pct between 0 and 100),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
create index staff_settings_updated_by_idx on public.staff_settings (updated_by);

create table public.employees (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  location_id uuid,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  role_title text check (role_title is null or char_length(role_title) <= 60),
  start_date date,
  end_date date,
  is_active boolean not null default true,
  -- 7 entries, Sunday first: {"in":"09:00","out":"17:00","lunch":30} or null for a day off.
  regular jsonb check (regular is null or (jsonb_typeof(regular) = 'array' and jsonb_array_length(regular) = 7)),
  notes text check (notes is null or char_length(notes) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date is null or start_date is null or end_date >= start_date),
  unique (organization_id, id),
  foreign key (organization_id, location_id) references public.locations (organization_id, id)
);
create index employees_org_idx on public.employees (organization_id, is_active);
create index employees_location_idx on public.employees (organization_id, location_id);

create table public.employee_pay (
  employee_id uuid primary key,
  organization_id uuid not null,
  pay_type text not null default 'hourly' check (pay_type in ('hourly', 'salary')),
  -- hourly: cents per hour; salary: cents per year
  rate_cents bigint not null default 0 check (rate_cents between 0 and 100000000),
  weekly_hours numeric(5,2) check (weekly_hours is null or weekly_hours between 0 and 168),
  burden_pct numeric(5,2) not null default 10 check (burden_pct between 0 and 100),
  tax_type text check (tax_type is null or tax_type in ('w2', '1099')),
  pay_method text check (pay_method is null or pay_method in ('cash', 'check', 'ach')),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, employee_id) references public.employees (organization_id, id) on delete cascade
);
create index employee_pay_org_idx on public.employee_pay (organization_id, employee_id);

create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  employee_id uuid not null,
  work_date date not null,
  -- off = a scheduled day off that overrides the regular schedule
  off boolean not null default false,
  start_time time,
  end_time time,
  lunch_min int not null default 0 check (lunch_min between 0 and 240),
  actual_in time,
  actual_out time,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  check (off or (start_time is not null and end_time is not null)),
  unique (employee_id, work_date),
  foreign key (organization_id, employee_id) references public.employees (organization_id, id) on delete cascade
);
create index shifts_org_date_idx on public.shifts (organization_id, work_date);
create index shifts_org_employee_idx on public.shifts (organization_id, employee_id);
create index shifts_updated_by_idx on public.shifts (updated_by);

create table public.pay_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  pay_date date not null,
  period_start date not null,
  period_end date not null,
  note text check (note is null or char_length(note) <= 300),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references auth.users(id) on delete set null,
  check (period_end >= period_start and period_end - period_start <= 31),
  unique (organization_id, id)
);
create index pay_runs_org_date_idx on public.pay_runs (organization_id, pay_date desc);
create index pay_runs_created_by_idx on public.pay_runs (created_by);
create index pay_runs_voided_by_idx on public.pay_runs (voided_by);

create table public.pay_run_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  run_id uuid not null,
  employee_id uuid not null,
  pay_type text not null check (pay_type in ('hourly', 'salary')),
  hours numeric(6,2) not null default 0 check (hours between 0 and 400),
  overtime_hours numeric(6,2) not null default 0 check (overtime_hours between 0 and 400),
  rate_cents bigint not null check (rate_cents >= 0),
  regular_cents bigint not null check (regular_cents >= 0),
  overtime_cents bigint not null default 0 check (overtime_cents >= 0),
  bonus_cents bigint not null default 0 check (bonus_cents >= 0),
  gross_cents bigint not null check (gross_cents >= 0),
  advance_cents bigint not null default 0 check (advance_cents >= 0),
  net_cents bigint not null,
  employer_tax_cents bigint not null default 0 check (employer_tax_cents >= 0),
  pay_method text check (pay_method is null or pay_method in ('cash', 'check', 'ach')),
  check (gross_cents = regular_cents + overtime_cents + bonus_cents),
  check (net_cents = gross_cents - advance_cents and net_cents >= 0),
  unique (run_id, employee_id),
  foreign key (organization_id, run_id) references public.pay_runs (organization_id, id) on delete cascade,
  foreign key (organization_id, employee_id) references public.employees (organization_id, id)
);
create index pay_run_lines_org_idx on public.pay_run_lines (organization_id, run_id);
create index pay_run_lines_employee_idx on public.pay_run_lines (organization_id, employee_id);

create table public.employee_advances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  employee_id uuid not null,
  advance_date date not null,
  amount_cents bigint not null check (amount_cents between 1 and 10000000),
  note text check (note is null or char_length(note) <= 200),
  repaid_run_id uuid,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (organization_id, employee_id) references public.employees (organization_id, id) on delete cascade,
  foreign key (organization_id, repaid_run_id) references public.pay_runs (organization_id, id)
);
create index employee_advances_org_idx on public.employee_advances (organization_id, employee_id);
create index employee_advances_run_idx on public.employee_advances (organization_id, repaid_run_id);
create index employee_advances_created_by_idx on public.employee_advances (created_by);

create trigger employees_updated_at before update on public.employees for each row execute function private.set_updated_at();
create trigger employee_pay_updated_at before update on public.employee_pay for each row execute function private.set_updated_at();
create trigger shifts_updated_at before update on public.shifts for each row execute function private.set_updated_at();
create trigger staff_settings_updated_at before update on public.staff_settings for each row execute function private.set_updated_at();
create trigger audit_employees after insert or update or delete on public.employees for each row execute function private.audit_row_change();
create trigger audit_employee_pay after insert or update or delete on public.employee_pay for each row execute function private.audit_row_change();
create trigger audit_staff_settings after insert or update or delete on public.staff_settings for each row execute function private.audit_row_change();
create trigger audit_pay_runs after insert or update or delete on public.pay_runs for each row execute function private.audit_row_change();
create trigger audit_employee_advances after insert or update or delete on public.employee_advances for each row execute function private.audit_row_change();

-- RLS ---------------------------------------------------------------------------
alter table public.staff_settings enable row level security;
alter table public.employees enable row level security;
alter table public.employee_pay enable row level security;
alter table public.shifts enable row level security;
alter table public.pay_runs enable row level security;
alter table public.pay_run_lines enable row level security;
alter table public.employee_advances enable row level security;
revoke all on public.staff_settings, public.employees, public.employee_pay, public.shifts,
  public.pay_runs, public.pay_run_lines, public.employee_advances from anon, authenticated;
grant select on public.staff_settings, public.employees, public.employee_pay, public.shifts,
  public.pay_runs, public.pay_run_lines, public.employee_advances to authenticated;
grant all on public.staff_settings, public.employees, public.employee_pay, public.shifts,
  public.pay_runs, public.pay_run_lines, public.employee_advances to service_role;

create or replace function private.staff_any(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.has_permission(p_org, 'employees.view') or private.has_permission(p_org, 'schedule.view')
      or private.has_permission(p_org, 'payroll.view')
$$;

create policy staff_settings_select on public.staff_settings for select to authenticated
  using (private.staff_any(organization_id) or private.has_support_access(organization_id));
create policy employees_select on public.employees for select to authenticated
  using ((private.staff_any(organization_id) and private.can_access_location(organization_id, location_id))
         or private.has_support_access(organization_id));
create policy employee_pay_select on public.employee_pay for select to authenticated
  using ((private.has_permission(organization_id, 'payroll.view')
          and exists (select 1 from public.employees e where e.id = employee_id and private.can_access_location(e.organization_id, e.location_id)))
         or private.has_support_access(organization_id));
create policy shifts_select on public.shifts for select to authenticated
  using (((private.has_permission(organization_id, 'schedule.view') or private.has_permission(organization_id, 'payroll.view'))
          and exists (select 1 from public.employees e where e.id = employee_id and private.can_access_location(e.organization_id, e.location_id)))
         or private.has_support_access(organization_id));
create policy pay_runs_select on public.pay_runs for select to authenticated
  using (private.has_permission(organization_id, 'payroll.view') or private.has_support_access(organization_id));
create policy pay_run_lines_select on public.pay_run_lines for select to authenticated
  using ((private.has_permission(organization_id, 'payroll.view')
          and exists (select 1 from public.employees e where e.id = employee_id and private.can_access_location(e.organization_id, e.location_id)))
         or private.has_support_access(organization_id));
create policy employee_advances_select on public.employee_advances for select to authenticated
  using ((private.has_permission(organization_id, 'payroll.view')
          and exists (select 1 from public.employees e where e.id = employee_id and private.can_access_location(e.organization_id, e.location_id)))
         or private.has_support_access(organization_id));

-- RPCs --------------------------------------------------------------------------
create or replace function private.staff_guard(p_org uuid, p_perm text)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_user();
  if not private.has_permission(p_org, p_perm) or not private.org_is_writable(p_org) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
end $$;

-- A regular schedule: 7 entries of null or {"in":"HH:MM","out":"HH:MM","lunch":minutes}.
create or replace function private.valid_week(p jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select p is null or (jsonb_typeof(p) = 'array' and jsonb_array_length(p) = 7 and not exists (
    select 1 from jsonb_array_elements(p) d
     where jsonb_typeof(d) <> 'null' and (
       jsonb_typeof(d) <> 'object'
       or coalesce(d ->> 'in', '') !~ '^([01]\d|2[0-3]):[0-5]\d$'
       or coalesce(d ->> 'out', '') !~ '^([01]\d|2[0-3]):[0-5]\d$'
       or coalesce(d ->> 'lunch', '0') !~ '^\d{1,3}$' or coalesce((d ->> 'lunch')::int, 0) > 240)))
$$;

-- Create (p_id null) or update an employee. Pay fields are saved only when the
-- caller has payroll.manage; otherwise they are left unchanged.
create or replace function public.save_employee(
  p_org uuid, p_id uuid, p_name text, p_role_title text default null, p_location uuid default null,
  p_start date default null, p_end date default null, p_active boolean default true, p_regular jsonb default null, p_notes text default null,
  p_pay jsonb default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid := p_id; v_loc uuid;
begin
  perform private.staff_guard(p_org, 'employees.manage');
  if nullif(btrim(p_name), '') is null then raise exception 'enter a name' using errcode = '22023'; end if;
  if not private.valid_week(p_regular) then raise exception 'each day needs a start and end time like 09:00' using errcode = '22023'; end if;
  if p_location is not null and not exists (select 1 from public.locations l where l.id = p_location and l.organization_id = p_org) then
    raise exception 'store not found' using errcode = 'P0002';
  end if;
  v_loc := private.default_location(p_org, p_location);
  if not private.can_access_location(p_org, v_loc) then
    raise exception 'permission denied: this record belongs to a store you don''t have access to' using errcode = '42501';
  end if;
  if (p_start is not null and (not isfinite(p_start) or p_start < '1950-01-01' or p_start > '2100-12-31'))
     or (p_end is not null and (not isfinite(p_end) or p_end < '1950-01-01' or p_end > '2100-12-31')) then
    raise exception 'dates are out of range' using errcode = '22023';
  end if;
  if v_id is null then
    insert into public.employees (organization_id, location_id, name, role_title, start_date, end_date, is_active, regular, notes)
    values (p_org, v_loc, btrim(p_name), nullif(btrim(p_role_title), ''), p_start, p_end, coalesce(p_active, true), p_regular, nullif(btrim(p_notes), ''))
    returning id into v_id;
  else
    if not exists (select 1 from public.employees e where e.id = v_id and e.organization_id = p_org and private.can_access_location(p_org, e.location_id)) then
      raise exception 'employee not found' using errcode = 'P0002';
    end if;
    update public.employees set location_id = v_loc, name = btrim(p_name), role_title = nullif(btrim(p_role_title), ''),
           start_date = p_start, end_date = p_end, is_active = coalesce(p_active, true), regular = p_regular, notes = nullif(btrim(p_notes), '')
     where id = v_id;
  end if;
  if p_pay is not null and private.has_permission(p_org, 'payroll.manage') then
    if coalesce(p_pay ->> 'pay_type', 'hourly') not in ('hourly', 'salary') then raise exception 'pay type must be hourly or salary' using errcode = '22023'; end if;
    insert into public.employee_pay (employee_id, organization_id, pay_type, rate_cents, weekly_hours, burden_pct, tax_type, pay_method)
    values (v_id, p_org, coalesce(p_pay ->> 'pay_type', 'hourly'), coalesce((p_pay ->> 'rate_cents')::bigint, 0),
            (p_pay ->> 'weekly_hours')::numeric, coalesce((p_pay ->> 'burden_pct')::numeric, 10),
            nullif(p_pay ->> 'tax_type', ''), nullif(p_pay ->> 'pay_method', ''))
    on conflict (employee_id) do update set pay_type = excluded.pay_type, rate_cents = excluded.rate_cents, weekly_hours = excluded.weekly_hours,
      burden_pct = excluded.burden_pct, tax_type = excluded.tax_type, pay_method = excluded.pay_method;
  end if;
  return v_id;
end $$;

-- Replace one employee's shifts for the week starting p_week (7 days). p_days: 7
-- entries of null (follow the regular schedule), {"off":true}, or
-- {"in","out","lunch","act_in","act_out"}.
create or replace function public.set_week_shifts(p_org uuid, p_employee uuid, p_week date, p_days jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare d jsonb; i int := 0; t text := '^([01]\d|2[0-3]):[0-5]\d$';
begin
  perform private.staff_guard(p_org, 'schedule.manage');
  if not exists (select 1 from public.employees e where e.id = p_employee and e.organization_id = p_org and private.can_access_location(p_org, e.location_id)) then
    raise exception 'employee not found' using errcode = 'P0002';
  end if;
  if p_week is null or not isfinite(p_week) or p_week < '2000-01-01' or p_week > '2100-12-31' then raise exception 'pick a week' using errcode = '22023'; end if;
  if jsonb_typeof(p_days) <> 'array' or jsonb_array_length(p_days) <> 7 then raise exception 'send 7 days' using errcode = '22023'; end if;
  delete from public.shifts where employee_id = p_employee and work_date between p_week and p_week + 6;
  for d in select * from jsonb_array_elements(p_days) loop
    if jsonb_typeof(d) = 'object' then
      if coalesce((d ->> 'off')::boolean, false) then
        insert into public.shifts (organization_id, employee_id, work_date, off, updated_by) values (p_org, p_employee, p_week + i, true, auth.uid());
      else
        if coalesce(d ->> 'in', '') !~ t or coalesce(d ->> 'out', '') !~ t
           or (d ->> 'act_in' is not null and d ->> 'act_in' !~ t) or (d ->> 'act_out' is not null and d ->> 'act_out' !~ t)
           or coalesce(d ->> 'lunch', '0') !~ '^\d{1,3}$' or coalesce((d ->> 'lunch')::int, 0) > 240 then
          raise exception 'day %: times look like 09:00 and lunch is minutes', i + 1 using errcode = '22023';
        end if;
        insert into public.shifts (organization_id, employee_id, work_date, start_time, end_time, lunch_min, actual_in, actual_out, updated_by)
        values (p_org, p_employee, p_week + i, (d ->> 'in')::time, (d ->> 'out')::time, coalesce((d ->> 'lunch')::int, 0),
                (d ->> 'act_in')::time, (d ->> 'act_out')::time, auth.uid());
      end if;
    end if;
    i := i + 1;
  end loop;
end $$;

-- Copy every visible employee's shifts from the week before p_week into p_week
-- (replacing p_week's). Returns the number of shifts copied.
create or replace function public.copy_week(p_org uuid, p_week date)
returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  perform private.staff_guard(p_org, 'schedule.manage');
  if p_week is null or not isfinite(p_week) or p_week < '2000-01-08' or p_week > '2100-12-31' then raise exception 'pick a week' using errcode = '22023'; end if;
  delete from public.shifts s using public.employees e
   where s.employee_id = e.id and e.organization_id = p_org and private.can_access_location(p_org, e.location_id)
     and s.work_date between p_week and p_week + 6;
  insert into public.shifts (organization_id, employee_id, work_date, off, start_time, end_time, lunch_min, updated_by)
  select p_org, s.employee_id, s.work_date + 7, s.off, s.start_time, s.end_time, s.lunch_min, auth.uid()
    from public.shifts s join public.employees e on e.id = s.employee_id
   where e.organization_id = p_org and private.can_access_location(p_org, e.location_id)
     and s.work_date between p_week - 7 and p_week - 1;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.save_staff_settings(
  p_org uuid, p_paid_lunch boolean, p_overtime boolean, p_overtime_after numeric, p_overtime_multiplier numeric,
  p_pay_week_start int, p_pay_every_weeks int, p_labor_target numeric
) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.staff_guard(p_org, 'payroll.manage');
  insert into public.staff_settings (organization_id, paid_lunch, overtime, overtime_after_hours, overtime_multiplier,
                                     pay_week_start, pay_every_weeks, labor_target_pct, updated_by)
  values (p_org, coalesce(p_paid_lunch, true), coalesce(p_overtime, false), coalesce(p_overtime_after, 40), coalesce(p_overtime_multiplier, 1.5),
          coalesce(p_pay_week_start, 0), coalesce(p_pay_every_weeks, 1), coalesce(p_labor_target, 12), auth.uid())
  on conflict (organization_id) do update set paid_lunch = excluded.paid_lunch, overtime = excluded.overtime,
    overtime_after_hours = excluded.overtime_after_hours, overtime_multiplier = excluded.overtime_multiplier,
    pay_week_start = excluded.pay_week_start, pay_every_weeks = excluded.pay_every_weeks,
    labor_target_pct = excluded.labor_target_pct, updated_by = excluded.updated_by;
end $$;

create or replace function public.add_advance(p_org uuid, p_employee uuid, p_date date, p_amount_cents bigint, p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  perform private.staff_guard(p_org, 'payroll.manage');
  if not exists (select 1 from public.employees e where e.id = p_employee and e.organization_id = p_org and private.can_access_location(p_org, e.location_id)) then
    raise exception 'employee not found' using errcode = 'P0002';
  end if;
  if p_date is null or not isfinite(p_date) or p_date < '2000-01-01' or p_date > private.org_today(p_org) + 31 then raise exception 'pick a date' using errcode = '22023'; end if;
  if p_amount_cents is null or p_amount_cents < 1 or p_amount_cents > 10000000 then raise exception 'enter an amount like 100.00' using errcode = '22023'; end if;
  insert into public.employee_advances (organization_id, employee_id, advance_date, amount_cents, note, created_by)
  values (p_org, p_employee, p_date, p_amount_cents, left(nullif(btrim(p_note), ''), 200), auth.uid()) returning id into v;
  return v;
end $$;

-- Record a pay run. p_lines: [{employee_id, pay_type, hours, overtime_hours, rate_cents, regular_cents,
-- overtime_cents, bonus_cents, employer_tax_cents, pay_method, advance_ids: [uuid]}]. The database
-- recomputes gross, the advance deduction (sum of the listed open advances) and net.
create or replace function public.create_pay_run(
  p_org uuid, p_pay_date date, p_period_start date, p_period_end date, p_lines jsonb, p_note text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_run uuid; l jsonb; v_adv bigint; v_ids uuid[]; v_gross bigint; v_n int;
begin
  perform private.staff_guard(p_org, 'payroll.manage');
  if p_pay_date is null or not isfinite(p_pay_date) or p_pay_date < '2000-01-01' or p_pay_date > private.org_today(p_org) + 31 then
    raise exception 'pick the pay date' using errcode = '22023';
  end if;
  if p_period_start is null or p_period_end is null or not isfinite(p_period_start) or not isfinite(p_period_end)
     or p_period_end < p_period_start or p_period_end - p_period_start > 31 or p_period_start < '2000-01-01' then
    raise exception 'pick a pay period of up to a month' using errcode = '22023';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) not between 1 and 500 then
    raise exception 'add at least one employee' using errcode = '22023';
  end if;
  insert into public.pay_runs (organization_id, pay_date, period_start, period_end, note, created_by)
  values (p_org, p_pay_date, p_period_start, p_period_end, left(nullif(btrim(p_note), ''), 300), auth.uid()) returning id into v_run;
  for l in select * from jsonb_array_elements(p_lines) loop
    if not exists (select 1 from public.employees e where e.id = (l ->> 'employee_id')::uuid and e.organization_id = p_org
                     and private.can_access_location(p_org, e.location_id)) then
      raise exception 'employee not found' using errcode = 'P0002';
    end if;
    select coalesce(array_agg(x::uuid), '{}') into v_ids from jsonb_array_elements_text(coalesce(l -> 'advance_ids', '[]'::jsonb)) x;
    select coalesce(sum(a.amount_cents), 0), count(*) into v_adv, v_n from public.employee_advances a
     where a.id = any(v_ids) and a.organization_id = p_org and a.employee_id = (l ->> 'employee_id')::uuid and a.repaid_run_id is null;
    if v_n <> coalesce(array_length(v_ids, 1), 0) then raise exception 'an advance was already repaid or isn''t this employee''s' using errcode = '22023'; end if;
    v_gross := coalesce((l ->> 'regular_cents')::bigint, 0) + coalesce((l ->> 'overtime_cents')::bigint, 0) + coalesce((l ->> 'bonus_cents')::bigint, 0);
    if v_adv > v_gross then raise exception 'advances to take back are more than the pay' using errcode = '22023'; end if;
    insert into public.pay_run_lines (organization_id, run_id, employee_id, pay_type, hours, overtime_hours, rate_cents, regular_cents,
                                      overtime_cents, bonus_cents, gross_cents, advance_cents, net_cents, employer_tax_cents, pay_method)
    values (p_org, v_run, (l ->> 'employee_id')::uuid, coalesce(l ->> 'pay_type', 'hourly'), coalesce((l ->> 'hours')::numeric, 0),
            coalesce((l ->> 'overtime_hours')::numeric, 0), coalesce((l ->> 'rate_cents')::bigint, 0), coalesce((l ->> 'regular_cents')::bigint, 0),
            coalesce((l ->> 'overtime_cents')::bigint, 0), coalesce((l ->> 'bonus_cents')::bigint, 0), v_gross, v_adv, v_gross - v_adv,
            coalesce((l ->> 'employer_tax_cents')::bigint, 0), nullif(l ->> 'pay_method', ''));
    update public.employee_advances set repaid_run_id = v_run where id = any(v_ids);
  end loop;
  return v_run;
end $$;

-- Void a pay run (kept for the record); its advances are open again.
create or replace function public.void_pay_run(p_run uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.pay_runs;
begin
  select * into r from public.pay_runs where id = p_run;
  if r.id is null then raise exception 'pay run not found' using errcode = 'P0002'; end if;
  perform private.staff_guard(r.organization_id, 'payroll.manage');
  if r.voided_at is not null then return; end if;
  update public.pay_runs set voided_at = now(), voided_by = auth.uid() where id = p_run;
  update public.employee_advances set repaid_run_id = null where repaid_run_id = p_run;
end $$;

revoke all on function private.staff_any(uuid), private.staff_guard(uuid, text), private.valid_week(jsonb) from public, anon;
grant execute on function private.staff_any(uuid) to authenticated;
revoke all on function
  public.save_employee(uuid, uuid, text, text, uuid, date, date, boolean, jsonb, text, jsonb),
  public.set_week_shifts(uuid, uuid, date, jsonb), public.copy_week(uuid, date),
  public.save_staff_settings(uuid, boolean, boolean, numeric, numeric, int, int, numeric),
  public.add_advance(uuid, uuid, date, bigint, text),
  public.create_pay_run(uuid, date, date, date, jsonb, text), public.void_pay_run(uuid)
  from public, anon;
grant execute on function
  public.save_employee(uuid, uuid, text, text, uuid, date, date, boolean, jsonb, text, jsonb),
  public.set_week_shifts(uuid, uuid, date, jsonb), public.copy_week(uuid, date),
  public.save_staff_settings(uuid, boolean, boolean, numeric, numeric, int, int, numeric),
  public.add_advance(uuid, uuid, date, bigint, text),
  public.create_pay_run(uuid, date, date, date, jsonb, text), public.void_pay_run(uuid)
  to authenticated;
