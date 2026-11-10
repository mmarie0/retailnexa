import { describe, expect, it, vi } from 'vitest';
import { CheckoutBlockedError, guardedCheckout, type CheckoutGuardDeps } from './checkout-guard';

function fakeDeps(over: Partial<CheckoutGuardDeps> = {}) {
  let lockedUntil = 0;
  let pending: string | null = null;
  const open = new Set<string>();
  const d: CheckoutGuardDeps & { open: Set<string> } = {
    open,
    listSubscriptionStatuses: vi.fn(async () => []),
    beginCheckout: vi.fn(async () => {
      if (lockedUntil > Date.now()) throw Object.assign(new Error('locked'), { code: '55P03' });
      lockedUntil = Date.now() + 60_000;
      return pending;
    }),
    finishCheckout: vi.fn(async (_org, id) => { lockedUntil = 0; pending = id ?? pending; }),
    expireSessionIfOpen: vi.fn(async (id) => { open.delete(id); }),
    ...over,
  };
  return d;
}

let n = 0;
const newSession = (d: { open: Set<string> }) => async () => {
  await new Promise((r) => setTimeout(r, 5));
  const id = `cs_${++n}`;
  d.open.add(id);
  return { id };
};

describe('guardedCheckout (#11)', () => {
  it('refuses when Stripe already has a live subscription, even if our mirror has none', async () => {
    const d = fakeDeps({ listSubscriptionStatuses: vi.fn(async () => ['canceled', 'active']) });
    await expect(guardedCheckout(d, 'org', 'cus', newSession(d))).rejects.toMatchObject({ reason: 'already_subscribed' });
    expect(d.beginCheckout).not.toHaveBeenCalled();
  });

  it('allows a new checkout when the only subscriptions have ended', async () => {
    const d = fakeDeps({ listSubscriptionStatuses: vi.fn(async () => ['canceled', 'incomplete_expired']) });
    await expect(guardedCheckout(d, 'org', 'cus', newSession(d))).resolves.toMatchObject({ id: expect.stringMatching(/^cs_/) });
  });

  it('two concurrent starts produce at most one open session', async () => {
    const d = fakeDeps();
    const results = await Promise.allSettled([
      guardedCheckout(d, 'org', 'cus', newSession(d)),
      guardedCheckout(d, 'org', 'cus', newSession(d)),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(CheckoutBlockedError);
    expect(rejected.reason.reason).toBe('in_progress');
    expect(d.open.size).toBe(1);
  });

  it('a later start expires the previous open session', async () => {
    const d = fakeDeps();
    const first = await guardedCheckout(d, 'org', 'cus', newSession(d));
    const second = await guardedCheckout(d, 'org', 'cus', newSession(d));
    expect(d.expireSessionIfOpen).toHaveBeenCalledWith(first.id);
    expect([...d.open]).toEqual([second.id]);
  });

  it('releases the lock when creating the session fails', async () => {
    const d = fakeDeps();
    await expect(guardedCheckout(d, 'org', 'cus', async () => { throw new Error('stripe down'); })).rejects.toThrow('stripe down');
    expect(d.finishCheckout).toHaveBeenCalledWith('org', null);
    await expect(guardedCheckout(d, 'org', 'cus', newSession(d))).resolves.toBeTruthy();
  });
});
