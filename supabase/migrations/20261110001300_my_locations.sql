-- Locations the caller may work with (store pickers). Mirrors private.can_access_location:
-- owners/admins and unrestricted members get every active location; restricted members get theirs.
create or replace function public.my_locations(p_org uuid)
returns table (id uuid, name text, kind public.location_kind)
language sql stable security definer set search_path = '' as $$
  select l.id, l.name, l.kind from public.locations l
   where l.organization_id = p_org and l.is_active
     and private.is_org_member(p_org)
     and private.can_access_location(p_org, l.id)
   order by l.name
$$;
revoke all on function public.my_locations(uuid) from public, anon, authenticated;
grant execute on function public.my_locations(uuid) to authenticated;
