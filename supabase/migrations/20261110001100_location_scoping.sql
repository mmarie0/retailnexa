-- =============================================================================
-- #27 Store restrictions (member_locations) on location-scoped records
--
-- Rule (also in docs/SECURITY_RULES.md):
--   * Owners, admins, and members with NO member_locations rows: every location.
--   * Restricted members: only rows whose location_id is in their set.
--     Org-wide rows (location_id is null, e.g. a bill for the whole business)
--     are NOT visible to restricted members.
--   * Platform support access keeps its existing read path.
--   * Trusted server code (no auth.uid(): service role, migrations) is unaffected.
-- Reads: RLS policies. Writes: BEFORE triggers, so every SECURITY DEFINER RPC
-- that inserts or updates these tables is covered without duplicating checks.
-- =============================================================================

create or replace function private.can_access_location(p_org uuid, p_location uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  with me as (
    select m.id, m.role from public.memberships m
     where m.organization_id = p_org and m.user_id = (select auth.uid()) and m.status = 'active'
  )
  select case
    when (select auth.uid()) is null then true
    when not exists (select 1 from me) then false
    when (select role from me) in ('owner', 'admin') then true
    when not exists (select 1 from public.member_locations ml where ml.membership_id = (select id from me)) then true
    when p_location is null then false
    else exists (select 1 from public.member_locations ml where ml.membership_id = (select id from me) and ml.location_id = p_location)
  end
$$;

-- ---------------------------------------------------------------------------
-- Reads
-- ---------------------------------------------------------------------------
drop policy sales_days_select on public.sales_days;
create policy sales_days_select on public.sales_days for select to authenticated
  using ((private.has_permission(organization_id, 'sales.view') and private.can_access_location(organization_id, location_id))
         or private.has_support_access(organization_id));

drop policy sales_day_categories_select on public.sales_day_categories;
create policy sales_day_categories_select on public.sales_day_categories for select to authenticated
  using (exists (select 1 from public.sales_days d where d.id = sales_day_id
                  and ((private.has_permission(d.organization_id, 'sales.view') and private.can_access_location(d.organization_id, d.location_id))
                       or private.has_support_access(d.organization_id))));

drop policy bills_select on public.bills;
create policy bills_select on public.bills for select to authenticated
  using ((private.has_permission(organization_id, 'bills.view') and private.can_access_location(organization_id, location_id))
         or private.has_support_access(organization_id));

drop policy bill_lines_select on public.bill_lines;
create policy bill_lines_select on public.bill_lines for select to authenticated
  using (exists (select 1 from public.bills b where b.id = bill_id
                  and ((private.has_permission(b.organization_id, 'bills.view') and private.can_access_location(b.organization_id, b.location_id))
                       or private.has_support_access(b.organization_id))));

drop policy bill_payments_select on public.bill_payments;
create policy bill_payments_select on public.bill_payments for select to authenticated
  using (exists (select 1 from public.bills b where b.id = bill_id
                  and ((private.has_permission(b.organization_id, 'bills.view') and private.can_access_location(b.organization_id, b.location_id))
                       or private.has_support_access(b.organization_id))));

drop policy bill_payment_voids_select on public.bill_payment_voids;
create policy bill_payment_voids_select on public.bill_payment_voids for select to authenticated
  using (exists (select 1 from public.bill_payments p join public.bills b on b.id = p.bill_id where p.id = payment_id
                  and ((private.has_permission(b.organization_id, 'bills.view') and private.can_access_location(b.organization_id, b.location_id))
                       or private.has_support_access(b.organization_id))));

-- ---------------------------------------------------------------------------
-- Writes (fire inside the RPCs; auth.uid() is the calling user)
-- ---------------------------------------------------------------------------
create or replace function private.enforce_location_scope()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_loc uuid;
begin
  if tg_table_name in ('sales_days', 'bills') then
    v_org := new.organization_id; v_loc := new.location_id;
    -- An update may not move a record into, or act on a record in, a location the caller can't access.
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

create trigger sales_days_location_scope before insert or update on public.sales_days
  for each row execute function private.enforce_location_scope();
create trigger bills_location_scope before insert or update on public.bills
  for each row execute function private.enforce_location_scope();
create trigger bill_payments_location_scope before insert on public.bill_payments
  for each row execute function private.enforce_location_scope();
create trigger bill_payment_voids_location_scope before insert on public.bill_payment_voids
  for each row execute function private.enforce_location_scope();

revoke all on all functions in schema private from public, anon;
grant execute on function
  private.is_org_member(uuid), private.member_role(uuid), private.has_permission(uuid, text),
  private.is_platform_admin(public.platform_role[]), private.has_support_access(uuid),
  private.org_is_writable(uuid), private.shares_org_with(uuid), private.role_rank(public.member_role),
  private.can_access_location(uuid, uuid)
  to authenticated, service_role;
