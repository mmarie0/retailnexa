import { describe, expect, it } from 'vitest';
import { addDays, isFeatureKey, overrideUntilError } from './feature-keys';

describe('feature override keys (#71)', () => {
  it('only accepts known keys', () => {
    expect(isFeatureKey('billing.exempt')).toBe(true);
    expect(isFeatureKey('Billing.exempt')).toBe(false);
    expect(isFeatureKey('anything')).toBe(false);
  });

  it('requires an end date within 89 days for a billing waiver only', () => {
    const today = '2026-11-10';
    expect(overrideUntilError('billing.exempt', true, null, today)).toMatch(/needs an end date/);
    expect(overrideUntilError('billing.exempt', true, addDays(today, 89), today)).toBeNull();
    expect(overrideUntilError('billing.exempt', true, addDays(today, 90), today)).toMatch(/at most 89 days/);
    expect(overrideUntilError('billing.exempt', false, null, today)).toBeNull();
    expect(overrideUntilError('wholesale', true, null, today)).toBeNull();
    expect(overrideUntilError('wholesale', true, '2026-11-01', today)).toMatch(/from today/);
  });
});
