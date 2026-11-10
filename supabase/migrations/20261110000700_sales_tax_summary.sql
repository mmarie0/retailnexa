-- =============================================================================
-- Phase 2.7 — Sales tax summary for a period
-- From the Sales tax payable account: owed at the start, collected (credits),
-- paid (debits), owed at the end. Accrual basis. accounting.view / profit.view.
-- =============================================================================
create or replace function public.sales_tax_summary(p_org uuid, p_from date, p_to date)
returns table (opening_cents bigint, collected_cents bigint, paid_cents bigint, closing_cents bigint)
language plpgsql stable security definer set search_path = '' as $$
declare v_acct uuid;
begin
  if not (private.has_permission(p_org, 'accounting.view') or private.has_permission(p_org, 'profit.view')
          or private.has_support_access(p_org)) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'invalid date range' using errcode = '22023'; end if;
  select id into v_acct from public.accounts where organization_id = p_org and role = 'sales_tax_payable';
  return query
  with l as (
    select e.entry_date, jl.debit_cents, jl.credit_cents
      from public.journal_lines jl join public.journal_entries e on e.id = jl.entry_id
     where jl.organization_id = p_org and jl.account_id = v_acct and e.entry_date <= p_to
  )
  select coalesce(sum(credit_cents - debit_cents) filter (where entry_date < p_from), 0)::bigint,
         coalesce(sum(credit_cents) filter (where entry_date >= p_from), 0)::bigint,
         coalesce(sum(debit_cents) filter (where entry_date >= p_from), 0)::bigint,
         coalesce(sum(credit_cents - debit_cents), 0)::bigint
    from l;
end $$;
revoke all on function public.sales_tax_summary(uuid, date, date) from public, anon, authenticated;
grant execute on function public.sales_tax_summary(uuid, date, date) to authenticated, service_role;
