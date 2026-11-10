-- =============================================================================
-- #17 One free trial per owner, even with Checkout started in two businesses
-- at once. A trial is claimed when the trial Checkout session is created (not
-- when Stripe reports it). The claim lapses if that business never actually
-- started its trial within 25 hours (Checkout sessions expire after 24h).
-- =============================================================================
create table public.trial_claims (
  owner_user_id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  claimed_at timestamptz not null default now()
);
create index trial_claims_org_idx on public.trial_claims (organization_id);
alter table public.trial_claims enable row level security;
revoke all on public.trial_claims from public, anon, authenticated;
grant all on public.trial_claims to service_role;

-- Claims the owner's trial for p_org. Returns the business that holds the claim:
-- p_org when the caller may start a trial Checkout now, another business id otherwise.
create or replace function public.claim_trial(p_user uuid, p_org uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_holder uuid;
begin
  insert into public.trial_claims as t (owner_user_id, organization_id) values (p_user, p_org)
  on conflict (owner_user_id) do update set organization_id = excluded.organization_id, claimed_at = now()
   where t.organization_id = excluded.organization_id
      or (t.claimed_at < now() - interval '25 hours'
          and not exists (select 1 from public.organizations o where o.id = t.organization_id and o.trial_consumed_at is not null))
  returning organization_id into v_holder;
  if v_holder is null then
    select organization_id into v_holder from public.trial_claims where owner_user_id = p_user;
  end if;
  return v_holder;
end $$;

-- Frees an unused claim, e.g. when creating the Checkout session failed (#73).
-- A claim whose business already started its trial is never released.
create or replace function public.release_trial_claim(p_user uuid, p_org uuid)
returns void language sql security definer set search_path = '' as $$
  delete from public.trial_claims t
   where t.owner_user_id = p_user and t.organization_id = p_org
     and not exists (select 1 from public.organizations o where o.id = p_org and o.trial_consumed_at is not null)
$$;

revoke all on function public.claim_trial(uuid, uuid), public.release_trial_claim(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_trial(uuid, uuid), public.release_trial_claim(uuid, uuid) to service_role;
