-- =============================================================================
-- RPCs. All SECURITY DEFINER with an empty search_path; each re-checks the
-- caller (auth.uid()) and permissions. Tenant RPCs: granted to authenticated.
-- System RPCs (Stripe sync, rate limiting): granted to service_role only.
-- =============================================================================

create or replace function private.require_user()
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v uuid := auth.uid();
begin
  if v is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  return v;
end $$;

create or replace function private.token_hash(p_token text)
returns text language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
$$;

-- -----------------------------------------------------------------------------
-- Tenant self-service
-- -----------------------------------------------------------------------------
create or replace function public.create_organization(
  p_name text, p_business_type public.business_type, p_location_name text default null,
  p_timezone text default 'America/New_York'
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := private.require_user();
  v_org uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('create_organization:' || v_user::text, 0));
  if (select count(*) from public.organizations where created_by = v_user) >= 5 then
    raise exception 'organization limit reached for this user' using errcode = '54000';
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception 'invalid timezone' using errcode = '22023';
  end if;

  insert into public.organizations (name, business_type, timezone, created_by)
  values (btrim(p_name), p_business_type, p_timezone, v_user)
  returning id into v_org;

  insert into public.memberships (organization_id, user_id, role) values (v_org, v_user, 'owner');

  insert into public.locations (organization_id, name, kind, timezone)
  values (v_org, coalesce(nullif(btrim(p_location_name), ''), btrim(p_name)),
          case when p_business_type = 'wholesale' then 'warehouse' else 'store' end::public.location_kind,
          p_timezone);

  perform private.log_audit(v_org, 'user', 'organization.created', 'organization', v_org::text,
    jsonb_build_object('business_type', p_business_type));
  return v_org;
end $$;

-- Permissions the current user effectively holds in an org (single source of truth for the UI).
create or replace function public.my_permissions(p_org uuid)
returns text[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(p.key order by p.key), '{}')
  from public.permissions p
  where private.has_permission(p_org, p.key)
$$;

create or replace function public.invite_member(p_org uuid, p_email text, p_role public.member_role)
returns table (invitation_id uuid, token text)
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := private.require_user();
  v_role public.member_role := private.member_role(p_org);
  v_email text := lower(btrim(p_email));
  v_token text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_id uuid;
begin
  if not private.has_permission(p_org, 'members.manage') or not private.org_is_writable(p_org) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if p_role = 'owner' then
    raise exception 'owners cannot be invited; promote an existing member instead' using errcode = '22023';
  end if;
  if v_role <> 'owner' and private.role_rank(p_role) >= private.role_rank(v_role) then
    raise exception 'cannot invite a role equal to or above your own' using errcode = '42501';
  end if;
  if exists (select 1 from public.memberships m join public.profiles pr on pr.id = m.user_id
             where m.organization_id = p_org and pr.email = v_email and m.status = 'active') then
    raise exception 'already a member' using errcode = '23505';
  end if;

  update public.invitations set revoked_at = now()
   where organization_id = p_org and email = v_email and accepted_at is null and revoked_at is null;

  insert into public.invitations (organization_id, email, role, token_hash, invited_by)
  values (p_org, v_email, p_role, private.token_hash(v_token), v_user)
  returning id into v_id;

  perform private.log_audit(p_org, 'user', 'member.invited', 'invitation', v_id::text,
    jsonb_build_object('email', v_email, 'role', p_role));
  return query select v_id, v_token;
end $$;

create or replace function public.revoke_invitation(p_invitation_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  perform private.require_user();
  select organization_id into v_org from public.invitations where id = p_invitation_id;
  if v_org is null or not private.has_permission(v_org, 'members.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  update public.invitations set revoked_at = now()
   where id = p_invitation_id and accepted_at is null and revoked_at is null;
  perform private.log_audit(v_org, 'user', 'member.invitation_revoked', 'invitation', p_invitation_id::text, '{}');
end $$;

create or replace function public.accept_invitation(p_token text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := private.require_user();
  v_email text;
  v_confirmed boolean;
  v_inv public.invitations;
  v_existing public.memberships;
begin
  -- Use the authoritative account record (not the JWT) and require a verified email,
  -- so nobody can claim an invite by signing up with someone else's unverified address.
  select lower(u.email), u.email_confirmed_at is not null into v_email, v_confirmed
    from auth.users u where u.id = v_user;
  if not coalesce(v_confirmed, false) then
    raise exception 'confirm your email address before joining a team' using errcode = '42501';
  end if;
  select * into v_inv from public.invitations
   where token_hash = private.token_hash(p_token)
     and accepted_at is null and revoked_at is null and expires_at > now()
   for update;
  if v_inv.id is null then
    raise exception 'invitation is invalid or expired' using errcode = '22023';
  end if;
  if v_email is null or v_inv.email <> v_email then
    raise exception 'this invitation was sent to a different email address' using errcode = '42501';
  end if;
  if not private.org_is_writable(v_inv.organization_id) then
    raise exception 'organization is not active' using errcode = '42501';
  end if;

  select * into v_existing from public.memberships
   where organization_id = v_inv.organization_id and user_id = v_user;
  if v_existing.id is null then
    insert into public.memberships (organization_id, user_id, role, invited_by)
    values (v_inv.organization_id, v_user, v_inv.role, v_inv.invited_by);
  elsif v_existing.status = 'disabled' then
    -- Rejoining starts clean: extra permissions granted in a previous stint do not come back.
    delete from public.member_permission_overrides where membership_id = v_existing.id;
    update public.memberships set status = 'active', role = v_inv.role where id = v_existing.id;
  end if;  -- already active: keep the current role; never downgrade via an invite

  update public.invitations set accepted_at = now(), accepted_by = v_user where id = v_inv.id;
  perform private.log_audit(v_inv.organization_id, 'user', 'member.joined', 'invitation', v_inv.id::text,
    jsonb_build_object('role', v_inv.role));
  return v_inv.organization_id;
end $$;

-- Shared guard for changing another member.
create or replace function private.assert_can_manage_member(p_target public.memberships, p_perm text)
returns public.member_role language plpgsql stable security definer set search_path = '' as $$
declare v_role public.member_role;
begin
  if p_target.id is null then raise exception 'member not found' using errcode = 'P0002'; end if;
  if not private.has_permission(p_target.organization_id, p_perm) or not private.org_is_writable(p_target.organization_id) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if p_target.user_id = auth.uid() then
    raise exception 'you cannot change your own access' using errcode = '42501';
  end if;
  v_role := private.member_role(p_target.organization_id);
  if v_role <> 'owner' and private.role_rank(p_target.role) >= private.role_rank(v_role) then
    raise exception 'cannot change a member with a role equal to or above your own' using errcode = '42501';
  end if;
  return v_role;
end $$;

create or replace function private.assert_not_last_owner(p_target public.memberships)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if p_target.role = 'owner' and p_target.status = 'active' and not exists (
    select 1 from public.memberships m
    where m.organization_id = p_target.organization_id and m.role = 'owner'
      and m.status = 'active' and m.id <> p_target.id) then
    raise exception 'an organization must keep at least one active owner' using errcode = '23514';
  end if;
end $$;

create or replace function public.update_member_role(p_membership_id uuid, p_role public.member_role)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_target public.memberships;
  v_caller public.member_role;
begin
  perform private.require_user();
  select * into v_target from public.memberships where id = p_membership_id for update;
  v_caller := private.assert_can_manage_member(v_target, 'members.manage');
  if v_caller <> 'owner' and private.role_rank(p_role) >= private.role_rank(v_caller) then
    raise exception 'cannot assign a role equal to or above your own' using errcode = '42501';
  end if;
  if p_role <> 'owner' then perform private.assert_not_last_owner(v_target); end if;
  if p_role is distinct from v_target.role then
    -- Individual permission adjustments belonged to the old role; drop them.
    delete from public.member_permission_overrides where membership_id = p_membership_id;
  end if;
  update public.memberships set role = p_role where id = p_membership_id;
end $$;

create or replace function public.set_member_status(p_membership_id uuid, p_status public.member_status)
returns void language plpgsql security definer set search_path = '' as $$
declare v_target public.memberships;
begin
  perform private.require_user();
  select * into v_target from public.memberships where id = p_membership_id for update;
  perform private.assert_can_manage_member(v_target, 'members.manage');
  if p_status = 'disabled' then
    perform private.assert_not_last_owner(v_target);
    delete from public.member_permission_overrides where membership_id = p_membership_id;
  end if;
  update public.memberships set status = p_status where id = p_membership_id;
end $$;

-- Replaces a member's location restriction. Empty array = all locations.
create or replace function public.set_member_locations(p_membership_id uuid, p_location_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare v_target public.memberships;
begin
  perform private.require_user();
  select * into v_target from public.memberships where id = p_membership_id for update;
  perform private.assert_can_manage_member(v_target, 'members.manage');
  delete from public.member_locations where membership_id = p_membership_id;
  insert into public.member_locations (membership_id, location_id, organization_id)
  select p_membership_id, l, v_target.organization_id from unnest(coalesce(p_location_ids, '{}')) as l;
end $$;

-- p_granted null removes the override.
create or replace function public.set_member_permission(p_membership_id uuid, p_permission text, p_granted boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_target public.memberships;
begin
  perform private.require_user();
  select * into v_target from public.memberships where id = p_membership_id for update;
  perform private.assert_can_manage_member(v_target, 'roles.manage');
  if v_target.role = 'owner' then
    raise exception 'owner permissions cannot be overridden' using errcode = '22023';
  end if;
  if not exists (select 1 from public.permissions where key = p_permission) then
    raise exception 'unknown permission' using errcode = '22023';
  end if;
  if p_granted is true and not private.has_permission(v_target.organization_id, p_permission) then
    raise exception 'cannot grant a permission you do not hold' using errcode = '42501';
  end if;
  if p_granted is null then
    delete from public.member_permission_overrides where membership_id = p_membership_id and permission = p_permission;
  else
    insert into public.member_permission_overrides (membership_id, organization_id, permission, granted, set_by)
    values (p_membership_id, v_target.organization_id, p_permission, p_granted, auth.uid())
    on conflict (membership_id, permission) do update set granted = excluded.granted, set_by = excluded.set_by, created_at = now();
  end if;
end $$;

create or replace function public.grant_support_access(p_org uuid, p_hours int, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user uuid := private.require_user(); v_id uuid;
begin
  if not private.has_permission(p_org, 'org.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if p_hours is null or p_hours < 1 or p_hours > 72 then
    raise exception 'support access must be between 1 and 72 hours' using errcode = '22023';
  end if;
  insert into public.support_access_grants (organization_id, granted_by, reason, expires_at)
  values (p_org, v_user, btrim(p_reason), now() + make_interval(hours => p_hours))
  returning id into v_id;
  perform private.log_audit(p_org, 'user', 'support_access.granted', 'support_access_grant', v_id::text,
    jsonb_build_object('hours', p_hours, 'reason', p_reason));
  return v_id;
end $$;

create or replace function public.revoke_support_access(p_grant_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  perform private.require_user();
  select organization_id into v_org from public.support_access_grants where id = p_grant_id;
  if v_org is null or not private.has_permission(v_org, 'org.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  update public.support_access_grants set revoked_at = now() where id = p_grant_id and revoked_at is null;
  perform private.log_audit(v_org, 'user', 'support_access.revoked', 'support_access_grant', p_grant_id::text, '{}');
end $$;

-- -----------------------------------------------------------------------------
-- Platform admin RPCs (require MFA-verified platform admin session)
-- -----------------------------------------------------------------------------
create or replace function public.admin_set_org_status(p_org uuid, p_status public.org_status, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_old public.org_status;
begin
  if not private.is_platform_admin(case when p_status = 'closed'
       then array['superadmin']::public.platform_role[]
       else array['superadmin', 'billing']::public.platform_role[] end) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 3 then
    raise exception 'a reason is required' using errcode = '22023';
  end if;
  select status into v_old from public.organizations where id = p_org for update;
  if v_old is null then raise exception 'organization not found' using errcode = 'P0002'; end if;
  -- Reopening a closed account is superadmin-only too.
  if v_old = 'closed' and not private.is_platform_admin(array['superadmin']::public.platform_role[]) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  update public.organizations set status = p_status, status_reason = btrim(p_reason) where id = p_org;
  perform private.log_audit(p_org, 'platform_admin', 'organization.status_changed', 'organization', p_org::text,
    jsonb_build_object('from', v_old, 'to', p_status, 'reason', p_reason));
end $$;

create or replace function public.admin_set_feature_override(
  p_org uuid, p_feature text, p_enabled boolean, p_reason text, p_expires_at timestamptz default null
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_platform_admin(array['superadmin', 'billing']::public.platform_role[]) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 3 then
    raise exception 'a reason is required' using errcode = '22023';
  end if;
  if p_enabled is null then
    delete from public.feature_overrides where organization_id = p_org and feature = p_feature;
  else
    insert into public.feature_overrides (organization_id, feature, enabled, reason, expires_at, set_by)
    values (p_org, p_feature, p_enabled, btrim(p_reason), p_expires_at, auth.uid())
    on conflict (organization_id, feature) do update
      set enabled = excluded.enabled, reason = excluded.reason, expires_at = excluded.expires_at,
          set_by = excluded.set_by, created_at = now();
  end if;
  perform private.log_audit(p_org, 'platform_admin', 'entitlement.override_set', 'feature', p_feature,
    jsonb_build_object('enabled', p_enabled, 'reason', p_reason, 'expires_at', p_expires_at));
end $$;

create or replace function public.admin_update_lead(
  p_lead uuid, p_status public.lead_status, p_notes text, p_assigned_to uuid default null
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_platform_admin(array['superadmin', 'support', 'billing']::public.platform_role[]) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  update public.leads set status = p_status, notes = p_notes, assigned_to = p_assigned_to where id = p_lead;
  if not found then raise exception 'lead not found' using errcode = 'P0002'; end if;
  perform private.log_audit(null, 'platform_admin', 'lead.updated', 'lead', p_lead::text,
    jsonb_build_object('status', p_status));
end $$;

create or replace function public.admin_create_announcement(
  p_title text, p_body text, p_severity public.announcement_severity, p_audience public.business_type,
  p_starts_at timestamptz, p_ends_at timestamptz
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not private.is_platform_admin(array['superadmin', 'support']::public.platform_role[]) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  insert into public.announcements (title, body, severity, audience, starts_at, ends_at, created_by)
  values (btrim(p_title), btrim(p_body), p_severity, p_audience, coalesce(p_starts_at, now()), p_ends_at, auth.uid())
  returning id into v_id;
  perform private.log_audit(null, 'platform_admin', 'announcement.created', 'announcement', v_id::text,
    jsonb_build_object('title', p_title));
  return v_id;
end $$;

create or replace function public.admin_end_announcement(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_platform_admin(array['superadmin', 'support']::public.platform_role[]) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  update public.announcements set ends_at = greatest(starts_at + interval '1 second', now()) where id = p_id;
  perform private.log_audit(null, 'platform_admin', 'announcement.ended', 'announcement', p_id::text, '{}');
end $$;

-- -----------------------------------------------------------------------------
-- System RPCs (service_role only)
-- -----------------------------------------------------------------------------

-- Returns true when the caller should process the event (new, or a previous attempt failed/stalled).
create or replace function public.claim_stripe_event(p_id text, p_type text, p_created timestamptz)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_claimed boolean;
begin
  insert into public.stripe_events (id, type, stripe_created_at) values (p_id, p_type, p_created)
  on conflict (id) do nothing;
  if found then return true; end if;

  update public.stripe_events
     set status = 'processing', attempts = attempts + 1, locked_at = now(), last_error = null
   where id = p_id
     and (status = 'failed' or (status = 'processing' and locked_at < now() - interval '5 minutes'))
  returning true into v_claimed;
  return coalesce(v_claimed, false);
end $$;

create or replace function public.finish_stripe_event(p_id text, p_status text, p_error text default null)
returns void language sql security definer set search_path = '' as $$
  update public.stripe_events
     set status = p_status, last_error = left(p_error, 2000),
         processed_at = case when p_status in ('processed', 'ignored') then now() else processed_at end
   where id = p_id
$$;

create or replace function public.link_billing_customer(p_org uuid, p_customer text, p_email text)
returns text language plpgsql security definer set search_path = '' as $$
declare v_existing text;
begin
  insert into public.billing_accounts (organization_id, stripe_customer_id, billing_email)
  values (p_org, p_customer, p_email)
  on conflict (organization_id) do nothing;
  select stripe_customer_id into v_existing from public.billing_accounts where organization_id = p_org;
  return v_existing;
end $$;

-- Mirrors a Stripe subscription. p is built server-side from a freshly retrieved Stripe object.
create or replace function public.sync_subscription(p_org uuid, p jsonb, p_event_id text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_old public.subscriptions;
  v_status public.subscription_status := (p ->> 'status')::public.subscription_status;
  v_sub_id text := p ->> 'stripe_subscription_id';
  v_synced timestamptz := (p ->> 'synced_at')::timestamptz;
  v_live constant public.subscription_status[] := array['trialing', 'active', 'past_due', 'unpaid', 'paused']::public.subscription_status[];
  v_ended constant public.subscription_status[] := array['canceled', 'incomplete_expired']::public.subscription_status[];
begin
  if not exists (select 1 from public.organizations where id = p_org) then
    raise exception 'organization not found' using errcode = 'P0002';
  end if;
  select * into v_old from public.subscriptions where organization_id = p_org for update;

  if v_old.id is not null then
    if v_old.stripe_subscription_id = v_sub_id and v_old.stripe_synced_at > v_synced then
      return 'stale';
    end if;
    -- A different subscription for the same org: only a live one may replace the current record.
    if v_old.stripe_subscription_id <> v_sub_id and not (v_status = any (v_live)) then
      return 'ignored_other_subscription';
    end if;
  end if;

  insert into public.subscriptions as s (
    organization_id, stripe_subscription_id, stripe_customer_id, status, products, price_ids, extra_locations,
    trial_start, trial_end, current_period_start, current_period_end, cancel_at_period_end, cancel_at,
    canceled_at, ended_at, past_due_since, stripe_synced_at)
  values (
    p_org, v_sub_id, p ->> 'stripe_customer_id', v_status,
    coalesce(array(select jsonb_array_elements_text(p -> 'products')), '{}'),
    coalesce(array(select jsonb_array_elements_text(p -> 'price_ids')), '{}'),
    coalesce((p ->> 'extra_locations')::int, 0),
    (p ->> 'trial_start')::timestamptz, (p ->> 'trial_end')::timestamptz,
    (p ->> 'current_period_start')::timestamptz, (p ->> 'current_period_end')::timestamptz,
    coalesce((p ->> 'cancel_at_period_end')::boolean, false), (p ->> 'cancel_at')::timestamptz,
    (p ->> 'canceled_at')::timestamptz, (p ->> 'ended_at')::timestamptz,
    case when v_status = 'past_due' then now() end, v_synced)
  on conflict (organization_id) do update set
    stripe_subscription_id = excluded.stripe_subscription_id, stripe_customer_id = excluded.stripe_customer_id,
    status = excluded.status, products = excluded.products, price_ids = excluded.price_ids,
    extra_locations = excluded.extra_locations, trial_start = excluded.trial_start, trial_end = excluded.trial_end,
    current_period_start = excluded.current_period_start, current_period_end = excluded.current_period_end,
    cancel_at_period_end = excluded.cancel_at_period_end, cancel_at = excluded.cancel_at,
    canceled_at = excluded.canceled_at, ended_at = excluded.ended_at, stripe_synced_at = excluded.stripe_synced_at,
    past_due_since = case
      when excluded.status <> 'past_due' then null
      when s.stripe_subscription_id = excluded.stripe_subscription_id and s.status = 'past_due' then coalesce(s.past_due_since, now())
      else now() end;

  -- History
  if v_old.id is null and v_status = 'trialing' then
    insert into public.subscription_events (organization_id, stripe_event_id, kind, to_status)
    values (p_org, p_event_id, 'trial_started', v_status);
  elsif v_old.id is null or v_old.status is distinct from v_status then
    insert into public.subscription_events (organization_id, stripe_event_id, kind, from_status, to_status)
    values (p_org, p_event_id, 'status_change', v_old.status, v_status);
  end if;
  if v_old.id is not null and v_old.status = any (array['canceled', 'unpaid', 'past_due', 'incomplete_expired', 'paused']::public.subscription_status[])
     and v_status in ('active', 'trialing') then
    insert into public.subscription_events (organization_id, stripe_event_id, kind, from_status, to_status)
    values (p_org, p_event_id, 'reactivated', v_old.status, v_status);
  end if;
  if v_old.id is not null and v_old.cancel_at_period_end is distinct from coalesce((p ->> 'cancel_at_period_end')::boolean, false) then
    insert into public.subscription_events (organization_id, stripe_event_id, kind, from_status, to_status)
    values (p_org, p_event_id,
            case when (p ->> 'cancel_at_period_end')::boolean then 'cancel_scheduled' else 'cancel_unscheduled' end,
            v_old.status, v_status);
  end if;

  -- Organization lifecycle: trials are one per organization; cancellation retains data.
  update public.organizations o set
    trial_consumed_at = case when v_status = 'trialing' or (p ->> 'trial_start') is not null
                             then coalesce(o.trial_consumed_at, now()) else o.trial_consumed_at end,
    canceled_at = case when v_status = any (v_ended) then coalesce(o.canceled_at, (p ->> 'ended_at')::timestamptz, now())
                       when v_status in ('active', 'trialing') then null else o.canceled_at end,
    retention_review_at = case when v_status = any (v_ended)
                               then coalesce(o.retention_review_at, coalesce((p ->> 'ended_at')::timestamptz, now()) + interval '365 days')
                               when v_status in ('active', 'trialing') then null else o.retention_review_at end
  where o.id = p_org;

  insert into public.audit_logs (organization_id, actor_type, action, target_type, target_id, metadata)
  values (p_org, 'stripe', 'subscription.synced', 'subscription', v_sub_id,
          jsonb_build_object('status', v_status, 'previous_status', v_old.status, 'event', p_event_id));
  return 'synced';
end $$;

-- Fixed-window rate limiter. Returns true when the hit is allowed.
create or replace function public.check_rate_limit(p_bucket text, p_max int, p_window_seconds int)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits int;
begin
  insert into private.rate_limits (bucket, window_start, hits) values (p_bucket, v_window, 1)
  on conflict (bucket, window_start) do update set hits = private.rate_limits.hits + 1
  returning hits into v_hits;
  delete from private.rate_limits where bucket = p_bucket and window_start < v_window - make_interval(secs => p_window_seconds);
  return v_hits <= p_max;
end $$;

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
revoke all on all functions in schema public from public, anon, authenticated;

grant execute on function
  public.create_organization(text, public.business_type, text, text),
  public.my_permissions(uuid),
  public.invite_member(uuid, text, public.member_role),
  public.revoke_invitation(uuid),
  public.accept_invitation(text),
  public.update_member_role(uuid, public.member_role),
  public.set_member_status(uuid, public.member_status),
  public.set_member_permission(uuid, text, boolean),
  public.set_member_locations(uuid, uuid[]),
  public.grant_support_access(uuid, int, text),
  public.revoke_support_access(uuid),
  public.admin_set_org_status(uuid, public.org_status, text),
  public.admin_set_feature_override(uuid, text, boolean, text, timestamptz),
  public.admin_update_lead(uuid, public.lead_status, text, uuid),
  public.admin_create_announcement(text, text, public.announcement_severity, public.business_type, timestamptz, timestamptz),
  public.admin_end_announcement(uuid)
  to authenticated;

grant execute on function
  public.claim_stripe_event(text, text, timestamptz),
  public.finish_stripe_event(text, text, text),
  public.link_billing_customer(uuid, text, text),
  public.sync_subscription(uuid, jsonb, text),
  public.check_rate_limit(text, int, int),
  public.my_permissions(uuid)
  to service_role;

revoke all on all functions in schema private from public;
grant execute on function
  private.is_org_member(uuid), private.member_role(uuid), private.has_permission(uuid, text),
  private.is_platform_admin(public.platform_role[]), private.has_support_access(uuid),
  private.org_is_writable(uuid), private.shares_org_with(uuid), private.role_rank(public.member_role)
  to authenticated, service_role;

-- Future objects created by migrations must not silently become executable by anon.
alter default privileges in schema public revoke execute on functions from public, anon;
