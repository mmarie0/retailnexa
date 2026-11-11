import { describe, expect, it } from 'vitest';
import { pageAll } from './page-all';

const source = (n: number) => async (a: number, b: number) => ({ data: Array.from({ length: Math.max(0, Math.min(n, b + 1) - a) }, (_, i) => a + i), error: null });

describe('pageAll (#169)', () => {
  it('reads every page and stops on a short page', async () => {
    const r = await pageAll<number>(source(2500));
    expect(r.length).toBe(2500);
    expect(r.truncated).toBe(false);
  });
  it('says when it stopped at the cap', async () => {
    const r = await pageAll<number>(source(5000), 3);
    expect(r.length).toBe(3000);
    expect(r.truncated).toBe(true);
  });
  it('an exact multiple of 1,000 is complete (one empty page read)', async () => {
    const r = await pageAll<number>(source(2000), 3);
    expect([r.length, r.truncated]).toEqual([2000, false]);
  });
  it('throws errors', async () => {
    await expect(pageAll(async () => ({ data: null, error: new Error('boom') }))).rejects.toThrow('boom');
  });
});
