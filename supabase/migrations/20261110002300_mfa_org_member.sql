-- =============================================================================
-- #118 Completes #96: org records, store names/addresses, subscription state and
-- feature overrides (policies and my_locations() backed by is_org_member) are
-- also closed to a password-only session of a user who has two-factor on.
-- The user's own membership row stays readable (memberships_select uses
-- user_id = auth.uid()), which is all the /login/verify step needs.
-- =============================================================================
create or replace function private.is_org_member(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.mfa_ok() and exists (
    select 1 from public.memberships m
    where m.organization_id = p_org and m.user_id = (select auth.uid()) and m.status = 'active'
  )
$$;
