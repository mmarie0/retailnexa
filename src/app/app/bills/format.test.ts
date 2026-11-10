import { describe, expect, it } from 'vitest';
import { daysOverdue } from './format';

describe('daysOverdue', () => {
  it('counts whole days after the due date', () => {
    expect(daysOverdue('2026-11-01', '2026-11-01')).toBe(0);
    expect(daysOverdue('2026-11-01', '2026-10-25')).toBe(0);
    expect(daysOverdue('2026-11-01', '2026-11-04')).toBe(3);
    expect(daysOverdue('2026-02-28', '2026-03-01')).toBe(1);
  });
});
