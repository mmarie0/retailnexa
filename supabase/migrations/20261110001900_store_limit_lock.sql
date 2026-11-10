-- =============================================================================
-- #15 Store limit is race-free.
--   Concurrent inserts/reactivations are serialized per organization with a
--   transaction-level advisory lock before counting, so two requests can no
--   longer both pass the check.
--   Decision: a business with a subscription but without the Retail product
--   (wholesale-only) can't add or reactivate store locations; it adds Retail
--   first. Businesses with no subscription yet (signup, billing waiver) are
--   not capped here; org_is_writable governs them.
-- =============================================================================
create or replace function private.enforce_store_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_has_sub boolean;
  v_allowed int;
  v_active int;
begin
  if new.kind <> 'store' or not new.is_active then return new; end if;
  if tg_op = 'UPDATE' and old.kind = 'store' and old.is_active then return new; end if; -- not increasing

  perform pg_advisory_xact_lock(hashtextextended('store_limit:' || new.organization_id::text, 0));

  select true, case when 'retail' = any (s.products) then 1 + s.extra_locations else 0 end
    into v_has_sub, v_allowed
    from public.subscriptions s where s.organization_id = new.organization_id;
  if v_has_sub is null then return new; end if; -- no plan yet (e.g. first store at signup)

  select count(*) into v_active from public.locations l
   where l.organization_id = new.organization_id and l.kind = 'store' and l.is_active and l.id <> new.id;
  if v_active + 1 > v_allowed then
    if v_allowed = 0 then
      raise exception 'store locations need the Retail plan; add it on the billing page first' using errcode = '23514';
    end if;
    raise exception 'your plan includes % store location(s); add locations on the billing page first', v_allowed
      using errcode = '23514';
  end if;
  return new;
end $$;
