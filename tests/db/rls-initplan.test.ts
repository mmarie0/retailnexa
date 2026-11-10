import { afterAll, describe, expect, it } from 'vitest';
import { closeDb, sys } from './helpers';

afterAll(closeDb);

describe('#23 RLS policies evaluate auth.uid() once per statement', () => {
  it('no public policy calls auth.uid() unwrapped', async () => {
    const rows = await sys<{ p: string }>(`
      select tablename || '.' || policyname as p from pg_policies
       where schemaname = 'public'
         and (coalesce(qual, '') || coalesce(with_check, '')) ~ 'auth\\.uid\\(\\)'
         and (coalesce(qual, '') || coalesce(with_check, '')) !~* 'select auth\\.uid\\(\\)'`);
    expect(rows.map((r) => r.p)).toEqual([]);
  });
});
