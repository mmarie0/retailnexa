import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { missingLimiterKey } from './rate-limit-policy';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}

describe('#19 env module boundary', () => {
  it('the server env module is guarded with server-only', () => {
    expect(readFileSync('src/lib/env.ts', 'utf8').startsWith("import 'server-only';")).toBe(true);
    expect(readFileSync('src/lib/env-public.ts', 'utf8')).not.toMatch(/SECRET|STRIPE_|CRON_/);
  });

  it('no client component imports the server env module', () => {
    const offenders = files('src').filter((f) => {
      const src = readFileSync(f, 'utf8');
      return /^\s*['"]use client['"]/.test(src) && /from ['"]@\/lib\/env['"]/.test(src);
    });
    expect(offenders).toEqual([]);
  });
});

describe('#19 rate limiter without its key', () => {
  it('is never silent in production', () => {
    expect(missingLimiterKey('production')).toEqual({ allow: true, reportError: true });
    expect(missingLimiterKey('preview').reportError).toBe(false);
    expect(missingLimiterKey(undefined).reportError).toBe(false);
  });
});
