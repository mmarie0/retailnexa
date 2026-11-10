import { describe, expect, it } from 'vitest';
import { todayIn } from './time';

describe('todayIn', () => {
  const t = Date.parse('2026-11-10T03:30:00Z');
  it('uses the business time zone for the calendar date', () => {
    expect(todayIn('UTC', t)).toBe('2026-11-10');
    expect(todayIn('America/Los_Angeles', t)).toBe('2026-11-09');
  });
  it('falls back to UTC for missing or unknown zones', () => {
    expect(todayIn(null, t)).toBe('2026-11-10');
    expect(todayIn('Not/AZone', t)).toBe('2026-11-10');
  });
});
