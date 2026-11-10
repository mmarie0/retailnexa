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

-- True when p_user may start a trial Checkout for p_org now (and records the claim).
create or replace function public.claim_trial(p_user uuid, p_org uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_ok boolean;
begin
  insert into public.trial_claims as t (owner_user_id, organization_id) values (p_user, p_org)
  on conflict (owner_user_id) do update set organization_id = excluded.organization_id, claimed_at = now()
   where t.organization_id = excluded.organization_id
      or (t.claimed_at < now() - interval '25 hours'
          and not exists (select 1 from public.organizations o where o.id = t.organization_id and o.trial_consumed_at is not null))
  returning true into v_ok;
  return coalesce(v_ok, false);
end $$;
revoke all on function public.claim_trial(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_trial(uuid, uuid) to service_role;
