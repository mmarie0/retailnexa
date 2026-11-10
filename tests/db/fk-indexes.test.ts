import { afterAll, describe, expect, it } from 'vitest';
import { closeDb, sys } from './helpers';

afterAll(closeDb);

describe('schema guard: foreign keys are indexed (#24, #31)', () => {
  it('every foreign key in public has an index whose leading columns are exactly its columns', async () => {
    const missing = await sys<{ fk: string }>(`
      select c.conrelid::regclass || '.' || c.conname as fk
        from pg_constraint c join pg_namespace n on n.oid = c.connamespace
       where c.contype = 'f' and n.nspname = 'public'
         and not exists (select 1 from pg_index i where i.indrelid = c.conrelid
               and (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1] @> c.conkey
               and (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1] <@ c.conkey)`);
    expect(missing.map((m) => m.fk)).toEqual([]);
  });
});
