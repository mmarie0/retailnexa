-- =============================================================================
-- #24, #31  Covering indexes for every foreign key in public that lacks one.
-- Runs after all earlier migrations, so it covers Phase 1 and Phase 2 tables
-- (incl. bank and payment-void tables). The schema-guard test
-- (tests/db/fk-indexes.test.ts) keeps future migrations from adding new gaps.
-- Index name: <table>_<cols>_fkx (truncated, made unique with a short hash).
-- =============================================================================
do $$
declare
  r record;
  v_name text;
begin
  for r in
    select c.conrelid::regclass as tbl, cl.relname as table_name, c.conname,
           array_agg(a.attname order by k.ord) as cols
      from pg_constraint c
      join pg_class cl on cl.oid = c.conrelid
      join pg_namespace n on n.oid = cl.relnamespace and n.nspname = 'public'
      cross join lateral unnest(c.conkey) with ordinality as k(attnum, ord)
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
     where c.contype = 'f'
       and not exists (
         select 1 from pg_index i
          where i.indrelid = c.conrelid
            and (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1] @> c.conkey
            and (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1] <@ c.conkey)
     group by c.conrelid, cl.relname, c.conname
  loop
    v_name := left(r.table_name || '_' || array_to_string(r.cols, '_'), 50) || '_' || left(md5(r.conname), 6) || '_fkx';
    execute format('create index if not exists %I on %s (%s)', v_name, r.tbl,
                   (select string_agg(format('%I', x), ', ') from unnest(r.cols) as x));
  end loop;
end $$;
