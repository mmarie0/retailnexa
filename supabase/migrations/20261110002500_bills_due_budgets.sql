-- =============================================================================
-- Parity batch A (#101 Due view, #107 vendors page).
--   1. vendors.pay_method: how a vendor is usually paid (shown on the vendors page).
--   2. bill_budgets: a monthly bills budget, with an optional default for months
--      that don't have their own. Read with bills.view; set through
--      set_bill_budget with bills.approve.
-- No money moves here: budgets are planning numbers, not ledger rows.
-- =============================================================================

-- 1. Vendor payment method ---------------------------------------------------
alter table public.vendors
  add column pay_method text check (pay_method is null or pay_method in ('check', 'ach', 'card', 'cash', 'other'));
grant insert (pay_method) on public.vendors to authenticated;
grant update (pay_method) on public.vendors to authenticated;

-- 2. Monthly budgets -----------------------------------------------------------
create table public.bill_budgets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- First day of the month; null = the default for months without their own budget.
  month date check (month is null or extract(day from month) = 1),
  amount_cents bigint not null check (amount_cents between 1 and 100000000000),
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (organization_id, month)
);
create index bill_budgets_updated_by_idx on public.bill_budgets (updated_by);
create trigger bill_budgets_updated_at before update on public.bill_budgets
  for each row execute function private.set_updated_at();
create trigger audit_bill_budgets after insert or update or delete on public.bill_budgets
  for each row execute function private.audit_row_change();

alter table public.bill_budgets enable row level security;
revoke all on public.bill_budgets from anon, authenticated;
grant select on public.bill_budgets to authenticated;
grant all on public.bill_budgets to service_role;
create policy bill_budgets_select on public.bill_budgets for select to authenticated
  using (private.has_permission(organization_id, 'bills.view') or private.has_support_access(organization_id));

-- Set (p_amount_cents > 0) or clear (null) the budget for p_month (any day in
-- the month) or, when p_month is null, the default budget.
create or replace function public.set_bill_budget(p_org uuid, p_month date, p_amount_cents bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare v_month date := date_trunc('month', p_month)::date;
begin
  perform private.require_user();
  if not private.has_permission(p_org, 'bills.approve') or not private.org_is_writable(p_org) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if p_amount_cents is null then
    delete from public.bill_budgets where organization_id = p_org and month is not distinct from v_month;
    return;
  end if;
  if p_amount_cents < 1 or p_amount_cents > 100000000000 then
    raise exception 'enter a budget between $0.01 and $1,000,000,000' using errcode = '22023';
  end if;
  insert into public.bill_budgets (organization_id, month, amount_cents, updated_by)
  values (p_org, v_month, p_amount_cents, auth.uid())
  on conflict (organization_id, month) do update
    set amount_cents = excluded.amount_cents, updated_by = excluded.updated_by;
end $$;

revoke all on function public.set_bill_budget(uuid, date, bigint) from public, anon;
grant execute on function public.set_bill_budget(uuid, date, bigint) to authenticated;
