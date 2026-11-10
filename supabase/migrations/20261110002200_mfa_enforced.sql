-- =============================================================================
-- #96 Two-factor protects customer sign-in, in the database too.
-- A user who has a verified authenticator only gets their business permissions
-- in an aal2 session (password + code). With a password alone (aal1) every
-- has_permission() check is false, so tenant data stays closed even to direct
-- API calls that bypass the app. Users without a verified factor are unchanged.
-- =============================================================================
create or replace function private.mfa_ok()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
      or not exists (select 1 from auth.mfa_factors f
                      where f.user_id = (select auth.uid()) and f.status = 'verified')
$$;
revoke all on function private.mfa_ok() from public, anon;
grant execute on function private.mfa_ok() to authenticated, service_role;

create or replace function private.has_permission(p_org uuid, p_permission text)
returns boolean language sql stable security definer set search_path = '' as $$
  with me as (
    select m.id, m.role from public.memberships m
    where m.organization_id = p_org and m.user_id = (select auth.uid()) and m.status = 'active'
      and private.mfa_ok()
  )
  select coalesce(
    (select true from me where me.role = 'owner'),
    (select o.granted from public.member_permission_overrides o join me on me.id = o.membership_id
      where o.permission = p_permission),
    (select true from public.role_permissions rp join me on me.role = rp.role
      where rp.permission = p_permission),
    false
  )
$$;

create or replace function private.member_role(p_org uuid)
returns public.member_role language sql stable security definer set search_path = '' as $$
  select m.role from public.memberships m
  where m.organization_id = p_org and m.user_id = (select auth.uid()) and m.status = 'active'
    and private.mfa_ok()
$$;

-- Teammates' names and emails are also hidden from a password-only session.
create or replace function private.shares_org_with(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.mfa_ok() and exists (
    select 1 from public.memberships a
    join public.memberships b on a.organization_id = b.organization_id
    where a.user_id = (select auth.uid()) and a.status = 'active' and b.user_id = p_user
  )
$$;
