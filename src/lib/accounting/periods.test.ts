import { describe, expect, it } from 'vitest';
import { periodRange } from './periods';

describe('periodRange', () => {
  it.each([
    ['this_month', '2026-11-10', '2026-11-01', '2026-11-10'],
    ['last_month', '2026-11-10', '2026-10-01', '2026-10-31'],
    ['last_month', '2026-01-15', '2025-12-01', '2025-12-31'],
    ['last_month', '2026-03-31', '2026-02-01', '2026-02-28'],
    ['this_quarter', '2026-11-10', '2026-10-01', '2026-11-10'],
    ['ytd', '2026-11-10', '2026-01-01', '2026-11-10'],
    ['last_year', '2026-11-10', '2025-01-01', '2025-12-31'],
  ] as const)('%s on %s', (key, today, from, to) => expect(periodRange(key, today)).toEqual({ from, to }));
});
