-- =============================================================================
-- RetailNexa — Phase 1 foundation
-- Tenancy, memberships, roles & permissions, locations, invitations,
-- billing state (Stripe mirror), entitlements, audit log, platform admin,
-- support access grants, leads, announcements, rate limiting.
--
-- Security model (see docs/SECURITY_RULES.md):
--   * Every tenant table carries organization_id and has RLS enabled.
--   * Supabase grants ALL on public tables to anon/authenticated by default;
--     this migration revokes those grants and re-grants only what is needed.
--   * Multi-row / privileged writes go through SECURITY DEFINER RPCs that
--     re-check auth.uid() and permissions, and write the audit log.
--   * Helper functions live in schema "private" (not exposed by the API).
--   * Platform (super-admin) access requires an MFA-verified session (aal2).
-- =============================================================================

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
create type public.business_type as enum ('retail', 'wholesale', 'both');
create type public.org_status as enum ('active', 'suspended', 'closed');
create type public.member_role as enum ('owner', 'admin', 'manager', 'accountant', 'sales_rep', 'employee', 'viewer');
create type public.member_status as enum ('active', 'disabled');
create type public.location_kind as enum ('store', 'warehouse', 'office');
create type public.subscription_status as enum (
  'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused'
);
create type public.platform_role as enum ('superadmin', 'support', 'billing', 'readonly');
create type public.lead_kind as enum ('demo', 'contact');
create type public.lead_status as enum ('new', 'contacted', 'qualified', 'won', 'lost', 'spam');
create type public.announcement_severity as enum ('info', 'warning', 'critical');

-- -----------------------------------------------------------------------------
-- Generic helpers
-- -----------------------------------------------------------------------------
create or replace function private.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create or replace function private.role_rank(r public.member_role)
returns int language sql immutable set search_path = '' as $$
  select case r
    when 'owner' then 100 when 'admin' then 80 when 'manager' then 60
    when 'accountant' then 50 when 'sales_rep' then 40 when 'employee' then 30
    when 'viewer' then 10 end
$$;

-- -----------------------------------------------------------------------------
-- Core tenancy
-- -----------------------------------------------------------------------------
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 120),
  legal_name text check (legal_name is null or char_length(legal_name) <= 200),
  business_type public.business_type not null,
  status public.org_status not null default 'active',
  status_reason text,
  timezone text not null default 'America/New_York',
  currency char(3) not null default 'USD',
  phone text check (phone is null or char_length(phone) <= 40),
  website text check (website is null or char_length(website) <= 200),
  trial_consumed_at timestamptz,          -- set the first time a trial starts; prevents repeat trials
  canceled_at timestamptz,                -- subscription fully ended; data retained per policy
  retention_review_at timestamptz,        -- when data becomes eligible for owner-approved deletion review
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger organizations_updated_at before update on public.organizations
  for each row execute function private.set_updated_at();

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text check (full_name is null or char_length(full_name) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.member_role not null,
  status public.member_status not null default 'active',
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);
create index memberships_user_idx on public.memberships (user_id) where status = 'active';
create trigger memberships_updated_at before update on public.memberships
  for each row execute function private.set_updated_at();

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  kind public.location_kind not null default 'store',
  address_line1 text check (address_line1 is null or char_length(address_line1) <= 200),
  address_line2 text check (address_line2 is null or char_length(address_line2) <= 200),
  city text check (city is null or char_length(city) <= 100),
  region text check (region is null or char_length(region) <= 100),
  postal_code text check (postal_code is null or char_length(postal_code) <= 20),
  country char(2) not null default 'US',
  timezone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);
create index locations_org_idx on public.locations (organization_id);
create trigger locations_updated_at before update on public.locations
  for each row execute function private.set_updated_at();

-- Restricts a member to specific locations. No rows = all locations.
create table public.member_locations (
  membership_id uuid not null references public.memberships(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (membership_id, location_id)
);

-- -----------------------------------------------------------------------------
-- Permissions
-- -----------------------------------------------------------------------------
create table public.permissions (
  key text primary key check (key ~ '^[a-z_]+(\.[a-z_]+)+$'),
  description text not null,
  sensitive boolean not null default false
);

create table public.role_permissions (
  role public.member_role not null,
  permission text not null references public.permissions(key) on delete cascade,
  primary key (role, permission)
);

create table public.member_permission_overrides (
  membership_id uuid not null references public.memberships(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  permission text not null references public.permissions(key) on delete cascade,
  granted boolean not null,
  set_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (membership_id, permission)
);

-- -----------------------------------------------------------------------------
-- Invitations (token stored as SHA-256 hash only)
-- -----------------------------------------------------------------------------
create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role public.member_role not null check (role <> 'owner'),
  token_hash text not null unique,
  invited_by uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index invitations_org_idx on public.invitations (organization_id);

-- -----------------------------------------------------------------------------
-- Billing (mirror of Stripe; Stripe is the source of truth)
-- -----------------------------------------------------------------------------
create table public.billing_accounts (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  stripe_customer_id text not null unique check (stripe_customer_id like 'cus_%'),
  billing_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger billing_accounts_updated_at before update on public.billing_accounts
  for each row execute function private.set_updated_at();

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations(id) on delete cascade,
  stripe_subscription_id text not null unique check (stripe_subscription_id like 'sub_%'),
  stripe_customer_id text not null,
  status public.subscription_status not null,
  products text[] not null default '{}',            -- e.g. {retail}, {retail,wholesale}
  price_ids text[] not null default '{}',
  extra_locations int not null default 0 check (extra_locations >= 0),
  trial_start timestamptz,
  trial_end timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  cancel_at timestamptz,
  canceled_at timestamptz,
  ended_at timestamptz,
  past_due_since timestamptz,                      -- first time this subscription went past_due (grace anchor)
  stripe_synced_at timestamptz not null,           -- Stripe object freshness; older syncs are ignored
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger subscriptions_updated_at before update on public.subscriptions
  for each row execute function private.set_updated_at();

create table public.subscription_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stripe_event_id text,
  kind text not null,                 -- status_change | reactivated | trial_started | cancel_scheduled | cancel_unscheduled
  from_status public.subscription_status,
  to_status public.subscription_status,
  created_at timestamptz not null default now()
);
create index subscription_events_org_idx on public.subscription_events (organization_id, created_at desc);

-- Webhook idempotency ledger. No payload stored (PII minimisation).
create table public.stripe_events (
  id text primary key check (id like 'evt_%'),
  type text not null,
  stripe_created_at timestamptz not null,
  status text not null default 'processing' check (status in ('processing', 'processed', 'failed', 'ignored')),
  attempts int not null default 1,
  locked_at timestamptz not null default now(),
  processed_at timestamptz,
  last_error text,
  received_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Entitlement overrides (plan entitlements are derived from the subscription)
-- -----------------------------------------------------------------------------
create table public.feature_overrides (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  feature text not null check (feature ~ '^[a-z_]+(\.[a-z_]+)*$'),
  enabled boolean not null,
  reason text not null,
  expires_at timestamptz,
  set_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (organization_id, feature)
);

-- -----------------------------------------------------------------------------
-- Platform administration
-- -----------------------------------------------------------------------------
create table public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role public.platform_role not null,
  mfa_required boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Tenant-granted, time-boxed support access. platform_user_id null = any support staff.
create table public.support_access_grants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  platform_user_id uuid references auth.users(id) on delete cascade,
  granted_by uuid not null references auth.users(id) on delete cascade,
  reason text not null check (char_length(reason) between 3 and 500),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  check (expires_at > created_at and expires_at <= created_at + interval '72 hours')
);
create index support_access_org_idx on public.support_access_grants (organization_id);

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  kind public.lead_kind not null,
  name text not null check (char_length(name) between 1 and 120),
  email text not null check (char_length(email) <= 254),
  company text check (company is null or char_length(company) <= 160),
  phone text check (phone is null or char_length(phone) <= 40),
  business_type public.business_type,
  locations_count int check (locations_count is null or locations_count between 1 and 10000),
  message text check (message is null or char_length(message) <= 4000),
  source_path text check (source_path is null or char_length(source_path) <= 300),
  status public.lead_status not null default 'new',
  notes text check (notes is null or char_length(notes) <= 8000),
  assigned_to uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index leads_status_idx on public.leads (status, created_at desc);
create trigger leads_updated_at before update on public.leads
  for each row execute function private.set_updated_at();

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 160),
  body text not null check (char_length(body) between 1 and 4000),
  severity public.announcement_severity not null default 'info',
  audience public.business_type,          -- null = everyone
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at)
);

create table private.rate_limits (
  bucket text not null,
  window_start timestamptz not null,
  hits int not null default 0,
  primary key (bucket, window_start)
);

-- -----------------------------------------------------------------------------
-- Audit log (append-only)
-- -----------------------------------------------------------------------------
create table public.audit_logs (
  id bigint generated always as identity primary key,
  organization_id uuid,              -- intentionally no FK: history must survive org deletion
  actor_user_id uuid,
  actor_type text not null check (actor_type in ('user', 'platform_admin', 'system', 'stripe')),
  action text not null,
  target_type text,
  target_id text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index audit_logs_org_idx on public.audit_logs (organization_id, created_at desc);
create index audit_logs_created_idx on public.audit_logs (created_at desc);

create or replace function private.forbid_audit_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'audit_logs is append-only' using errcode = '42501';
end $$;
create trigger audit_logs_no_update before update or delete on public.audit_logs
  for each row execute function private.forbid_audit_mutation();
create trigger audit_logs_no_truncate before truncate on public.audit_logs
  for each statement execute function private.forbid_audit_mutation();

-- =============================================================================
-- Authorization helpers (SECURITY DEFINER, fixed search_path)
-- =============================================================================
create or replace function private.is_org_member(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.organization_id = p_org and m.user_id = auth.uid() and m.status = 'active'
  )
$$;

create or replace function private.member_role(p_org uuid)
returns public.member_role language sql stable security definer set search_path = '' as $$
  select m.role from public.memberships m
  where m.organization_id = p_org and m.user_id = auth.uid() and m.status = 'active'
$$;

create or replace function private.has_permission(p_org uuid, p_permission text)
returns boolean language sql stable security definer set search_path = '' as $$
  with me as (
    select m.id, m.role from public.memberships m
    where m.organization_id = p_org and m.user_id = auth.uid() and m.status = 'active'
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

-- Platform admin: active row AND (MFA not required OR session is aal2).
create or replace function private.is_platform_admin(p_roles public.platform_role[] default null)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.platform_admins pa
    where pa.user_id = auth.uid()
      and pa.is_active
      and (p_roles is null or pa.role = any (p_roles))
      and (not pa.mfa_required or coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2')
  )
$$;

-- Read access to tenant *business* data for platform staff requires a live grant.
create or replace function private.has_support_access(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_platform_admin(array['superadmin', 'support']::public.platform_role[])
    and exists (
      select 1 from public.support_access_grants g
      where g.organization_id = p_org
        and (g.platform_user_id is null or g.platform_user_id = auth.uid())
        and g.revoked_at is null and now() < g.expires_at
    )
$$;

-- Writable = org active AND billing in good standing (trialing/active, or past_due for
-- at most 7 days). MUST match PAST_DUE_GRACE_DAYS in src/lib/billing/access.ts.
-- Enforced here so a member calling the API directly cannot bypass billing state.
create or replace function private.org_is_writable(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.organizations o where o.id = p_org and o.status = 'active')
     and exists (
       select 1 from public.subscriptions s
       where s.organization_id = p_org
         and (s.status in ('trialing', 'active')
              or (s.status = 'past_due' and coalesce(s.past_due_since, now()) > now() - interval '7 days')))
$$;

-- Plan limit: active stores may not exceed 1 + purchased extra locations on the Retail plan.
create or replace function private.enforce_store_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_allowed int;
  v_active int;
begin
  if new.kind <> 'store' or not new.is_active then return new; end if;
  if tg_op = 'UPDATE' and old.kind = 'store' and old.is_active then return new; end if; -- not increasing
  select 1 + s.extra_locations into v_allowed from public.subscriptions s
   where s.organization_id = new.organization_id and 'retail' = any (s.products);
  if v_allowed is null then return new; end if; -- no retail plan yet (e.g. first store at signup)
  select count(*) into v_active from public.locations l
   where l.organization_id = new.organization_id and l.kind = 'store' and l.is_active and l.id <> new.id;
  if v_active + 1 > v_allowed then
    raise exception 'your plan includes % store location(s); add locations on the billing page first', v_allowed
      using errcode = '23514';
  end if;
  return new;
end $$;

create or replace function private.shares_org_with(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships a
    join public.memberships b on a.organization_id = b.organization_id
    where a.user_id = auth.uid() and a.status = 'active' and b.user_id = p_user
  )
$$;

create or replace function private.log_audit(
  p_org uuid, p_actor_type text, p_action text, p_target_type text, p_target_id text, p_metadata jsonb
) returns void language sql security definer set search_path = '' as $$
  insert into public.audit_logs (organization_id, actor_user_id, actor_type, action, target_type, target_id, metadata)
  values (p_org, auth.uid(), p_actor_type, p_action, p_target_type, p_target_id, coalesce(p_metadata, '{}'::jsonb))
$$;

-- Row-change audit for tenant configuration tables (captures direct writes too).
create or replace function private.audit_row_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_row jsonb := to_jsonb(coalesce(new, old));
  v_org uuid := coalesce((v_row ->> 'organization_id')::uuid,
                         case when tg_table_name = 'organizations' then (v_row ->> 'id')::uuid end);
  v_changes jsonb := '{}';
  k text;
begin
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(to_jsonb(new)) loop
      if k not in ('updated_at') and (to_jsonb(new) -> k) is distinct from (to_jsonb(old) -> k) then
        v_changes := v_changes || jsonb_build_object(k, jsonb_build_object('from', to_jsonb(old) -> k, 'to', to_jsonb(new) -> k));
      end if;
    end loop;
    if v_changes = '{}'::jsonb then return new; end if;
  end if;
  insert into public.audit_logs (organization_id, actor_user_id, actor_type, action, target_type, target_id, metadata)
  values (
    v_org, auth.uid(),
    case when auth.uid() is null then 'system'
         when v_org is not null and not private.is_org_member(v_org) and private.is_platform_admin() then 'platform_admin'
         else 'user' end,
    tg_table_name || '.' || lower(tg_op),
    tg_table_name,
    coalesce(v_row ->> 'id', v_row ->> 'membership_id'),
    case tg_op when 'UPDATE' then jsonb_build_object('changes', v_changes)
               when 'INSERT' then jsonb_build_object('row', v_row)
               else jsonb_build_object('old', v_row) end
  );
  return coalesce(new, old);
end $$;

create trigger audit_organizations after update on public.organizations
  for each row execute function private.audit_row_change();
create trigger audit_locations after insert or update or delete on public.locations
  for each row execute function private.audit_row_change();
create trigger audit_memberships after insert or update or delete on public.memberships
  for each row execute function private.audit_row_change();
create trigger audit_member_overrides after insert or update or delete on public.member_permission_overrides
  for each row execute function private.audit_row_change();
create trigger audit_member_locations after insert or delete on public.member_locations
  for each row execute function private.audit_row_change();

-- Integrity: member_locations must reference a membership and location of the same org.
create or replace function private.check_member_location_org()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.memberships m where m.id = new.membership_id and m.organization_id = new.organization_id)
     or not exists (select 1 from public.locations l where l.id = new.location_id and l.organization_id = new.organization_id) then
    raise exception 'membership and location must belong to the same organization' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger member_locations_org_check before insert or update on public.member_locations
  for each row execute function private.check_member_location_org();

create or replace function private.check_override_org()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.memberships m where m.id = new.membership_id and m.organization_id = new.organization_id) then
    raise exception 'override organization mismatch' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger member_overrides_org_check before insert or update on public.member_permission_overrides
  for each row execute function private.check_override_org();

-- New auth user -> profile row.
create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, lower(new.email), nullif(left(btrim(new.raw_user_meta_data ->> 'full_name'), 120), ''))
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- Keep profiles.email in step when a user changes their sign-in email.
create or replace function private.sync_profile_email()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set email = lower(new.email) where id = new.id;
  return new;
end $$;
create trigger on_auth_user_email_changed after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function private.sync_profile_email();

create trigger locations_store_limit before insert or update of kind, is_active on public.locations
  for each row execute function private.enforce_store_limit();

-- Platform staff must already have a verified authenticator before being granted access,
-- so a leaked password cannot be used to enrol the first factor (no trust-on-first-use).
create or replace function private.require_admin_mfa_factor()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.mfa_required and new.is_active and not exists (
    select 1 from auth.mfa_factors f where f.user_id = new.user_id and f.status = 'verified') then
    raise exception 'enrol two-factor authentication at /account/security before granting platform access'
      using errcode = '23514';
  end if;
  return new;
end $$;
create trigger platform_admins_require_mfa before insert or update on public.platform_admins
  for each row execute function private.require_admin_mfa_factor();

-- =============================================================================
-- Row Level Security
-- =============================================================================
alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.memberships enable row level security;
alter table public.locations enable row level security;
alter table public.member_locations enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.member_permission_overrides enable row level security;
alter table public.invitations enable row level security;
alter table public.billing_accounts enable row level security;
alter table public.subscriptions enable row level security;
alter table public.subscription_events enable row level security;
alter table public.stripe_events enable row level security;
alter table public.feature_overrides enable row level security;
alter table public.platform_admins enable row level security;
alter table public.support_access_grants enable row level security;
alter table public.leads enable row level security;
alter table public.announcements enable row level security;
alter table public.audit_logs enable row level security;

-- Start from zero privileges (Supabase grants ALL by default), then grant narrowly.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- organizations
grant select on public.organizations to authenticated;
grant update (name, legal_name, timezone, currency, phone, website) on public.organizations to authenticated;
create policy org_select on public.organizations for select to authenticated
  using (private.is_org_member(id) or private.is_platform_admin());
create policy org_update on public.organizations for update to authenticated
  using (private.has_permission(id, 'org.manage') and private.org_is_writable(id))
  with check (private.has_permission(id, 'org.manage'));

-- profiles
grant select on public.profiles to authenticated;
grant update (full_name) on public.profiles to authenticated;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or private.shares_org_with(id) or private.is_platform_admin());
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- memberships (writes only through RPCs)
grant select on public.memberships to authenticated;
create policy memberships_select on public.memberships for select to authenticated
  using (user_id = auth.uid()
         or private.has_permission(organization_id, 'members.view')
         or private.is_platform_admin());

-- locations
grant select on public.locations to authenticated;
grant insert (organization_id, name, kind, address_line1, address_line2, city, region, postal_code, country, timezone)
  on public.locations to authenticated;
grant update (name, kind, address_line1, address_line2, city, region, postal_code, country, timezone, is_active)
  on public.locations to authenticated;
create policy locations_select on public.locations for select to authenticated
  using (private.is_org_member(organization_id) or private.is_platform_admin());
create policy locations_insert on public.locations for insert to authenticated
  with check (private.has_permission(organization_id, 'locations.manage') and private.org_is_writable(organization_id));
create policy locations_update on public.locations for update to authenticated
  using (private.has_permission(organization_id, 'locations.manage') and private.org_is_writable(organization_id))
  with check (private.has_permission(organization_id, 'locations.manage'));

-- member_locations
grant select on public.member_locations to authenticated;  -- writes via set_member_locations()
create policy member_locations_select on public.member_locations for select to authenticated
  using (private.has_permission(organization_id, 'members.view')
         or exists (select 1 from public.memberships m where m.id = membership_id and m.user_id = auth.uid()));

-- permission catalog (public reference data)
grant select on public.permissions, public.role_permissions to authenticated;
create policy permissions_read on public.permissions for select to authenticated using (true);
create policy role_permissions_read on public.role_permissions for select to authenticated using (true);

grant select on public.member_permission_overrides to authenticated;
create policy overrides_select on public.member_permission_overrides for select to authenticated
  using (private.has_permission(organization_id, 'members.view')
         or exists (select 1 from public.memberships m where m.id = membership_id and m.user_id = auth.uid()));

-- invitations (token hashes are never selectable by clients)
grant select (id, organization_id, email, role, invited_by, expires_at, accepted_at, revoked_at, created_at)
  on public.invitations to authenticated;
create policy invitations_select on public.invitations for select to authenticated
  using (private.has_permission(organization_id, 'members.manage'));

-- billing
grant select on public.billing_accounts to authenticated;
create policy billing_accounts_select on public.billing_accounts for select to authenticated
  using (private.has_permission(organization_id, 'billing.view') or private.is_platform_admin());

grant select (id, organization_id, status, products, extra_locations, trial_start, trial_end,
  current_period_start, current_period_end, cancel_at_period_end, cancel_at, canceled_at, ended_at,
  past_due_since, created_at, updated_at) on public.subscriptions to authenticated;
create policy subscriptions_select on public.subscriptions for select to authenticated
  using (private.is_org_member(organization_id) or private.is_platform_admin());

grant select on public.subscription_events to authenticated;
create policy subscription_events_select on public.subscription_events for select to authenticated
  using (private.has_permission(organization_id, 'billing.view') or private.is_platform_admin());

grant select on public.stripe_events to authenticated;
create policy stripe_events_select on public.stripe_events for select to authenticated
  using (private.is_platform_admin(array['superadmin', 'billing']::public.platform_role[]));

-- entitlements
grant select on public.feature_overrides to authenticated;
create policy feature_overrides_select on public.feature_overrides for select to authenticated
  using (private.is_org_member(organization_id) or private.is_platform_admin());

-- platform admins
grant select on public.platform_admins to authenticated;
create policy platform_admins_select on public.platform_admins for select to authenticated
  using (user_id = auth.uid() or private.is_platform_admin(array['superadmin']::public.platform_role[]));

-- support access
grant select on public.support_access_grants to authenticated;
create policy support_access_select on public.support_access_grants for select to authenticated
  using (private.has_permission(organization_id, 'org.manage') or private.is_platform_admin());

-- leads (inserted by the server with the service role after validation + rate limiting)
grant select on public.leads to authenticated;
create policy leads_select on public.leads for select to authenticated
  using (private.is_platform_admin());

-- announcements
grant select on public.announcements to authenticated;
create policy announcements_select on public.announcements for select to authenticated
  using ((starts_at <= now() and (ends_at is null or ends_at > now())) or private.is_platform_admin());

-- audit log
grant select on public.audit_logs to authenticated;
create policy audit_select on public.audit_logs for select to authenticated
  using ((organization_id is not null and private.has_permission(organization_id, 'audit.view'))
         or private.is_platform_admin());

-- service role keeps full table access (it bypasses RLS) for webhooks/cron/lead intake
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant all on private.rate_limits to service_role;

-- Future tables/sequences must be granted explicitly (Supabase defaults grant ALL to API roles).
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

-- Helper functions: callable by authenticated (needed inside RLS), never by anon.
revoke all on all functions in schema private from public;
grant execute on function
  private.is_org_member(uuid), private.member_role(uuid), private.has_permission(uuid, text),
  private.is_platform_admin(public.platform_role[]), private.has_support_access(uuid),
  private.org_is_writable(uuid), private.shares_org_with(uuid), private.role_rank(public.member_role)
  to authenticated, service_role;
