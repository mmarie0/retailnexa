-- =============================================================================
-- Phase 2.4 — Period activity by account role (for the dashboard / P&L)
-- Net movement (debits − credits) per account role between two dates, inclusive.
-- Readable with accounting.view or profit.view (owners/admins/accountants).
-- =============================================================================
create or replace function public.account_activity(p_org uuid, p_from date, p_to date)
returns table (role text, net_cents bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (private.has_permission(p_org, 'accounting.view') or private.has_permission(p_org, 'profit.view')
          or private.has_support_access(p_org)) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'invalid date range' using errcode = '22023';
  end if;
  if p_to - p_from > 3660 then
    raise exception 'date range is too long' using errcode = '22023';
  end if;
  return query
  select a.role, coalesce(sum(l.debit_cents - l.credit_cents), 0)::bigint
    from public.journal_lines l
    join public.journal_entries e on e.id = l.entry_id
    join public.accounts a on a.id = l.account_id
   where l.organization_id = p_org and e.organization_id = p_org
     and e.entry_date between p_from and p_to and a.role is not null
   group by a.role;
end $$;

revoke all on function public.account_activity(uuid, date, date) from public, anon, authenticated;
grant execute on function public.account_activity(uuid, date, date) to authenticated, service_role;
