-- =============================================================================
-- Sales agents (partners) who sell RetailNexa.
--
-- * A superadmin adds an agent by email (the app creates the login and sends a
--   reset-password link); the agent row is keyed by their auth user.
-- * Accounts are credited to an agent by their referral link (claimed once by
--   the new business's owner, right after signup) or by a platform admin.
-- * Agents see only a short summary of their own accounts (name, type, plan
--   status, products, dates) through agent_clients(); never business records.
-- * Agents keep their own prospect list.
-- * Each agent may have ONE wholesale account at 50% off (unique
--   discount_org_id). The app applies the Stripe coupon at checkout; no price
--   changes here.
-- =============================================================================

create table public.sales_agents (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  email text not null check (char_length(email) <= 200),
  phone text check (phone is null or char_length(phone) <= 40),
  ref_code text not null check (ref_code ~ '^[A-Z0-9]{4,20}$'),
  is_active boolean not null default true,
  discount_org_id uuid references public.organizations(id) on delete set null,
  notes text check (notes is null or char_length(notes) <= 2000),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index sales_agents_ref_code_uidx on public.sales_agents (ref_code);
-- One discounted account per agent, and an account can't be two agents' discount.
create unique index sales_agents_discount_org_uidx on public.sales_agents (discount_org_id) where discount_org_id is not null;
create index sales_agents_created_by_idx on public.sales_agents (created_by);
create trigger sales_agents_updated_at before update on public.sales_agents for each row execute function private.set_updated_at();

alter table public.organizations
  add column sales_agent_id uuid references public.sales_agents(user_id) on delete set null,
  add column sales_agent_since timestamptz,
  add column sales_agent_source text check (sales_agent_source is null or sales_agent_source in ('referral', 'admin'));
create index organizations_sales_agent_idx on public.organizations (sales_agent_id);

create table public.agent_prospects (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.sales_agents(user_id) on delete cascade,
  business_name text not null check (char_length(btrim(business_name)) between 1 and 120),
  contact text check (contact is null or char_length(contact) <= 80),
  email text check (email is null or char_length(email) <= 200),
  phone text check (phone is null or char_length(phone) <= 40),
  business_type public.business_type,
  status text not null default 'new' check (status in ('new', 'contacted', 'demo', 'trial', 'won', 'lost')),
  follow_up date,
  notes text check (notes is null or char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index agent_prospects_agent_idx on public.agent_prospects (agent_id, status);
create trigger agent_prospects_updated_at before update on public.agent_prospects for each row execute function private.set_updated_at();

alter table public.sales_agents enable row level security;
alter table public.agent_prospects enable row level security;
revoke all on public.sales_agents, public.agent_prospects from anon, authenticated;
grant select on public.sales_agents, public.agent_prospects to authenticated;
grant all on public.sales_agents, public.agent_prospects to service_role;
create policy sales_agents_select on public.sales_agents for select to authenticated
  using (user_id = (select auth.uid()) or private.is_platform_admin());
create policy agent_prospects_select on public.agent_prospects for select to authenticated
  using (agent_id = (select auth.uid()) or private.is_platform_admin(array['superadmin']::public.platform_role[]));

-- Active agent check for the signed-in user.
create or replace function private.is_active_agent()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.sales_agents where user_id = auth.uid() and is_active)
$$;
revoke all on function private.is_active_agent() from public, anon;
grant execute on function private.is_active_agent() to authenticated;

-- ---------------------------------------------------------------------------
-- Admin (superadmin manages agents; superadmin/billing assign accounts)
-- ---------------------------------------------------------------------------
create or replace function public.admin_save_sales_agent(p_user uuid, p_name text, p_phone text, p_ref_code text, p_active boolean, p_notes text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_email text; v_code text := upper(btrim(coalesce(p_ref_code, ''))); v_new boolean;
begin
  if not private.is_platform_admin(array['superadmin']::public.platform_role[]) then raise exception 'permission denied' using errcode = '42501'; end if;
  select email into v_email from auth.users where id = p_user;
  if v_email is null then raise exception 'that login was not found' using errcode = '22023'; end if;
  if nullif(btrim(p_name), '') is null then raise exception 'enter the agent''s name' using errcode = '22023'; end if;
  if v_code !~ '^[A-Z0-9]{4,20}$' then raise exception 'the referral code is 4 to 20 letters or numbers' using errcode = '22023'; end if;
  if exists (select 1 from public.sales_agents where ref_code = v_code and user_id <> p_user) then raise exception 'that referral code is taken' using errcode = '22023'; end if;
  v_new := not exists (select 1 from public.sales_agents where user_id = p_user);
  insert into public.sales_agents (user_id, name, email, phone, ref_code, is_active, notes, created_by)
  values (p_user, btrim(left(p_name, 120)), v_email, nullif(btrim(left(p_phone, 40)), ''), v_code, coalesce(p_active, true), nullif(btrim(left(p_notes, 2000)), ''), auth.uid())
  on conflict (user_id) do update set name = excluded.name, phone = excluded.phone, ref_code = excluded.ref_code, is_active = excluded.is_active, notes = excluded.notes;
  perform private.log_audit(null, 'platform_admin', case when v_new then 'sales_agent.created' else 'sales_agent.updated' end, 'user', p_user::text,
    jsonb_build_object('ref_code', v_code, 'active', coalesce(p_active, true)));
end $$;

-- Credit an account to an agent (or clear it with null).
create or replace function public.admin_assign_sales_agent(p_org uuid, p_agent uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_old uuid;
begin
  if not private.is_platform_admin(array['superadmin', 'billing']::public.platform_role[]) then raise exception 'permission denied' using errcode = '42501'; end if;
  select sales_agent_id into v_old from public.organizations where id = p_org for update;
  if not found then raise exception 'organization not found' using errcode = 'P0002'; end if;
  if p_agent is not null and not exists (select 1 from public.sales_agents where user_id = p_agent) then raise exception 'that agent was not found' using errcode = '22023'; end if;
  update public.organizations set sales_agent_id = p_agent, sales_agent_since = case when p_agent is null then null else now() end,
         sales_agent_source = case when p_agent is null then null else 'admin' end
   where id = p_org;
  perform private.log_audit(p_org, 'platform_admin', 'sales_agent.assigned', 'organization', p_org::text, jsonb_build_object('from', v_old, 'to', p_agent));
end $$;

-- Set or clear an agent's one discounted wholesale account.
create or replace function public.admin_set_agent_discount(p_agent uuid, p_org uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_platform_admin(array['superadmin', 'billing']::public.platform_role[]) then raise exception 'permission denied' using errcode = '42501'; end if;
  if p_org is not null and not exists (
    select 1 from public.organizations o join public.memberships m on m.organization_id = o.id
     where o.id = p_org and m.user_id = p_agent and m.role = 'owner' and m.status = 'active' and o.business_type in ('wholesale', 'both')) then
    raise exception 'the discount is for a Wholesale account the agent owns' using errcode = '22023';
  end if;
  update public.sales_agents set discount_org_id = p_org where user_id = p_agent;
  if not found then raise exception 'that agent was not found' using errcode = '22023'; end if;
  perform private.log_audit(p_org, 'platform_admin', 'sales_agent.discount_set', 'user', p_agent::text, jsonb_build_object('organization', p_org));
end $$;

-- ---------------------------------------------------------------------------
-- Agent self-service
-- ---------------------------------------------------------------------------
-- The agent's accounts: a short summary only, never business records.
create or replace function public.agent_clients()
returns table (organization_id uuid, name text, business_type public.business_type, org_status public.org_status, created_at timestamptz,
               source text, since timestamptz, sub_status public.subscription_status, products text[], extra_locations int,
               trial_end timestamptz, current_period_end timestamptz, cancel_at_period_end boolean)
language sql stable security definer set search_path = '' as $$
  select o.id, o.name, o.business_type, o.status, o.created_at, o.sales_agent_source, o.sales_agent_since,
         s.status, coalesce(s.products, '{}'), coalesce(s.extra_locations, 0), s.trial_end, s.current_period_end, coalesce(s.cancel_at_period_end, false)
    from public.organizations o
    left join public.subscriptions s on s.organization_id = o.id
   where o.sales_agent_id = auth.uid() and private.is_active_agent()
   order by o.created_at desc
$$;

-- Credit a brand-new business to the agent whose referral link the owner used.
-- Quietly does nothing for a bad or inactive code, an account older than two
-- days, one already credited, or the agent's own business.
create or replace function public.claim_referral(p_org uuid, p_code text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_agent uuid;
begin
  perform private.require_user();
  if private.member_role(p_org) is distinct from 'owner' then raise exception 'permission denied' using errcode = '42501'; end if;
  select user_id into v_agent from public.sales_agents where ref_code = upper(btrim(coalesce(p_code, ''))) and is_active;
  if v_agent is null or v_agent = auth.uid() then return false; end if;
  update public.organizations set sales_agent_id = v_agent, sales_agent_since = now(), sales_agent_source = 'referral'
   where id = p_org and sales_agent_id is null and created_at > now() - interval '2 days'
     and not exists (select 1 from public.memberships m where m.organization_id = p_org and m.user_id = v_agent);
  if not found then return false; end if;
  perform private.log_audit(p_org, 'user', 'sales_agent.referral_claimed', 'organization', p_org::text, jsonb_build_object('agent', v_agent));
  return true;
end $$;

-- An agent picks their one 50%-off wholesale account (once; support can change it).
create or replace function public.agent_set_discount_org(p_org uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_user();
  if not private.is_active_agent() then raise exception 'permission denied' using errcode = '42501'; end if;
  if exists (select 1 from public.sales_agents where user_id = auth.uid() and discount_org_id is not null) then
    raise exception 'you already have a discounted account; contact support to change it' using errcode = '22023';
  end if;
  if private.member_role(p_org) is distinct from 'owner'
     or not exists (select 1 from public.organizations where id = p_org and business_type in ('wholesale', 'both')) then
    raise exception 'the discount is for a Wholesale account you own' using errcode = '22023';
  end if;
  update public.sales_agents set discount_org_id = p_org where user_id = auth.uid();
  perform private.log_audit(p_org, 'user', 'sales_agent.discount_set', 'user', auth.uid()::text, jsonb_build_object('organization', p_org));
end $$;

-- Is this business an active agent's discounted account? (Used at checkout by its owner.)
create or replace function public.org_agent_discount(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_org_member(p_org) and exists (select 1 from public.sales_agents where discount_org_id = p_org and is_active)
$$;

create or replace function public.save_agent_prospect(p_id uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_type public.business_type;
begin
  perform private.require_user();
  if not private.is_active_agent() then raise exception 'permission denied' using errcode = '42501'; end if;
  if nullif(btrim(p ->> 'business_name'), '') is null then raise exception 'enter the business name' using errcode = '22023'; end if;
  if coalesce(p ->> 'status', 'new') not in ('new', 'contacted', 'demo', 'trial', 'won', 'lost') then raise exception 'pick a status' using errcode = '22023'; end if;
  v_type := case when p ->> 'business_type' in ('retail', 'wholesale', 'both') then (p ->> 'business_type')::public.business_type end;
  if p_id is null then
    if (select count(*) from public.agent_prospects where agent_id = auth.uid()) >= 2000 then raise exception 'you have 2,000 prospects; remove some first' using errcode = '22023'; end if;
    insert into public.agent_prospects (agent_id, business_name, contact, email, phone, business_type, status, follow_up, notes)
    values (auth.uid(), btrim(left(p ->> 'business_name', 120)), nullif(btrim(left(p ->> 'contact', 80)), ''), nullif(btrim(left(p ->> 'email', 200)), ''),
            nullif(btrim(left(p ->> 'phone', 40)), ''), v_type, coalesce(p ->> 'status', 'new'), nullif(p ->> 'follow_up', '')::date, nullif(btrim(left(p ->> 'notes', 2000)), ''))
    returning id into v_id;
    return v_id;
  end if;
  update public.agent_prospects set business_name = btrim(left(p ->> 'business_name', 120)), contact = nullif(btrim(left(p ->> 'contact', 80)), ''),
         email = nullif(btrim(left(p ->> 'email', 200)), ''), phone = nullif(btrim(left(p ->> 'phone', 40)), ''), business_type = v_type,
         status = coalesce(p ->> 'status', 'new'), follow_up = nullif(p ->> 'follow_up', '')::date, notes = nullif(btrim(left(p ->> 'notes', 2000)), '')
   where id = p_id and agent_id = auth.uid();
  if not found then raise exception 'that prospect was not found' using errcode = '22023'; end if;
  return p_id;
end $$;

create or replace function public.delete_agent_prospect(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_user();
  delete from public.agent_prospects where id = p_id and agent_id = auth.uid();
  if not found then raise exception 'that prospect was not found' using errcode = '22023'; end if;
end $$;

revoke all on function public.admin_save_sales_agent(uuid, text, text, text, boolean, text), public.admin_assign_sales_agent(uuid, uuid), public.admin_set_agent_discount(uuid, uuid),
  public.agent_clients(), public.claim_referral(uuid, text), public.agent_set_discount_org(uuid), public.org_agent_discount(uuid),
  public.save_agent_prospect(uuid, jsonb), public.delete_agent_prospect(uuid) from public, anon;
grant execute on function public.admin_save_sales_agent(uuid, text, text, text, boolean, text), public.admin_assign_sales_agent(uuid, uuid), public.admin_set_agent_discount(uuid, uuid),
  public.agent_clients(), public.claim_referral(uuid, text), public.agent_set_discount_org(uuid), public.org_agent_discount(uuid),
  public.save_agent_prospect(uuid, jsonb), public.delete_agent_prospect(uuid) to authenticated;
