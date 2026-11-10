-- =============================================================================
-- Fixes after recurring bills + money movements
--   #65  Editing a recurring bill kept resetting its day of month.
--   #27  Cash deposits / money movements ignored store restrictions.
--   Cron Daily job that creates due recurring bills for every business
--        (service_role only; called by /api/cron/recurring-bills).
-- =============================================================================

-- Last failure per template (#68), shown on the template and cleared on save or success.
alter table public.recurring_bills
  add column last_error text,
  add column last_error_at timestamptz;

-- ---------------------------------------------------------------------------
-- #65 save_recurring_bill: keep the stored day of month on edit
-- ---------------------------------------------------------------------------
create or replace function public.save_recurring_bill(
  p_org uuid, p_id uuid, p_vendor uuid, p_name text, p_lines jsonb, p_frequency public.recurrence,
  p_next_date date, p_day_of_month int default null, p_due_days int default 0,
  p_end_date date default null, p_location_id uuid default null, p_is_active boolean default true
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid := p_id; v_bad int;
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
  if not private.can_access_location(p_org, p_location_id) then
    raise exception 'permission denied: this record belongs to a store you don''t have access to' using errcode = '42501';
  end if;

  if v_id is null then
    insert into public.recurring_bills (organization_id, vendor_id, location_id, name, lines, frequency, day_of_month,
                                        next_date, end_date, due_days, is_active, created_by)
    values (p_org, p_vendor, p_location_id, btrim(p_name), p_lines, p_frequency,
            case when p_frequency = 'weekly' then null else coalesce(p_day_of_month, extract(day from p_next_date)::int) end,
            p_next_date, p_end_date, coalesce(p_due_days, 0), coalesce(p_is_active, true), auth.uid())
    returning id into v_id;
  else
    update public.recurring_bills
       set vendor_id = p_vendor, location_id = p_location_id, name = btrim(p_name), lines = p_lines, frequency = p_frequency,
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

-- ---------------------------------------------------------------------------
-- Bill creation core (no caller checks) shared by create_bill and the
-- recurring-bill job. Callers must check permissions first.
-- ---------------------------------------------------------------------------
create or replace function private.insert_bill(
  p_org uuid, p_vendor uuid, p_bill_number text, p_bill_date date, p_due_date date,
  p_lines jsonb, p_memo text, p_location_id uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_total bigint;
  v_count int;
  v_bad int;
  v_due date;
begin
  if not exists (select 1 from public.vendors where id = p_vendor and organization_id = p_org and is_active) then
    raise exception 'vendor not found' using errcode = 'P0002';
  end if;
  if p_bill_date is null then raise exception 'bill date is required' using errcode = '22023'; end if;
  if p_location_id is not null and not exists (select 1 from public.locations where id = p_location_id and organization_id = p_org) then
    raise exception 'location not found' using errcode = 'P0002';
  end if;
  if jsonb_typeof(p_lines) <> 'array' then raise exception 'lines must be an array' using errcode = '22023'; end if;

  select count(*), coalesce(sum((l ->> 'amount_cents')::bigint), 0)
    into v_count, v_total from jsonb_array_elements(p_lines) l;
  if v_count < 1 or v_count > 100 then raise exception 'a bill needs 1 to 100 lines' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_array_elements(p_lines) l where coalesce((l ->> 'amount_cents')::bigint, 0) <= 0) then
    raise exception 'every line amount must be positive' using errcode = '22023';
  end if;

  select count(*) into v_bad from jsonb_array_elements(p_lines) l
   where not exists (select 1 from public.accounts a
                     where a.id = (l ->> 'account_id')::uuid and a.organization_id = p_org and a.is_active
                       and (a.type = 'expense' or a.role = 'inventory'));
  if v_bad > 0 then
    raise exception 'bill lines must use an active expense or inventory account of this business' using errcode = '22023';
  end if;

  v_due := coalesce(p_due_date, p_bill_date + (select payment_terms_days from public.vendors where id = p_vendor));

  insert into public.bills (organization_id, vendor_id, location_id, bill_number, bill_date, due_date, memo, total_cents, created_by)
  values (p_org, p_vendor, p_location_id, btrim(p_bill_number), p_bill_date, v_due, nullif(btrim(p_memo), ''), v_total, auth.uid())
  returning id into v_id;

  insert into public.bill_lines (organization_id, bill_id, account_id, description, amount_cents)
  select p_org, v_id, (l ->> 'account_id')::uuid, nullif(btrim(l ->> 'description'), ''), (l ->> 'amount_cents')::bigint
    from jsonb_array_elements(p_lines) l;

  perform private.log_audit(p_org, case when auth.uid() is null then 'system' else 'user' end, 'bill.created', 'bill', v_id::text,
    jsonb_build_object('vendor_id', p_vendor, 'total_cents', v_total));
  return v_id;
exception when unique_violation then
  if sqlerrm like '%bills_vendor_number_uidx%' then
    raise exception 'a bill with this number already exists for this vendor' using errcode = '23505';
  end if;
  raise;
end $$;

create or replace function public.create_bill(
  p_org uuid, p_vendor uuid, p_bill_number text, p_bill_date date, p_due_date date,
  p_lines jsonb, p_memo text default null, p_location_id uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_user();
  if not private.has_permission(p_org, 'bills.create') or not private.org_is_writable(p_org) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  return private.insert_bill(p_org, p_vendor, p_bill_number, p_bill_date, p_due_date, p_lines, p_memo, p_location_id);
end $$;

-- ---------------------------------------------------------------------------
-- Recurring-bill run, shared by the button and the daily job.
-- Templates in stores the caller can't access are skipped (the job has no
-- caller, so it covers every store).
-- ---------------------------------------------------------------------------
-- Returns {"made": n, "failed": n}. Each template runs in its own subtransaction (#68):
-- one template that can't be billed (inactive vendor/account) is skipped and flagged
-- on the template, and the business's other templates still run.
create or replace function private.make_due_recurring_bills(p_org uuid, p_through date)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.recurring_bills;
  v_period date;
  v_bill uuid;
  v_made int := 0;
  v_one int;
  v_failed int := 0;
  v_steps int;
begin
  for r in select * from public.recurring_bills
            where organization_id = p_org and is_active and next_date <= p_through
              and private.can_access_location(p_org, location_id)
            order by next_date for update
  loop
    begin
      v_period := r.next_date; v_steps := 0; v_one := 0;
      while v_period <= p_through and (r.end_date is null or v_period <= r.end_date) and v_steps < 60 loop
        if not exists (select 1 from public.bills where recurring_bill_id = r.id and recurring_period = v_period and status <> 'void') then
          v_bill := private.insert_bill(p_org, r.vendor_id, left(r.name, 40) || ' ' || to_char(v_period, 'YYYY-MM-DD'),
                                        v_period, v_period + r.due_days, r.lines, 'Recurring: ' || r.name, r.location_id);
          update public.bills set recurring_bill_id = r.id, recurring_period = v_period where id = v_bill;
          v_one := v_one + 1;
        end if;
        v_period := private.next_occurrence(v_period, r.frequency, r.day_of_month);
        v_steps := v_steps + 1;
      end loop;
      update public.recurring_bills
         set next_date = v_period, last_error = null, last_error_at = null,
             is_active = case when r.end_date is not null and v_period > r.end_date then false else is_active end
       where id = r.id;
      v_made := v_made + v_one;
    exception when others then
      v_failed := v_failed + 1;
      update public.recurring_bills set last_error = left(sqlerrm, 300), last_error_at = now() where id = r.id;
      perform private.log_audit(p_org, case when auth.uid() is null then 'system' else 'user' end,
        'recurring_bill.failed', 'recurring_bill', r.id::text, jsonb_build_object('error', left(sqlerrm, 300)));
    end;
  end loop;
  return jsonb_build_object('made', v_made, 'failed', v_failed);
end $$;

drop function public.create_due_recurring_bills(uuid, date);
create function public.create_due_recurring_bills(p_org uuid, p_through date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_through date := coalesce(p_through, private.org_today(p_org));
begin
  perform private.require_user();
  if not private.has_permission(p_org, 'bills.create') or not private.org_is_writable(p_org) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if v_through > private.org_today(p_org) + 31 then
    raise exception 'can only create bills up to a month ahead' using errcode = '22023';
  end if;
  return private.make_due_recurring_bills(p_org, v_through);
end $$;
revoke all on function public.create_due_recurring_bills(uuid, date) from public, anon, authenticated;
grant execute on function public.create_due_recurring_bills(uuid, date) to authenticated;

-- Daily job: every writable business with a template due by its local today.
-- One template or business failing doesn't stop the others; failures are counted.
create or replace function public.run_recurring_bills_job()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v_res jsonb;
  v_orgs int := 0;
  v_bills int := 0;
  v_failed int := 0;
begin
  if auth.uid() is not null then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  for v_org in select distinct rb.organization_id from public.recurring_bills rb
                where rb.is_active and rb.next_date <= private.org_today(rb.organization_id)
  loop
    if not private.org_is_writable(v_org) then continue; end if;
    begin
      v_res := private.make_due_recurring_bills(v_org, private.org_today(v_org));
      v_orgs := v_orgs + 1;
      v_bills := v_bills + (v_res ->> 'made')::int;
      v_failed := v_failed + (v_res ->> 'failed')::int;
      if (v_res ->> 'made')::int > 0 then
        perform private.log_audit(v_org, 'system', 'recurring_bills.created', 'organization', v_org::text,
          jsonb_build_object('bills', (v_res ->> 'made')::int));
      end if;
    exception when others then
      v_failed := v_failed + 1;
      perform private.log_audit(v_org, 'system', 'recurring_bills.failed', 'organization', v_org::text,
        jsonb_build_object('error', left(sqlerrm, 300)));
    end;
  end loop;
  -- failed = templates (or whole businesses) that couldn't be billed this run.
  return jsonb_build_object('orgs', v_orgs, 'bills', v_bills, 'failed', v_failed);
end $$;

revoke all on function private.insert_bill(uuid, uuid, text, date, date, jsonb, text, uuid),
                       private.make_due_recurring_bills(uuid, date) from public, anon, authenticated;
revoke all on function public.run_recurring_bills_job() from public, anon, authenticated;
grant execute on function public.run_recurring_bills_job() to service_role;

-- ---------------------------------------------------------------------------
-- #27 Money movements respect store restrictions
-- ---------------------------------------------------------------------------
create or replace function public.record_money_movement(
  p_org uuid, p_kind text, p_date date, p_amount_cents bigint, p_idempotency_key text,
  p_fees_cents bigint default 0, p_account text default 'bank', p_memo text default null, p_location_id uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_fees bigint := coalesce(p_fees_cents, 0);
  v_lines jsonb;
  v_memo text;
  v_allowed boolean;
  r text := p_account;
begin
  perform private.require_user();
  if p_kind not in ('card_deposit', 'cash_deposit', 'sales_tax_payment', 'owner_draw', 'owner_contribution') then
    raise exception 'unknown kind of entry' using errcode = '22023';
  end if;
  v_allowed := private.has_permission(p_org, 'accounting.post')
               or (p_kind = 'cash_deposit' and private.has_permission(p_org, 'cash.create'));
  if not v_allowed or not private.org_is_writable(p_org) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then raise exception 'amount must be positive' using errcode = '22023'; end if;
  if v_fees < 0 then raise exception 'fees cannot be negative' using errcode = '22023'; end if;
  if p_kind <> 'card_deposit' and v_fees <> 0 then raise exception 'fees only apply to card deposits' using errcode = '22023'; end if;
  if v_fees >= p_amount_cents then raise exception 'fees must be less than the card sales being deposited' using errcode = '22023'; end if;
  if r not in ('bank', 'cash_on_hand') or (p_kind in ('card_deposit', 'cash_deposit', 'sales_tax_payment') and r <> 'bank') then
    raise exception 'invalid account for this entry' using errcode = '22023';
  end if;
  if p_location_id is not null and not exists (select 1 from public.locations where id = p_location_id and organization_id = p_org) then
    raise exception 'location not found' using errcode = 'P0002';
  end if;
  -- Store-restricted members may only record for their own stores, never org-wide.
  if not private.can_access_location(p_org, p_location_id) then
    raise exception 'permission denied: choose a store you have access to' using errcode = '42501';
  end if;

  v_lines := case p_kind
    when 'card_deposit' then jsonb_build_array(
      jsonb_build_object('account_id', private.account_by_role(p_org, 'bank'), 'debit_cents', p_amount_cents - v_fees, 'memo', 'Card deposit'),
      jsonb_build_object('account_id', private.account_by_role(p_org, 'card_fees'), 'debit_cents', v_fees, 'memo', 'Processing fees'),
      jsonb_build_object('account_id', private.account_by_role(p_org, 'card_clearing'), 'credit_cents', p_amount_cents, 'memo', 'Card sales settled'))
    when 'cash_deposit' then jsonb_build_array(
      jsonb_build_object('account_id', private.account_by_role(p_org, 'bank'), 'debit_cents', p_amount_cents, 'memo', 'Cash deposited'),
      jsonb_build_object('account_id', private.account_by_role(p_org, 'cash_on_hand'), 'credit_cents', p_amount_cents))
    when 'sales_tax_payment' then jsonb_build_array(
      jsonb_build_object('account_id', private.account_by_role(p_org, 'sales_tax_payable'), 'debit_cents', p_amount_cents, 'memo', 'Sales tax remitted'),
      jsonb_build_object('account_id', private.account_by_role(p_org, 'bank'), 'credit_cents', p_amount_cents))
    when 'owner_draw' then jsonb_build_array(
      jsonb_build_object('account_id', private.account_by_role(p_org, 'owner_draws'), 'debit_cents', p_amount_cents, 'memo', 'Owner draw'),
      jsonb_build_object('account_id', private.account_by_role(p_org, r), 'credit_cents', p_amount_cents))
    else jsonb_build_array(
      jsonb_build_object('account_id', private.account_by_role(p_org, r), 'debit_cents', p_amount_cents, 'memo', 'Owner contribution'),
      jsonb_build_object('account_id', private.account_by_role(p_org, 'owner_equity'), 'credit_cents', p_amount_cents))
  end;
  -- Card deposits with zero fees: drop the zero line.
  select jsonb_agg(l) into v_lines from jsonb_array_elements(v_lines) l
   where coalesce((l ->> 'debit_cents')::bigint, 0) > 0 or coalesce((l ->> 'credit_cents')::bigint, 0) > 0;

  v_memo := coalesce(nullif(btrim(p_memo), ''), case p_kind
    when 'card_deposit' then 'Card processor deposit' when 'cash_deposit' then 'Cash deposit to bank'
    when 'sales_tax_payment' then 'Sales tax payment' when 'owner_draw' then 'Owner draw' else 'Owner contribution' end);
  return private.post_entry(p_org, p_date, left(v_memo, 500), v_lines, 'mm:' || p_idempotency_key, p_kind, null, p_location_id, null, false);
end $$;

create or replace function public.recent_money_movements(p_org uuid, p_limit int default 30)
returns table (id uuid, entry_date date, kind text, memo text, amount_cents bigint, reversed boolean)
language plpgsql stable security definer set search_path = '' as $$
declare v_all boolean;
begin
  v_all := private.has_permission(p_org, 'accounting.view') or private.has_support_access(p_org);
  if not v_all and not private.has_permission(p_org, 'cash.create') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  return query
  select e.id, e.entry_date, e.source_type, e.memo,
         (select sum(l.debit_cents) from public.journal_lines l where l.entry_id = e.id)::bigint,
         exists (select 1 from public.journal_entries x where x.reverses_entry_id = e.id)
    from public.journal_entries e
   where e.organization_id = p_org
     and e.source_type in ('card_deposit', 'cash_deposit', 'sales_tax_payment', 'owner_draw', 'owner_contribution')
     and (v_all or (e.source_type = 'cash_deposit' and private.can_access_location(e.organization_id, e.location_id)))
   order by e.entry_date desc, e.created_at desc
   limit least(greatest(coalesce(p_limit, 30), 1), 200);
end $$;
