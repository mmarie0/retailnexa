import { describe, expect, it } from 'vitest';
import { agingReport, bucketFor } from './aging';

describe('bucketFor', () => {
  it.each([
    ['2026-11-10', 'current'], ['2026-11-20', 'current'], ['2026-11-09', '1-30'], ['2026-10-11', '1-30'],
    ['2026-10-10', '31-60'], ['2026-09-11', '31-60'], ['2026-09-10', '61-90'], ['2026-08-12', '61-90'], ['2026-08-11', '90+'],
  ] as const)('due %s → %s', (due, b) => expect(bucketFor(due, '2026-11-10')).toBe(b));
});

describe('agingReport', () => {
  it('groups by vendor, sorts by amount owed, and totals each bucket', () => {
    const r = agingReport([
      { vendorId: 'a', vendorName: 'Acme', dueDate: '2026-11-20', openCents: 100 },
      { vendorId: 'b', vendorName: 'Bobbi', dueDate: '2026-10-01', openCents: 500 },
      { vendorId: 'a', vendorName: 'Acme', dueDate: '2026-07-01', openCents: 50 },
      { vendorId: 'c', vendorName: 'Zero', dueDate: '2026-07-01', openCents: 0 },
    ], '2026-11-10');
    expect(r.rows.map((x) => x.vendorName)).toEqual(['Bobbi', 'Acme']);
    expect(r.rows[1].buckets).toEqual({ current: 100, '1-30': 0, '31-60': 0, '61-90': 0, '90+': 50 });
    expect(r.totals['31-60']).toBe(500);
    expect(r.total).toBe(650);
  });
});
