-- =============================================================================
-- Payroll Lows from the #157 audit.
--   1. "already in a pay run" no longer uses 23505 (the app showed "That already exists").
--   2. Error text is plain ASCII so the app shows it instead of a generic message.
--   3. A request key only replays the SAME request (payload hash).
--   4. Overtime hours are paid as overtime only when overtime is on in Payroll rules.
--   5. The line amount checks are re-created NOT VALID + VALIDATE.
-- =============================================================================
alter table public.pay_runs add column payload_hash text check (payload_hash is null or payload_hash ~ '^[0-9a-f]{32}$');

alter table public.pay_run_lines drop constraint pay_run_lines_amounts_cap, drop constraint pay_run_lines_ot_le_hours;
alter table public.pay_run_lines
  add constraint pay_run_lines_amounts_cap check (regular_cents <= 100000000 and overtime_cents <= 100000000
    and bonus_cents <= 1000000 and gross_cents <= 300000000 and employer_tax_cents <= 100000000) not valid,
  add constraint pay_run_lines_ot_le_hours check (overtime_hours <= hours) not valid;
alter table public.pay_run_lines validate constraint pay_run_lines_amounts_cap;
alter table public.pay_run_lines validate constraint pay_run_lines_ot_le_hours;

create or replace function public.create_pay_run(
  p_org uuid, p_pay_date date, p_period_start date, p_period_end date, p_lines jsonb,
  p_note text default null, p_idempotency_key text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_run uuid; l jsonb; v_emp uuid; e public.employees; p public.employee_pay;
  v_ids uuid[]; v_adv bigint; v_n int; v_hours numeric; v_ot numeric; v_bonus bigint;
  v_reg bigint; v_otc bigint; v_gross bigint; v_tax bigint; v_days int; v_mult numeric; v_ot_on boolean; v_hash text;
begin
  perform private.staff_guard(p_org, 'payroll.manage');
  if p_idempotency_key is not null then
    if p_idempotency_key !~ '^[A-Za-z0-9-]{8,100}$' then raise exception 'bad request key' using errcode = '22023'; end if;
    -- One payroll run at a time per business, so retries and double clicks see each other.
    perform pg_advisory_xact_lock(hashtext('pay_run:' || p_org::text));
    -- A retried request returns the first run, but only for the same request (Low 3).
    v_hash := md5(concat_ws('|', p_pay_date, p_period_start, p_period_end, p_lines::text, coalesce(p_note, '')));
    select id into v_run from public.pay_runs where organization_id = p_org and idempotency_key = p_idempotency_key;
    if v_run is not null then
      if (select payload_hash from public.pay_runs where id = v_run) is distinct from v_hash then
        raise exception 'this pay run was already saved with different details; reload the page and try again' using errcode = '22023';
      end if;
      return v_run;
    end if;
  else
    perform pg_advisory_xact_lock(hashtext('pay_run:' || p_org::text));
  end if;
  if p_pay_date is null or not isfinite(p_pay_date) or p_pay_date < '2000-01-01' or p_pay_date > private.org_today(p_org) + 31 then
    raise exception 'pick the pay date' using errcode = '22023';
  end if;
  if p_period_start is null or p_period_end is null or not isfinite(p_period_start) or not isfinite(p_period_end)
     or p_period_end < p_period_start or p_period_end - p_period_start > 31 or p_period_start < '2000-01-01' then
    raise exception 'pick a pay period of up to a month' using errcode = '22023';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) not between 1 and 500 then
    raise exception 'add at least one employee' using errcode = '22023';
  end if;
  select coalesce(overtime_multiplier, 1.5), coalesce(overtime, false) into v_mult, v_ot_on from public.staff_settings where organization_id = p_org;
  v_mult := coalesce(v_mult, 1.5); v_ot_on := coalesce(v_ot_on, false);

  insert into public.pay_runs (organization_id, pay_date, period_start, period_end, note, created_by, idempotency_key, payload_hash)
  values (p_org, p_pay_date, p_period_start, p_period_end, left(nullif(btrim(p_note), ''), 300), auth.uid(), p_idempotency_key, v_hash)
  returning id into v_run;

  for l in select * from jsonb_array_elements(p_lines) loop
    v_emp := (l ->> 'employee_id')::uuid;
    select * into e from public.employees where id = v_emp and organization_id = p_org;
    if e.id is null or not private.can_access_location(p_org, e.location_id) then raise exception 'employee not found' using errcode = 'P0002'; end if;
    select * into p from public.employee_pay where employee_id = v_emp;
    if p.employee_id is null then raise exception '% has no pay rate set', e.name using errcode = '22023'; end if;
    -- #156: nobody is paid twice for the same days.
    if exists (select 1 from public.pay_run_lines pl join public.pay_runs r on r.id = pl.run_id
                where pl.employee_id = v_emp and r.voided_at is null and r.id <> v_run
                  and r.period_start <= p_period_end and r.period_end >= p_period_start) then
      raise exception '% is already in a pay run for these dates; void that run first', e.name using errcode = '22023';
    end if;
    v_hours := coalesce((l ->> 'hours')::numeric, 0);
    v_ot := coalesce((l ->> 'overtime_hours')::numeric, 0);
    v_bonus := coalesce((l ->> 'bonus_cents')::bigint, 0);
    if v_hours < 0 or v_hours > 400 or v_ot < 0 or v_ot > v_hours then raise exception '%: hours must be 0 to 400 and overtime no more than hours', e.name using errcode = '22023'; end if;
    if v_bonus < 0 or v_bonus > 1000000 then raise exception '%: bonus must be 0 to 10,000 dollars', e.name using errcode = '22023'; end if;
    -- With overtime off in Payroll rules, every hour is paid at the regular rate (Low 4).
    if not v_ot_on then v_ot := 0; end if;
    -- #156: pay is computed here from the stored rate, never taken from the request.
    if p.pay_type = 'salary' then
      select count(*) into v_days from generate_series(p_period_start, p_period_end, interval '1 day') d
       where (e.start_date is null or d::date >= e.start_date) and (e.end_date is null or d::date <= e.end_date);
      v_reg := round(p.rate_cents::numeric * v_days / 365);
      v_otc := 0; v_hours := 0; v_ot := 0;
    else
      v_reg := round((v_hours - v_ot) * p.rate_cents);
      v_otc := round(v_ot * p.rate_cents * v_mult);
    end if;
    v_gross := v_reg + v_otc + v_bonus;
    v_tax := round((v_reg + v_otc) * p.burden_pct / 100);
    -- #154: lock the advances; only ones still open count, and they must all be.
    select coalesce(array_agg(x::uuid), '{}') into v_ids from jsonb_array_elements_text(coalesce(l -> 'advance_ids', '[]'::jsonb)) x;
    select coalesce(sum(a.amount_cents), 0), count(*) into v_adv, v_n from (
      select a.amount_cents from public.employee_advances a
       where a.id = any(v_ids) and a.organization_id = p_org and a.employee_id = v_emp and a.repaid_run_id is null
       for update) a;
    if v_n <> coalesce(array_length(v_ids, 1), 0) then raise exception 'an advance was already repaid or isn''t this employee''s' using errcode = '22023'; end if;
    if v_adv > v_gross then raise exception '%: advances to take back are more than the pay', e.name using errcode = '22023'; end if;
    insert into public.pay_run_lines (organization_id, run_id, employee_id, pay_type, hours, overtime_hours, rate_cents, regular_cents,
                                      overtime_cents, bonus_cents, gross_cents, advance_cents, net_cents, employer_tax_cents, pay_method)
    values (p_org, v_run, v_emp, p.pay_type, v_hours, v_ot, p.rate_cents, v_reg, v_otc, v_bonus, v_gross, v_adv, v_gross - v_adv, v_tax,
            coalesce(nullif(l ->> 'pay_method', ''), p.pay_method));
    update public.employee_advances set repaid_run_id = v_run where id = any(v_ids) and repaid_run_id is null;
    get diagnostics v_n = row_count;
    if v_n <> coalesce(array_length(v_ids, 1), 0) then raise exception 'an advance was already repaid' using errcode = '40001'; end if;
  end loop;
  return v_run;
end $$;
