import { describe, expect, it } from 'vitest';
import { safeNext } from './redirect';

describe('safeNext', () => {
  it('allows relative paths with queries', () => {
    expect(safeNext('/app/billing?x=1')).toBe('/app/billing?x=1');
    expect(safeNext('/onboarding?retail=true&locations=2')).toBe('/onboarding?retail=true&locations=2');
  });
  it('blocks absolute, protocol-relative and malformed targets', () => {
    for (const bad of ['https://evil.com', '//evil.com', '/\\evil.com', 'javascript:alert(1)', '/ok\r\nSet-Cookie:x', null, 42]) {
      expect(safeNext(bad)).toBe('/app');
    }
  });
  it('blocks targets that normalise into protocol-relative URLs (security review finding)', () => {
    for (const bad of ['/.//evil.com', '/%2e//evil.com', '/a/..//evil.com', '/./\\evil.com', '/%2E%2E//evil.com']) {
      const r = safeNext(bad);
      expect(r.startsWith('//'), `${bad} -> ${r}`).toBe(false);
      expect(new URL(r, 'https://app.example').origin).toBe('https://app.example');
    }
  });
});
