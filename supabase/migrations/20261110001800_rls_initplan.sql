-- =============================================================================
-- #23 RLS performance: evaluate auth.uid() once per statement, not per row.
-- Same logic as the foundation policies; only auth.uid() -> (select auth.uid()).
-- =============================================================================
drop policy profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or private.shares_org_with(id) or private.is_platform_admin());

drop policy profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

drop policy memberships_select on public.memberships;
create policy memberships_select on public.memberships for select to authenticated
  using (user_id = (select auth.uid())
         or private.has_permission(organization_id, 'members.view')
         or private.is_platform_admin());

drop policy member_locations_select on public.member_locations;
create policy member_locations_select on public.member_locations for select to authenticated
  using (private.has_permission(organization_id, 'members.view')
         or exists (select 1 from public.memberships m where m.id = membership_id and m.user_id = (select auth.uid())));

drop policy overrides_select on public.member_permission_overrides;
create policy overrides_select on public.member_permission_overrides for select to authenticated
  using (private.has_permission(organization_id, 'members.view')
         or exists (select 1 from public.memberships m where m.id = membership_id and m.user_id = (select auth.uid())));

drop policy platform_admins_select on public.platform_admins;
create policy platform_admins_select on public.platform_admins for select to authenticated
  using (user_id = (select auth.uid()) or private.is_platform_admin(array['superadmin']::public.platform_role[]));
