-- =============================================================================
-- QA fixes batch 2
--   #36  Bill payments can be voided: the payment's entry is reversed on the
--        payment date, the bill's paid amount goes back down, status returns to
--        approved. Payment rows stay (insert-only); the void is its own record.
--   #45  A store-day is either one whole-store report OR per-register reports,
--        never both; register names are compared after normalizing
--        ("Reg 1" = "Register #1" = "register1").
-- =============================================================================

create table public.bill_payment_voids (
  payment_id uuid primary key references public.bill_payments(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  reversal_entry_id uuid not null,
  reason text not null check (char_length(reason) between 3 and 500),
  voided_by uuid references auth.users(id) on delete set null,
  voided_at timestamptz not null default now(),
  foreign key (organization_id, reversal_entry_id) references public.journal_entries (organization_id, id)
);
create trigger bill_payment_voids_immutable before update or delete on public.bill_payment_voids
  for each row execute function private.forbid_ledger_mutation();
alter table public.bill_payment_voids enable row level security;
revoke all on public.bill_payment_voids from anon, authenticated;
grant select on public.bill_payment_voids to authenticated;
grant all on public.bill_payment_voids to service_role;
create policy bill_payment_voids_select on public.bill_payment_voids for select to authenticated
  using (private.has_permission(organization_id, 'bills.view') or private.has_support_access(organization_id));

-- Allow the reversal of a payment entry only from void_bill_payment (in addition to the bill-void path).
create or replace function private.forbid_direct_bill_reversal()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.reverses_entry_id is not null and new.source_type = 'reversal'
     and exists (select 1 from public.journal_entries e
                  where e.id = new.reverses_entry_id and e.source_type in ('bill', 'bill_payment'))
     and not exists (select 1 from public.bills b
                      where b.journal_entry_id = new.reverses_entry_id and b.status = 'approved'
                        and b.paid_cents = 0 and current_setting('retailnexa.voiding_bill', true) = b.id::text)
     and coalesce(current_setting('retailnexa.voiding_payment_entry', true), '') <> new.reverses_entry_id::text then
    raise exception 'bill entries cannot be reversed directly; void the bill or the payment instead' using errcode = '42501';
  end if;
  return new;
end $$;

create or replace function public.void_bill_payment(p_payment uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_pay public.bill_payments;
  v_bill public.bills;
  v_lines jsonb;
  v_rev uuid;
begin
  perform private.require_user();
  select * into v_pay from public.bill_payments where id = p_payment;
  if v_pay.id is null then raise exception 'payment not found' using errcode = 'P0002'; end if;
  if not private.has_permission(v_pay.organization_id, 'bills.pay') or not private.org_is_writable(v_pay.organization_id) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 3 then raise exception 'a reason is required' using errcode = '22023'; end if;
  select * into v_bill from public.bills where id = v_pay.bill_id for update;
  if exists (select 1 from public.bill_payment_voids where payment_id = p_payment) then
    raise exception 'this payment is already voided' using errcode = '22023';
  end if;

  select jsonb_agg(jsonb_build_object('account_id', account_id, 'debit_cents', credit_cents, 'credit_cents', debit_cents, 'memo', memo) order by id)
    into v_lines from public.journal_lines where entry_id = v_pay.journal_entry_id;
  perform set_config('retailnexa.voiding_payment_entry', v_pay.journal_entry_id::text, true);
  -- Dated on the payment date so balances "as of" any date stay consistent (fails clearly if that period is closed).
  v_rev := private.post_entry(v_pay.organization_id, v_pay.paid_on, left('Reversal: payment voided — ' || btrim(p_reason), 500), v_lines,
                              'reversal:' || v_pay.journal_entry_id::text, 'reversal', v_pay.journal_entry_id::text,
                              v_bill.location_id, v_pay.journal_entry_id, false);
  perform set_config('retailnexa.voiding_payment_entry', '', true);

  insert into public.bill_payment_voids (payment_id, organization_id, reversal_entry_id, reason, voided_by)
  values (p_payment, v_pay.organization_id, v_rev, left(btrim(p_reason), 500), auth.uid());
  update public.bills set paid_cents = paid_cents - v_pay.amount_cents, status = 'approved' where id = v_bill.id;
  perform private.log_audit(v_pay.organization_id, 'user', 'bill.payment_voided', 'bill', v_bill.id::text,
    jsonb_build_object('payment_id', p_payment, 'amount_cents', v_pay.amount_cents, 'reason', left(btrim(p_reason), 500)));
  return v_rev;
end $$;
revoke all on function public.void_bill_payment(uuid, text) from public, anon, authenticated;
grant execute on function public.void_bill_payment(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- #45 register normalization + whole-store vs per-register exclusivity
-- ---------------------------------------------------------------------------
create or replace function private.normalize_register(p text)
returns text language sql immutable set search_path = '' as $$
  select case
    when v ~ '^(all|all registers|whole store|store total|total)$' then 'all registers'
    else regexp_replace(v, '^(reg|register|terminal|term|till|station|pos)\s*#?\s*', 'register ')
  end
  from (select regexp_replace(lower(btrim(coalesce(p, ''))), '\s+', ' ', 'g') as v) x
$$;

create or replace function private.guard_sales_day_overlap()
returns trigger language plpgsql set search_path = '' as $$
declare v_new text := private.normalize_register(new.register);
begin
  -- Serialize recordings for the same store-day so two concurrent imports can't both pass.
  perform pg_advisory_xact_lock(hashtextextended('salesday:' || new.location_id::text || ':' || new.business_date::text, 0));
  if exists (
    select 1 from public.sales_days d
     where d.organization_id = new.organization_id and d.location_id = new.location_id
       and d.business_date = new.business_date and d.voided_at is null and d.id <> new.id
       and (private.normalize_register(d.register) = v_new
            or (private.normalize_register(d.register) = 'all registers') <> (v_new = 'all registers'))) then
    raise exception 'sales for this store and date are already recorded (a whole-store report and per-register reports can''t both be recorded); void the existing day first'
      using errcode = '23505';
  end if;
  return new;
end $$;
create trigger sales_days_overlap_guard before insert on public.sales_days
  for each row execute function private.guard_sales_day_overlap();

revoke all on all functions in schema private from public, anon;
grant execute on function
  private.is_org_member(uuid), private.member_role(uuid), private.has_permission(uuid, text),
  private.is_platform_admin(public.platform_role[]), private.has_support_access(uuid),
  private.org_is_writable(uuid), private.shares_org_with(uuid), private.role_rank(public.member_role)
  to authenticated, service_role;
