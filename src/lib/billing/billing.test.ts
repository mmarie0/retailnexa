import { describe, expect, it } from 'vitest';
import { computeAccess, entitlements, type SubscriptionStatus } from './access';
import { checkoutLineItems, monthlyTotalCents, normalizeSelection, productsFromPrices } from './plans';

const now = new Date('2026-11-09T12:00:00Z');
const day = 86_400_000;
const sub = (status: SubscriptionStatus, over = {}) => ({
  status, currentPeriodEnd: new Date(now.getTime() + 20 * day), trialEnd: null as Date | null, cancelAtPeriodEnd: false, ...over,
});

describe('computeAccess', () => {
  it('requires billing before first use', () => {
    expect(computeAccess({ orgStatus: 'active', subscription: null, now }).state).toBe('billing_only');
  });
  it('gives full access during trial and counts days left', () => {
    const a = computeAccess({ orgStatus: 'active', subscription: sub('trialing', { trialEnd: new Date(now.getTime() + 2.5 * day) }), now });
    expect(a).toMatchObject({ state: 'full', canWrite: true, trialDaysLeft: 3 });
  });
  it('gives a grace period after a failed payment, then read-only', () => {
    const inGrace = computeAccess({ orgStatus: 'active', subscription: sub('past_due', { currentPeriodEnd: new Date(now.getTime() - 3 * day) }), now });
    expect(inGrace).toMatchObject({ state: 'grace', canWrite: true });
    const late = computeAccess({ orgStatus: 'active', subscription: sub('past_due', { currentPeriodEnd: new Date(now.getTime() - 9 * day) }), now });
    expect(late).toMatchObject({ state: 'read_only', canWrite: false, canUseApp: true, canExport: true });
  });
  it('keeps canceled accounts readable and exportable (never destroyed)', () => {
    expect(computeAccess({ orgStatus: 'active', subscription: sub('canceled'), now })).toMatchObject({ state: 'read_only', canExport: true, canWrite: false });
  });
  it('org suspension overrides an active subscription but still allows export', () => {
    expect(computeAccess({ orgStatus: 'suspended', subscription: sub('active'), now })).toMatchObject({ state: 'suspended', canUseApp: false, canExport: true });
    expect(computeAccess({ orgStatus: 'closed', subscription: sub('active'), now })).toMatchObject({ canExport: false });
  });
  it('warns when cancellation is scheduled', () => {
    expect(computeAccess({ orgStatus: 'active', subscription: sub('active', { cancelAtPeriodEnd: true }), now }).notice?.tone).toBe('warning');
  });
});

describe('entitlements', () => {
  it('adds products and applies unexpired overrides only', () => {
    const e = entitlements(['retail'], [
      { feature: 'wholesale', enabled: true, expiresAt: new Date(now.getTime() + day) },
      { feature: 'ai', enabled: true, expiresAt: new Date(now.getTime() - day) },
    ], now);
    expect([...e].sort()).toEqual(['retail', 'wholesale']);
  });
});

describe('plans', () => {
  it('prices retail with extra locations plus wholesale', () => {
    const sel = normalizeSelection({ retail: true, wholesale: true, extraLocations: 2 });
    expect(monthlyTotalCents(sel)).toBe(12999 + 2 * 9999 + 14999);
  });
  it('clamps extra locations and drops them without retail', () => {
    expect(normalizeSelection({ retail: true, extraLocations: 500 }).extraLocations).toBe(49);
    expect(normalizeSelection({ retail: true, extraLocations: -3 }).extraLocations).toBe(0);
    expect(normalizeSelection({ wholesale: true, extraLocations: 4 }).extraLocations).toBe(0);
  });
  it('builds checkout line items and maps them back', () => {
    const prices = { retail: 'p_r', retailExtraLocation: 'p_rx', wholesale: 'p_w' };
    const items = checkoutLineItems({ retail: true, wholesale: true, extraLocations: 3 }, prices);
    expect(items).toEqual([{ price: 'p_r', quantity: 1 }, { price: 'p_rx', quantity: 3 }, { price: 'p_w', quantity: 1 }]);
    expect(productsFromPrices(items.map((i) => ({ priceId: i.price, quantity: i.quantity })), prices))
      .toEqual({ products: ['retail', 'wholesale'], extraLocations: 3 });
    expect(() => checkoutLineItems({ retail: false, wholesale: false, extraLocations: 0 }, prices)).toThrow();
  });
});
