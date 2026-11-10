-- =============================================================================
-- Stripe guards
--   #11 At most one live subscription per organization: sync_subscription no
--       longer lets a second live subscription overwrite the first, and
--       checkout start is serialized per organization.
--   #12 claim_stripe_event_state tells "already done" from "in flight" so the
--       webhook can ask Stripe to retry an in-flight delivery.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- #12
-- ---------------------------------------------------------------------------
create or replace function public.claim_stripe_event_state(p_id text, p_type text, p_created timestamptz)
returns text language plpgsql security definer set search_path = '' as $$
declare v_status text; v_locked timestamptz;
begin
  insert into public.stripe_events (id, type, stripe_created_at) values (p_id, p_type, p_created)
  on conflict (id) do nothing;
  if found then return 'claimed'; end if;

  select status, locked_at into v_status, v_locked from public.stripe_events where id = p_id for update;
  if v_status in ('processed', 'ignored') then return 'done'; end if;
  if v_status = 'processing' and v_locked >= now() - interval '5 minutes' then return 'in_flight'; end if;
  -- failed, or a stale processing lock: take it over.
  update public.stripe_events
     set status = 'processing', attempts = attempts + 1, locked_at = now(), last_error = null
   where id = p_id;
  return 'claimed';
end $$;
revoke all on function public.claim_stripe_event_state(text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.claim_stripe_event_state(text, text, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- #11 sync_subscription conflict guard
-- ---------------------------------------------------------------------------
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
    -- Two live subscriptions for one org (#11): never flip between them. Record it once
    -- for platform admins, who cancel/refund the duplicate in Stripe.
    if v_old.stripe_subscription_id <> v_sub_id and v_old.status = any (v_live) then
      if not exists (select 1 from public.audit_logs
                      where organization_id = p_org and action = 'billing.second_live_subscription'
                        and target_id = v_sub_id) then
        insert into public.subscription_events (organization_id, stripe_event_id, kind, from_status, to_status)
        values (p_org, p_event_id, 'second_live_subscription', v_old.status, v_status);
        perform private.log_audit(p_org, 'stripe', 'billing.second_live_subscription', 'subscription', v_sub_id,
          jsonb_build_object('kept', v_old.stripe_subscription_id, 'duplicate', v_sub_id, 'duplicate_status', v_status));
      end if;
      return 'conflict_second_live_subscription';
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

-- ---------------------------------------------------------------------------
-- #11 one checkout start at a time per organization
-- ---------------------------------------------------------------------------
alter table public.billing_accounts
  add column pending_checkout_session text check (pending_checkout_session like 'cs_%'),
  add column checkout_lock_until timestamptz;

-- Takes a 60-second per-org lock and returns the previous open session id (if any)
-- so the caller can expire it. Raises 55P03 while another start is in progress.
create or replace function public.begin_checkout(p_org uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_pending text;
begin
  update public.billing_accounts
     set checkout_lock_until = now() + interval '60 seconds'
   where organization_id = p_org and (checkout_lock_until is null or checkout_lock_until < now())
  returning pending_checkout_session into v_pending;
  if not found then
    if not exists (select 1 from public.billing_accounts where organization_id = p_org) then
      raise exception 'billing account not found' using errcode = 'P0002';
    end if;
    raise exception 'a checkout is already being started for this business' using errcode = '55P03';
  end if;
  return v_pending;
end $$;

-- Releases the lock; records the new open session when one was created.
create or replace function public.finish_checkout(p_org uuid, p_session text)
returns void language sql security definer set search_path = '' as $$
  update public.billing_accounts
     set checkout_lock_until = null,
         pending_checkout_session = coalesce(p_session, pending_checkout_session)
   where organization_id = p_org
$$;

revoke all on function public.begin_checkout(uuid), public.finish_checkout(uuid, text) from public, anon, authenticated;
grant execute on function public.begin_checkout(uuid), public.finish_checkout(uuid, text) to service_role;
