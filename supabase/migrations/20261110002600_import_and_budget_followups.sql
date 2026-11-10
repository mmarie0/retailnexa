-- =============================================================================
-- Follow-ups to the admin import (#127) and Batch A (#132) audits.
--   #133 long import keys: payment idempotency keys and IMP- bill numbers come
--        from a hash of the key, so long keys never truncate into collisions.
--   #134 set_bill_budget: only real months 2000-01 to 2100-12; "every month"
--        is one call (p_every_month) so it saves all-or-nothing.
--   #135 budgets are business-wide: only members who see every store (owner,
--        admin, or no store limit) read or set them.
--   vendors.kind: the live app's Orders / Bills override per vendor (#136).
-- =============================================================================

-- #133 -------------------------------------------------------------------------
create or replace function private.import_bill(p_org uuid, r jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_vendor uuid := private.import_vendor_id(p_org, r ->> 'vendor');
  v_cents bigint := (r ->> 'amount_cents')::bigint;
  v_today date := private.org_today(p_org);
  v_bill_date date := private.import_date(r ->> 'bill_date', 'bill date', '2000-01-01', v_today + 366);
  v_due date := private.import_date(r ->> 'due_date', 'due date', '2000-01-01', v_today + 731);
  v_bill uuid;
  p jsonb; n int := 0;
begin
  if v_cents is null or v_cents <= 0 then raise exception 'amount must be positive (credits are not imported)' using errcode = '22023'; end if;
  if v_bill_date is null then raise exception 'bill date is missing' using errcode = '22023'; end if;
  if jsonb_typeof(coalesce(r -> 'payments', '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(r -> 'payments', '[]'::jsonb)) > 100 then
    raise exception 'a bill can have at most 100 payments' using errcode = '22023';
  end if;
  v_bill := public.create_bill(
    p_org, v_vendor,
    coalesce(nullif(btrim(r ->> 'bill_number'), ''),
             'IMP-' || case when char_length(r ->> 'key') <= 36 then r ->> 'key' else left(md5(r ->> 'key'), 16) end),
    v_bill_date, v_due,
    jsonb_build_array(jsonb_build_object(
      'account_id', private.account_by_role(p_org, coalesce(nullif(r ->> 'account_role', ''), 'other_operating')),
      'amount_cents', v_cents, 'description', left(nullif(btrim(r ->> 'memo'), ''), 300))),
    left(nullif(btrim(r ->> 'memo'), ''), 500),
    private.import_location_id(p_org, r ->> 'location'));
  perform public.approve_bill(v_bill);
  for p in select * from jsonb_array_elements(coalesce(r -> 'payments', '[]'::jsonb)) loop
    n := n + 1;
    if coalesce((p ->> 'amount_cents')::bigint, 0) <= 0 then
      raise exception 'payment % must be a positive amount', n using errcode = '22023';
    end if;
    perform public.record_bill_payment(
      v_bill, coalesce(private.import_date(p ->> 'date', 'payment date', '2000-01-01', v_today), v_bill_date), (p ->> 'amount_cents')::bigint,
      (case when p ->> 'source' = 'cash_on_hand' then 'cash_on_hand' else 'bank' end)::public.payment_source,
      'imp-' || md5(r ->> 'key') || '-' || n, left(nullif(btrim(p ->> 'reference'), ''), 100));
  end loop;
  return v_bill;
end $$;

-- #134 -------------------------------------------------------------------------
alter table public.bill_budgets add constraint bill_budgets_month_range
  check (month is null or month between '2000-01-01' and '2100-12-01');

drop function public.set_bill_budget(uuid, date, bigint);
-- p_every_month: set the default (p_month ignored for the amount) and drop
-- p_month's own budget, in one transaction.
create or replace function public.set_bill_budget(p_org uuid, p_month date, p_amount_cents bigint, p_every_month boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare v_month date;
begin
  perform private.require_user();
  if not private.has_permission(p_org, 'bills.approve') or not private.org_is_writable(p_org)
     or not private.can_access_location(p_org, null) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if p_month is not null and (not isfinite(p_month) or p_month < '2000-01-01' or p_month > '2100-12-31') then
    raise exception 'pick a month from 2000 to 2100' using errcode = '22023';
  end if;
  if p_amount_cents is not null and (p_amount_cents < 1 or p_amount_cents > 100000000000) then
    raise exception 'enter a budget between $0.01 and $1,000,000,000' using errcode = '22023';
  end if;
  if p_every_month and p_month is null then
    raise exception 'pick the month to apply the every-month budget to' using errcode = '22023';
  end if;
  v_month := case when p_every_month then null else date_trunc('month', p_month)::date end;
  if p_amount_cents is null then
    delete from public.bill_budgets where organization_id = p_org and month is not distinct from v_month;
  else
    insert into public.bill_budgets (organization_id, month, amount_cents, updated_by)
    values (p_org, v_month, p_amount_cents, auth.uid())
    on conflict (organization_id, month) do update
      set amount_cents = excluded.amount_cents, updated_by = excluded.updated_by;
  end if;
  if p_every_month then
    delete from public.bill_budgets where organization_id = p_org and month = date_trunc('month', p_month)::date;
  end if;
end $$;
revoke all on function public.set_bill_budget(uuid, date, bigint, boolean) from public, anon;
grant execute on function public.set_bill_budget(uuid, date, bigint, boolean) to authenticated;

-- #135 -------------------------------------------------------------------------
drop policy bill_budgets_select on public.bill_budgets;
create policy bill_budgets_select on public.bill_budgets for select to authenticated
  using ((private.has_permission(organization_id, 'bills.view') and private.can_access_location(organization_id, null))
         or private.has_support_access(organization_id));

-- Orders / Bills per vendor (#136) -----------------------------------------------
alter table public.vendors add column kind text check (kind is null or kind in ('order', 'bill'));
grant insert (kind) on public.vendors to authenticated;
grant update (kind) on public.vendors to authenticated;

-- For the app: does the caller see every store of this business? (#135)
create or replace function public.sees_all_stores(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_org_member(p_org) and private.can_access_location(p_org, null)
$$;
revoke all on function public.sees_all_stores(uuid) from public, anon;
grant execute on function public.sees_all_stores(uuid) to authenticated;
