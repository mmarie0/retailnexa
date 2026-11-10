-- =============================================================================
-- #78 A member limited to ONE store can save bills and recurring bills without
--     a Store picker: a missing store defaults to their only store.
-- #80 A trial claim is never released while a checkout for that business may
--     still be open (another request holds the checkout lock, or a Checkout
--     session was already created for it).
-- =============================================================================

-- The store to use when none was chosen: unchanged when one was given or the
-- caller may record "whole business" rows; otherwise the caller's only store.
create or replace function private.default_location(p_org uuid, p_location uuid)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v_only uuid; v_n int;
begin
  if p_location is not null or private.can_access_location(p_org, null) then return p_location; end if;
  select count(*), min(l.id::text)::uuid into v_n, v_only
    from public.locations l
   where l.organization_id = p_org and l.is_active and private.can_access_location(p_org, l.id);
  return case when v_n = 1 then v_only else null end;
end $$;
revoke all on function private.default_location(uuid, uuid) from public, anon, authenticated;

create or replace function public.create_bill(
  p_org uuid, p_vendor uuid, p_bill_number text, p_bill_date date, p_due_date date,
  p_lines jsonb, p_memo text default null, p_location_id uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_user();
  if not private.has_permission(p_org, 'bills.create') or not private.org_is_writable(p_org) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  return private.insert_bill(p_org, p_vendor, p_bill_number, p_bill_date, p_due_date, p_lines, p_memo,
                             private.default_location(p_org, p_location_id));
end $$;

create or replace function public.save_recurring_bill(
  p_org uuid, p_id uuid, p_vendor uuid, p_name text, p_lines jsonb, p_frequency public.recurrence,
  p_next_date date, p_day_of_month int default null, p_due_days int default 0,
  p_end_date date default null, p_location_id uuid default null, p_is_active boolean default true
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid := p_id; v_bad int; v_loc uuid := private.default_location(p_org, p_location_id);
begin
  perform private.require_user();
  if not private.has_permission(p_org, 'bills.create') or not private.org_is_writable(p_org) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if not exists (select 1 from public.vendors where id = p_vendor and organization_id = p_org and is_active) then
    raise exception 'vendor not found' using errcode = 'P0002';
  end if;
  if p_next_date is null then raise exception 'pick the first bill date' using errcode = '22023'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) not between 1 and 50 then
    raise exception 'a recurring bill needs 1 to 50 lines' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_lines) l where coalesce((l ->> 'amount_cents')::bigint, 0) <= 0) then
    raise exception 'every line amount must be positive' using errcode = '22023';
  end if;
  select count(*) into v_bad from jsonb_array_elements(p_lines) l
   where not exists (select 1 from public.accounts a where a.id = (l ->> 'account_id')::uuid and a.organization_id = p_org
                       and a.is_active and (a.type = 'expense' or a.role = 'inventory'));
  if v_bad > 0 then raise exception 'bill lines must use an active expense or inventory account of this business' using errcode = '22023'; end if;
  if not private.can_access_location(p_org, v_loc) then
    raise exception 'permission denied: this record belongs to a store you don''t have access to' using errcode = '42501';
  end if;

  if v_id is null then
    insert into public.recurring_bills (organization_id, vendor_id, location_id, name, lines, frequency, day_of_month,
                                        next_date, end_date, due_days, is_active, created_by)
    values (p_org, p_vendor, v_loc, btrim(p_name), p_lines, p_frequency,
            case when p_frequency = 'weekly' then null else coalesce(p_day_of_month, extract(day from p_next_date)::int) end,
            p_next_date, p_end_date, coalesce(p_due_days, 0), coalesce(p_is_active, true), auth.uid())
    returning id into v_id;
  else
    update public.recurring_bills
       set vendor_id = p_vendor, location_id = v_loc, name = btrim(p_name), lines = p_lines, frequency = p_frequency,
           -- Keep the stored day (e.g. 31 for month-end) unless the caller passes one or moves the next bill date.
           day_of_month = case when p_frequency = 'weekly' then null
                               else coalesce(p_day_of_month,
                                             case when next_date = p_next_date then day_of_month end,
                                             extract(day from p_next_date)::int) end,
           next_date = p_next_date, end_date = p_end_date, due_days = coalesce(p_due_days, 0), is_active = coalesce(p_is_active, true),
           last_error = null, last_error_at = null
     where id = v_id and organization_id = p_org;
    if not found then raise exception 'recurring bill not found' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end $$;

create or replace function public.release_trial_claim(p_user uuid, p_org uuid)
returns void language sql security definer set search_path = '' as $$
  delete from public.trial_claims t
   where t.owner_user_id = p_user and t.organization_id = p_org
     and not exists (select 1 from public.organizations o where o.id = p_org and o.trial_consumed_at is not null)
     and not exists (select 1 from public.billing_accounts b
                      where b.organization_id = p_org
                        and (b.checkout_lock_until > now() or b.pending_checkout_session is not null))
$$;
