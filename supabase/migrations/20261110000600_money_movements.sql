-- =============================================================================
-- Phase 2.6 — Guided money movements
-- Common entries that don't come from a sale or a bill, posted with fixed rules
-- (same as src/lib/accounting/postings.ts):
--   card_deposit         Dr Bank (gross − fees), Dr Card fees / Cr Card clearing (gross)
--   cash_deposit         Dr Bank / Cr Cash on hand
--   sales_tax_payment    Dr Sales tax payable / Cr Bank
--   owner_draw           Dr Owner draws / Cr Bank or Cash on hand
--   owner_contribution   Dr Bank or Cash on hand / Cr Owner's equity
-- Cash deposits may be recorded by anyone with cash.create (store managers);
-- everything else needs accounting.post. Idempotent per caller key.
-- =============================================================================
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

revoke all on function public.record_money_movement(uuid, text, date, bigint, text, bigint, text, text, uuid) from public, anon, authenticated;
grant execute on function public.record_money_movement(uuid, text, date, bigint, text, bigint, text, text, uuid) to authenticated;

-- Recent guided entries for people who may record cash deposits but can't read the books.
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
     and (v_all or e.source_type = 'cash_deposit')
   order by e.entry_date desc, e.created_at desc
   limit least(greatest(coalesce(p_limit, 30), 1), 200);
end $$;
revoke all on function public.recent_money_movements(uuid, int) from public, anon, authenticated;
grant execute on function public.recent_money_movements(uuid, int) to authenticated;
