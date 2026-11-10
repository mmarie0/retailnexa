-- =============================================================================
-- QA fixes batch 1
--   #32  Staff-granted billing waiver ("billing.exempt" feature override):
--        lets a healthy active org write before a Stripe trial exists (testing,
--        pilots). Superadmin only, must expire within 90 days, audited by the
--        existing override RPC. Mirrors computeAccess() in src/lib/billing/access.ts.
--   #38  "Period has ended" uses the business's own time zone, not UTC.
-- =============================================================================

create or replace function private.billing_waived(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.feature_overrides f
                  where f.organization_id = p_org and f.feature = 'billing.exempt' and f.enabled
                    and f.expires_at is not null and f.expires_at > now())
$$;

create or replace function private.org_is_writable(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.organizations o where o.id = p_org and o.status = 'active')
     and (
       exists (
         select 1 from public.subscriptions s
          where s.organization_id = p_org
            and (s.status in ('trialing', 'active')
                 or (s.status = 'past_due' and coalesce(s.past_due_since, now()) > now() - interval '7 days')))
       or private.billing_waived(p_org))
$$;

-- Only a superadmin may waive billing, and only for up to 90 days at a time.
create or replace function private.guard_billing_exempt()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Ending or shortening a waiver is always allowed; granting or extending one is policed.
  if tg_op = 'UPDATE' and old.feature = 'billing.exempt'
     and (not new.enabled or (old.enabled and new.expires_at is not null and old.expires_at is not null and new.expires_at <= old.expires_at)) then
    return new;
  end if;
  if new.feature = 'billing.exempt' and new.enabled then
    if not private.is_platform_admin(array['superadmin']::public.platform_role[]) then
      raise exception 'only a superadmin can waive billing' using errcode = '42501';
    end if;
    if new.expires_at is null or new.expires_at > now() + interval '90 days' then
      raise exception 'a billing waiver needs an end date within 90 days' using errcode = '22023';
    end if;
  end if;
  return new;
end $$;
create trigger feature_overrides_billing_exempt_guard before insert or update on public.feature_overrides
  for each row execute function private.guard_billing_exempt();

-- Business-local "today".
create or replace function private.org_today(p_org uuid)
returns date language sql stable security definer set search_path = '' as $$
  select (now() at time zone coalesce((select nullif(o.timezone, '') from public.organizations o where o.id = p_org), 'America/New_York'))::date
$$;

create or replace function public.close_books_through(p_org uuid, p_through date, p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_prev date;
begin
  perform private.require_user();
  if not private.has_permission(p_org, 'accounting.close') or not private.org_is_writable(p_org) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  v_prev := private.closed_through(p_org);
  if v_prev is not null and p_through <= v_prev then
    raise exception 'books are already closed through %', v_prev using errcode = '22023';
  end if;
  if p_through >= private.org_today(p_org) then
    raise exception 'you can only close periods that have ended' using errcode = '22023';
  end if;
  insert into public.accounting_periods (organization_id, closed_through, closed_by, note)
  values (p_org, p_through, auth.uid(), p_note) returning id into v_id;
  perform private.log_audit(p_org, 'user', 'ledger.books_closed', 'accounting_period', v_id::text,
    jsonb_build_object('through', p_through));
  return v_id;
end $$;

revoke all on all functions in schema private from public, anon;
grant execute on function
  private.is_org_member(uuid), private.member_role(uuid), private.has_permission(uuid, text),
  private.is_platform_admin(public.platform_role[]), private.has_support_access(uuid),
  private.org_is_writable(uuid), private.shares_org_with(uuid), private.role_rank(public.member_role)
  to authenticated, service_role;
