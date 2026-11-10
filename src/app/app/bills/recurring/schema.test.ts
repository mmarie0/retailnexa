import { describe, expect, it } from 'vitest';
import { recurringBillForm } from './schema';

const base = {
  vendor_id: '11111111-1111-4111-8111-111111111111', account_id: '22222222-2222-4222-8222-222222222222',
  name: 'Rent', frequency: 'monthly', next_date: '2026-08-31', due_days: '5',
};

describe('recurring bill form (#75)', () => {
  it('saves without a Store field (single-store business)', () => {
    const r = recurringBillForm.safeParse(base);
    expect(r.success).toBe(true);
    expect(r.success && r.data.location_id).toBeNull();
    expect(r.success && r.data.id).toBeNull();
  });

  it('still accepts a chosen store and rejects garbage', () => {
    expect(recurringBillForm.safeParse({ ...base, location_id: '33333333-3333-4333-8333-333333333333' }).success).toBe(true);
    expect(recurringBillForm.safeParse({ ...base, location_id: 'nope' }).success).toBe(false);
  });
});
