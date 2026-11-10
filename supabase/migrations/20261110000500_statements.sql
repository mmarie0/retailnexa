-- =============================================================================
-- Phase 2.5 — Per-account activity for a date range (income statement lines)
-- Net debits − credits per account between two dates, inclusive, including
-- accounts with no activity (so the statement shows the full chart).
-- Readable with accounting.view or profit.view.
-- =============================================================================
create or replace function public.account_activity_detail(p_org uuid, p_from date, p_to date)
returns table (account_id uuid, code text, name text, type public.account_type, role text, net_cents bigint)
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
  select a.id, a.code, a.name, a.type, a.role,
         coalesce(sum(l.debit_cents - l.credit_cents) filter (where e.entry_date between p_from and p_to), 0)::bigint
    from public.accounts a
    left join public.journal_lines l on l.account_id = a.id and l.organization_id = p_org
    left join public.journal_entries e on e.id = l.entry_id
   where a.organization_id = p_org
   group by a.id, a.code, a.name, a.type, a.role
   order by a.code;
end $$;

revoke all on function public.account_activity_detail(uuid, date, date) from public, anon, authenticated;
grant execute on function public.account_activity_detail(uuid, date, date) to authenticated, service_role;
