import { describe, expect, it } from 'vitest';
import { factorName } from './mfa-client';

describe('two-factor setup name (#74)', () => {
  it('differs between attempts on the same day', () => {
    expect(factorName(new Date('2026-11-10T09:02:00Z'))).not.toBe(factorName(new Date('2026-11-10T09:03:00Z')));
  });
});
