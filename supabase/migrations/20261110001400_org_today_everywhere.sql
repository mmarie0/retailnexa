-- =============================================================================
-- #59 Use the business's own date (private.org_today) instead of the UTC
-- current_date in void_bill (reversal date) and record_sales_day (future-date
-- guard). Bodies are otherwise identical to their latest definitions.
-- =============================================================================

create or replace function public.void_bill(p_bill uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_bill public.bills;
  v_lines jsonb;
begin
  perform private.require_user();
  select * into v_bill from public.bills where id = p_bill for update;
  if v_bill.id is null then raise exception 'bill not found' using errcode = 'P0002'; end if;
  if not private.has_permission(v_bill.organization_id, 'bills.approve') or not private.org_is_writable(v_bill.organization_id) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 3 then
    raise exception 'a reason is required' using errcode = '22023';
  end if;
  if v_bill.status = 'void' then raise exception 'bill is already void' using errcode = '22023'; end if;
  if v_bill.paid_cents > 0 then
    raise exception 'bills with payments cannot be voided' using errcode = '22023';
  end if;

  if v_bill.journal_entry_id is not null
     and not exists (select 1 from public.journal_entries where reverses_entry_id = v_bill.journal_entry_id) then
    select jsonb_agg(jsonb_build_object('account_id', account_id, 'debit_cents', credit_cents,
                                        'credit_cents', debit_cents, 'memo', memo) order by id)
      into v_lines from public.journal_lines where entry_id = v_bill.journal_entry_id;
    perform set_config('retailnexa.voiding_bill', p_bill::text, true);
    perform private.post_entry(v_bill.organization_id, greatest(v_bill.bill_date, private.org_today(v_bill.organization_id)),
                               left('Reversal: ' || btrim(p_reason), 500), v_lines,
                               'reversal:' || v_bill.journal_entry_id::text, 'reversal', v_bill.journal_entry_id::text,
                               v_bill.location_id, v_bill.journal_entry_id, false);
  end if;

  perform set_config('retailnexa.voiding_bill', '', true);
  update public.bills set status = 'void', voided_by = auth.uid(), voided_at = now(), void_reason = left(btrim(p_reason), 500)
   where id = p_bill;
  perform private.log_audit(v_bill.organization_id, 'user', 'bill.voided', 'bill', p_bill::text,
    jsonb_build_object('reason', left(btrim(p_reason), 500), 'was', v_bill.status));
end $$;

create or replace function public.record_sales_day(
  p_org uuid, p_location_id uuid, p_business_date date,
  p_gross_sales_cents bigint, p_discounts_cents bigint, p_sales_tax_cents bigint,
  p_cash_cents bigint, p_card_cents bigint,
  p_customer_credit_cents bigint default 0, p_register text default 'All registers',
  p_transaction_count int default null, p_source text default 'manual',
  p_import_batch_id uuid default null, p_categories jsonb default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := gen_random_uuid();
  v_entry uuid;
  v_loc text;
  v_reg text := coalesce(nullif(btrim(p_register), ''), 'All registers');
  v_lines jsonb := '[]'::jsonb;
  v_credit bigint := coalesce(p_customer_credit_cents, 0);
  v_disc bigint := coalesce(p_discounts_cents, 0);
  v_tax bigint := coalesce(p_sales_tax_cents, 0);
  v_cash bigint := coalesce(p_cash_cents, 0);
  v_card bigint := coalesce(p_card_cents, 0);
begin
  perform private.require_user();
  if not private.has_permission(p_org, 'sales.import') or not private.org_is_writable(p_org) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  select name into v_loc from public.locations where id = p_location_id and organization_id = p_org;
  if v_loc is null then raise exception 'location not found' using errcode = 'P0002'; end if;
  if p_business_date is null then raise exception 'business date is required' using errcode = '22023'; end if;
  if p_business_date > private.org_today(p_org) then raise exception 'business date is in the future' using errcode = '22023'; end if;
  if p_source not in ('manual', 'csv', 'vela') then raise exception 'unknown sales source' using errcode = '22023'; end if;
  if p_gross_sales_cents is null or least(p_gross_sales_cents, v_disc, v_tax, v_cash, v_card, v_credit) < 0 then
    raise exception 'amounts cannot be negative' using errcode = '22023';
  end if;
  if v_disc > p_gross_sales_cents then raise exception 'discounts cannot exceed gross sales' using errcode = '22023'; end if;
  if v_cash + v_card + v_credit <> p_gross_sales_cents - v_disc + v_tax then
    raise exception 'payments (% cents) must equal sales minus discounts plus tax (% cents)',
      v_cash + v_card + v_credit, p_gross_sales_cents - v_disc + v_tax using errcode = '22023';
  end if;
  if p_import_batch_id is not null and not exists (
       select 1 from public.sales_import_batches where id = p_import_batch_id and organization_id = p_org) then
    raise exception 'import batch not found' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.sales_days where organization_id = p_org and location_id = p_location_id
               and lower(btrim(register)) = lower(v_reg) and business_date = p_business_date and voided_at is null) then
    raise exception 'sales for % at % (%) are already recorded; void that day first to replace it', p_business_date, v_loc, v_reg
      using errcode = '23505';
  end if;
  if p_categories is not null and jsonb_typeof(p_categories) <> 'array' then
    raise exception 'categories must be an array' using errcode = '22023';
  end if;
  if p_categories is not null and jsonb_array_length(p_categories) > 500 then
    raise exception 'too many categories' using errcode = '22023';
  end if;

  -- Same lines as postings.ts dailySales(); zero lines are skipped.
  select coalesce(jsonb_agg(l), '[]'::jsonb) into v_lines from (
    select jsonb_build_object('account_id', private.account_by_role(p_org, r.role), 'debit_cents', r.d, 'credit_cents', r.c, 'memo', r.memo) as l
      from (values ('cash_on_hand', v_cash, 0::bigint, 'Cash sales'),
                   ('card_clearing', v_card, 0, 'Card sales awaiting deposit'),
                   ('customer_credits', v_credit, 0, 'Store credit redeemed'),
                   ('sales_discounts', v_disc, 0, 'Discounts'),
                   ('sales', 0, p_gross_sales_cents, 'Sales'),
                   ('sales_tax_payable', 0, v_tax, 'Sales tax collected')) as r(role, d, c, memo)
     where r.d > 0 or r.c > 0) x;

  v_entry := private.post_entry(p_org, p_business_date, left('Sales — ' || v_loc || ' — ' || v_reg, 500), v_lines,
                                'sales:' || v_id::text, 'sales_day', v_id::text, p_location_id, null, false);

  insert into public.sales_days (id, organization_id, location_id, register, business_date, gross_sales_cents, discounts_cents,
    sales_tax_cents, cash_cents, card_cents, customer_credit_cents, transaction_count, source, import_batch_id,
    journal_entry_id, created_by)
  values (v_id, p_org, p_location_id, v_reg, p_business_date, p_gross_sales_cents, v_disc, v_tax, v_cash, v_card, v_credit,
    p_transaction_count, p_source, p_import_batch_id, v_entry, auth.uid());

  if p_categories is not null then
    insert into public.sales_day_categories (organization_id, sales_day_id, category, net_sales_cents, quantity)
    select p_org, v_id, btrim(c ->> 'category'), (c ->> 'net_sales_cents')::bigint, (c ->> 'quantity')::numeric
      from jsonb_array_elements(p_categories) c;
  end if;

  if p_import_batch_id is not null then
    update public.sales_import_batches set row_count = row_count + 1 where id = p_import_batch_id;
  end if;
  return v_id;
end $$;
