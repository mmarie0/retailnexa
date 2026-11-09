import { describe, expect, it } from 'vitest';
import { safeNext } from './redirect';

describe('safeNext', () => {
  it('allows relative paths with queries', () => {
    expect(safeNext('/app/billing?x=1')).toBe('/app/billing?x=1');
  });
  it('blocks absolute, protocol-relative and malformed targets', () => {
    for (const bad of ['https://evil.com', '//evil.com', '/\\evil.com', 'javascript:alert(1)', '/ok\r\nSet-Cookie:x', null, 42]) {
      expect(safeNext(bad)).toBe('/app');
    }
  });
});
