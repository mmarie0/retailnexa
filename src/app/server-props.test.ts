import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// #175: a server component can't pass a function to a client component (Next.js
// throws and the page returns 500). ActionForm's `render` takes a function, so
// only client components may use it; server pages use `quiet` instead.
const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? files(p) : p.endsWith('.tsx') ? [p] : [];
});

describe('server components never pass functions to ActionForm (#175)', () => {
  it('no `render=` on ActionForm outside "use client" files', () => {
    const bad = files(join(process.cwd(), 'src/app')).filter((f) => {
      const s = readFileSync(f, 'utf8');
      return !/^['"]use client['"]/m.test(s) && /<ActionForm\b[^>]*\brender=/.test(s);
    });
    expect(bad).toEqual([]);
  });
});
