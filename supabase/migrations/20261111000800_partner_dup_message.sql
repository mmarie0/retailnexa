-- Nit from the #173 review: a repeated partner id said "different name"; say
-- what's actually wrong. Function-only change, same checks as 0700.
create or replace function public.save_partners(p_org uuid, p jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare r jsonb; v_ids uuid[] := '{}'; v_id uuid; i int := 0;
begin
  perform private.partner_guard(p_org);
  if jsonb_typeof(p) <> 'array' or jsonb_array_length(p) > 30 then raise exception 'up to 30 partners' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_array_elements(p) x where nullif(btrim(x ->> 'name'), '') is null or char_length(btrim(x ->> 'name')) > 80
               or (x ->> 'pct') is null or (x ->> 'pct')::numeric < 0 or (x ->> 'pct')::numeric > 100 or round((x ->> 'pct')::numeric, 2) <> (x ->> 'pct')::numeric) then
    raise exception 'each partner needs a name and a share from 0 to 100 percent, two decimals at most' using errcode = '22023';
  end if;
  if (select count(distinct lower(btrim(x ->> 'name'))) from jsonb_array_elements(p) x) < jsonb_array_length(p) then
    raise exception 'each partner needs a different name' using errcode = '22023';
  end if;
  if (select count(nullif(x ->> 'id', '')) - count(distinct nullif(x ->> 'id', '')) from jsonb_array_elements(p) x) > 0 then
    raise exception 'the same partner is in the list twice' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p) x where coalesce((x ->> 'active')::boolean, true))
     and (select sum((x ->> 'pct')::numeric) from jsonb_array_elements(p) x where coalesce((x ->> 'active')::boolean, true)) <> 100 then
    raise exception 'active partners must add up to 100 percent' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('partners:' || p_org::text, 0));
  for r in select * from jsonb_array_elements(p) loop
    i := i + 1;
    -- Match by id, else by name, so re-saving a list without ids doesn't duplicate anyone.
    v_id := coalesce(nullif(r ->> 'id', '')::uuid,
                     (select id from public.partners where organization_id = p_org and lower(btrim(name)) = lower(btrim(r ->> 'name'))));
    if v_id is not null and exists (select 1 from public.partners where id = v_id and organization_id = p_org) then
      update public.partners set name = btrim(r ->> 'name'), pct = (r ->> 'pct')::numeric, is_active = coalesce((r ->> 'active')::boolean, true), sort = i where id = v_id;
    else
      insert into public.partners (organization_id, name, pct, is_active, sort)
      values (p_org, btrim(r ->> 'name'), (r ->> 'pct')::numeric, coalesce((r ->> 'active')::boolean, true), i) returning id into v_id;
    end if;
    v_ids := v_ids || v_id;
  end loop;
  update public.partners set is_active = false where organization_id = p_org and not (id = any (v_ids))
     and exists (select 1 from public.distribution_shares s where s.partner_id = partners.id);
  delete from public.partners where organization_id = p_org and not (id = any (v_ids))
     and not exists (select 1 from public.distribution_shares s where s.partner_id = partners.id);
  return i;
end $$;
revoke all on function public.save_partners(uuid, jsonb) from public, anon;
grant execute on function public.save_partners(uuid, jsonb) to authenticated;
