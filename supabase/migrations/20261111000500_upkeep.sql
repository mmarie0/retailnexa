-- =============================================================================
-- Parity batch E, #115 Upkeep: a maintenance schedule (recurring jobs with how
-- often they're due), a log of when each was done and what it cost, and
-- suggested starter tasks. Read with maintenance.view (store-scoped when a task
-- belongs to one store); tasks added/changed with tasks.manage; marked done with
-- maintenance.complete. Costs here are records only, not bills.
-- =============================================================================
create table public.maintenance_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  location_id uuid,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  area text check (area is null or char_length(area) <= 40),
  every_n int not null check (every_n between 1 and 120),
  every_unit text not null check (every_unit in ('days', 'weeks', 'months', 'years')),
  -- When it was last done before tracking started (the log takes over after).
  last_done date,
  vendor text check (vendor is null or char_length(vendor) <= 80),
  notes text check (notes is null or char_length(notes) <= 500),
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, location_id) references public.locations (organization_id, id)
);
create index maintenance_tasks_org_loc_idx on public.maintenance_tasks (organization_id, location_id);
create index maintenance_tasks_created_by_idx on public.maintenance_tasks (created_by);

create table public.maintenance_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  task_id uuid not null,
  done_on date not null,
  cost_cents bigint not null default 0 check (cost_cents between 0 and 1000000000),
  note text check (note is null or char_length(note) <= 300),
  done_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (organization_id, task_id) references public.maintenance_tasks (organization_id, id) on delete cascade
);
create index maintenance_log_task_idx on public.maintenance_log (organization_id, task_id, done_on);
create index maintenance_log_done_by_idx on public.maintenance_log (done_by);

create trigger maintenance_tasks_updated_at before update on public.maintenance_tasks for each row execute function private.set_updated_at();
create trigger audit_maintenance_tasks after insert or update or delete on public.maintenance_tasks for each row execute function private.audit_row_change();
create trigger audit_maintenance_log after insert or update or delete on public.maintenance_log for each row execute function private.audit_row_change();

-- Readable: maintenance.view (or tasks.view), and the task's store when it has one.
create or replace function private.can_see_task(p_org uuid, p_location uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select ((private.has_permission(p_org, 'maintenance.view') or private.has_permission(p_org, 'tasks.view'))
          and (p_location is null or private.can_access_location(p_org, p_location)))
         or private.has_support_access(p_org)
$$;
revoke all on function private.can_see_task(uuid, uuid) from public, anon;
grant execute on function private.can_see_task(uuid, uuid) to authenticated;

alter table public.maintenance_tasks enable row level security;
alter table public.maintenance_log enable row level security;
revoke all on public.maintenance_tasks, public.maintenance_log from anon, authenticated;
grant select on public.maintenance_tasks, public.maintenance_log to authenticated;
grant all on public.maintenance_tasks, public.maintenance_log to service_role;
create policy maintenance_tasks_select on public.maintenance_tasks for select to authenticated
  using (private.can_see_task(organization_id, location_id));
create policy maintenance_log_select on public.maintenance_log for select to authenticated
  using (exists (select 1 from public.maintenance_tasks t where t.id = maintenance_log.task_id and t.organization_id = maintenance_log.organization_id
                   and private.can_see_task(t.organization_id, t.location_id)));

create or replace function private.task_guard(p_org uuid, p_location uuid, p_perm text)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_user();
  if not private.has_permission(p_org, p_perm) or not private.org_is_writable(p_org) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if p_location is not null and not exists (select 1 from public.locations l where l.id = p_location and l.organization_id = p_org) then
    raise exception 'pick one of your stores' using errcode = '22023';
  end if;
  if not private.can_access_location(p_org, p_location) then
    raise exception 'permission denied: that is a store you don''t have access to' using errcode = '42501';
  end if;
end $$;
revoke all on function private.task_guard(uuid, uuid, text) from public, anon, authenticated;

-- Add (p_id null) or change a task. p: name, area, every_n, every_unit, last_done, vendor, notes, location_id, active.
create or replace function public.save_maintenance_task(p_org uuid, p_id uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_loc uuid := private.default_location(p_org, nullif(p ->> 'location_id', '')::uuid); v_id uuid; v_old uuid;
begin
  perform private.task_guard(p_org, v_loc, 'tasks.manage');
  if nullif(btrim(p ->> 'name'), '') is null or char_length(btrim(p ->> 'name')) > 80 then raise exception 'name the task' using errcode = '22023'; end if;
  if (p ->> 'every_n') is null or (p ->> 'every_n')::int not between 1 and 120 or coalesce(p ->> 'every_unit', '') not in ('days', 'weeks', 'months', 'years') then
    raise exception 'say how often: every 1 to 120 days, weeks, months or years' using errcode = '22023';
  end if;
  if nullif(p ->> 'last_done', '')::date > private.org_today(p_org) then raise exception 'last done can''t be in the future' using errcode = '22023'; end if;
  if p_id is null then
    insert into public.maintenance_tasks (organization_id, location_id, name, area, every_n, every_unit, last_done, vendor, notes, is_active, created_by)
    values (p_org, v_loc, btrim(p ->> 'name'), nullif(btrim(left(p ->> 'area', 40)), ''), (p ->> 'every_n')::int, p ->> 'every_unit',
            nullif(p ->> 'last_done', '')::date, nullif(btrim(left(p ->> 'vendor', 80)), ''), nullif(btrim(left(p ->> 'notes', 500)), ''),
            coalesce((p ->> 'active')::boolean, true), auth.uid())
    returning id into v_id;
    return v_id;
  end if;
  select location_id into v_old from public.maintenance_tasks where id = p_id and organization_id = p_org for update;
  if not found then raise exception 'that task was not found' using errcode = '22023'; end if;
  perform private.task_guard(p_org, v_old, 'tasks.manage');
  update public.maintenance_tasks set location_id = v_loc, name = btrim(p ->> 'name'), area = nullif(btrim(left(p ->> 'area', 40)), ''),
         every_n = (p ->> 'every_n')::int, every_unit = p ->> 'every_unit', last_done = nullif(p ->> 'last_done', '')::date,
         vendor = nullif(btrim(left(p ->> 'vendor', 80)), ''), notes = nullif(btrim(left(p ->> 'notes', 500)), ''), is_active = coalesce((p ->> 'active')::boolean, true)
   where id = p_id;
  return p_id;
end $$;

create or replace function public.delete_maintenance_task(p_org uuid, p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_loc uuid;
begin
  select location_id into v_loc from public.maintenance_tasks where id = p_id and organization_id = p_org for update;
  if not found then raise exception 'that task was not found' using errcode = '22023'; end if;
  perform private.task_guard(p_org, v_loc, 'tasks.manage');
  delete from public.maintenance_tasks where id = p_id;
end $$;

-- Mark a task done (today or an earlier date), with what it cost.
create or replace function public.log_maintenance(p_org uuid, p_task uuid, p_done_on date, p_cost_cents bigint, p_note text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_loc uuid; v_id uuid;
begin
  select location_id into v_loc from public.maintenance_tasks where id = p_task and organization_id = p_org;
  if not found then raise exception 'that task was not found' using errcode = '22023'; end if;
  perform private.task_guard(p_org, v_loc, 'maintenance.complete');
  if p_done_on is null or p_done_on < '2000-01-01' or p_done_on > private.org_today(p_org) then raise exception 'pick the day it was done, not in the future' using errcode = '22023'; end if;
  if coalesce(p_cost_cents, 0) < 0 or coalesce(p_cost_cents, 0) > 1000000000 then raise exception 'the cost must be 0 to 10,000,000 dollars' using errcode = '22023'; end if;
  insert into public.maintenance_log (organization_id, task_id, done_on, cost_cents, note, done_by)
  values (p_org, p_task, p_done_on, coalesce(p_cost_cents, 0), nullif(btrim(left(p_note, 300)), ''), auth.uid()) returning id into v_id;
  return v_id;
end $$;

create or replace function public.delete_maintenance_log(p_org uuid, p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_loc uuid;
begin
  select t.location_id into v_loc from public.maintenance_log l join public.maintenance_tasks t on t.id = l.task_id where l.id = p_id and l.organization_id = p_org;
  if not found then raise exception 'that entry was not found' using errcode = '22023'; end if;
  perform private.task_guard(p_org, v_loc, 'tasks.manage');
  delete from public.maintenance_log where id = p_id;
end $$;

revoke all on function public.save_maintenance_task(uuid, uuid, jsonb), public.delete_maintenance_task(uuid, uuid),
  public.log_maintenance(uuid, uuid, date, bigint, text), public.delete_maintenance_log(uuid, uuid) from public, anon;
grant execute on function public.save_maintenance_task(uuid, uuid, jsonb), public.delete_maintenance_task(uuid, uuid),
  public.log_maintenance(uuid, uuid, date, bigint, text), public.delete_maintenance_log(uuid, uuid) to authenticated;
