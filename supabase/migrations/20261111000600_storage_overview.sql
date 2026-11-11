-- =============================================================================
-- Parity batch E, #116 Storage overview: how much this business has stored,
-- by kind (row counts) plus invoice files (count and bytes). Owners and admins
-- only (org.manage), read-only, counts only: no row contents are returned.
-- =============================================================================
create or replace function public.storage_overview(p_org uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r jsonb;
begin
  perform private.require_user();
  if not private.has_permission(p_org, 'org.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'bills', (select count(*) from public.bills where organization_id = p_org),
    'bill_payments', (select count(*) from public.bill_payments where organization_id = p_org),
    'vendors', (select count(*) from public.vendors where organization_id = p_org),
    'recurring_bills', (select count(*) from public.recurring_bills where organization_id = p_org),
    'invoice_files', (select count(*) from public.invoice_files where organization_id = p_org),
    'invoice_bytes', (select coalesce(sum(size_bytes), 0) from public.invoice_files where organization_id = p_org),
    'vendor_statements', (select count(*) from public.vendor_statements where organization_id = p_org),
    'sales_days', (select count(*) from public.sales_days where organization_id = p_org),
    'sales_months', (select count(*) from public.sales_months where organization_id = p_org),
    'category_sales', (select count(*) from public.category_sales where organization_id = p_org),
    'bank_lines', (select count(*) from public.bank_lines where organization_id = p_org),
    'journal_entries', (select count(*) from public.journal_entries where organization_id = p_org),
    'employees', (select count(*) from public.employees where organization_id = p_org),
    'shifts', (select count(*) from public.shifts where organization_id = p_org),
    'pay_runs', (select count(*) from public.pay_runs where organization_id = p_org),
    'location_balances', (select count(*) from public.location_balances where organization_id = p_org),
    'distributions', (select count(*) from public.distributions where organization_id = p_org),
    'maintenance_tasks', (select count(*) from public.maintenance_tasks where organization_id = p_org),
    'audit_logs', (select count(*) from public.audit_logs where organization_id = p_org)
  ) into r;
  return r;
end $$;
revoke all on function public.storage_overview(uuid) from public, anon;
grant execute on function public.storage_overview(uuid) to authenticated;
