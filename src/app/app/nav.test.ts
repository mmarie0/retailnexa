import { describe, expect, it } from 'vitest';
import { ROLE_DEFAULTS } from '@/lib/auth/permissions';
import { fabFor, locate, visibleAreas, visibleMore } from './nav';

describe('app navigation (copied from the RetailNexa app)', () => {
  it('puts each page under the right bottom tab and page tab', () => {
    expect(locate('/app')).toEqual({ area: 'home', page: 'home' });
    expect(locate('/app/bills')).toEqual({ area: 'bills', page: 'due' });
    expect(locate('/app/bills/new')).toEqual({ area: 'bills', page: 'due' });
    expect(locate('/app/bills/123e4567-e89b-12d3-a456-426614174000')).toEqual({ area: 'bills', page: 'due' });
    expect(locate('/app/bills/recurring')).toEqual({ area: 'bills', page: 'more' });
    expect(locate('/app/bills/list')).toEqual({ area: 'bills', page: 'due' });
    expect(locate('/app/bills/reps')).toEqual({ area: 'bills', page: 'more' });
    expect(locate('/app/bills/invoices')).toEqual({ area: 'bills', page: 'invoices' });
    expect(locate('/app/bank')).toEqual({ area: 'bills', page: 'more' });
    expect(locate('/app/vendors')).toEqual({ area: 'bills', page: 'vendors' });
    expect(locate('/app/sales/import')).toEqual({ area: 'sales', page: 'daily' });
    expect(locate('/app/accounting/profit-loss')).toEqual({ area: 'books', page: 'accounting' });
    expect(locate('/app/profit')).toEqual({ area: 'sales', page: 'profit' });
    expect(locate('/app/profit/partners')).toEqual({ area: 'sales', page: 'profit' });
    expect(locate('/app/bills/balances')).toEqual({ area: 'bills', page: 'more' });
    expect(locate('/app/accounting/balance-sheet')).toEqual({ area: 'books', page: 'accounting' });
    expect(locate('/app/settings/team')).toEqual({ area: 'business', page: 'team' });
    expect(locate('/app/settings/export')).toEqual({ area: 'books', page: 'export' });
    expect(locate('/app/staff')).toEqual({ area: 'staff', page: 'team' });
  });

  it('hides pages the user may not see but keeps "Soon" pages and the five bottom tabs', () => {
    const cashier = (p: string) => ['sales.view', 'sales.import', 'cash.create'].includes(p);
    const areas = visibleAreas(cashier);
    expect(areas.filter((a) => a.bottom).map((a) => a.key)).toEqual(['home', 'bills', 'sales', 'staff', 'upkeep']);
    expect(areas.find((a) => a.key === 'bills')!.pages.map((p) => p.key)).toEqual([]);
    expect(areas.find((a) => a.key === 'sales')!.pages.map((p) => p.key)).toEqual(['daily', 'history', 'categories']);
    expect(areas.some((a) => a.key === 'books')).toBe(false);
    expect(visibleMore(cashier).map((p) => p.key)).toEqual(['statements', 'deposits']);
  });

  it('role defaults: every bottom tab either opens a page the role may see or is disabled (#123)', () => {
    for (const role of Object.keys(ROLE_DEFAULTS) as (keyof typeof ROLE_DEFAULTS)[]) {
      const perms = new Set<string>(ROLE_DEFAULTS[role]);
      const areas = visibleAreas((p) => role === 'owner' || perms.has(p));
      expect(areas.filter((a) => a.bottom).map((a) => a.key), role).toEqual(['home', 'bills', 'sales', 'staff', 'upkeep']);
      const staff = areas.find((a) => a.key === 'staff')!;
      expect(staff.pages.some((p) => p.href), `${role} staff`).toBe(['employees.view', 'schedule.view', 'payroll.view'].some((p) => role === 'owner' || perms.has(p)));
      const upkeep = areas.find((a) => a.key === 'upkeep')!;
      expect(upkeep.pages.some((p) => p.href), `${role} upkeep`).toBe(['maintenance.view', 'tasks.view'].some((p) => role === 'owner' || perms.has(p)));
    }
    const viewer = visibleAreas((p) => (ROLE_DEFAULTS.viewer as readonly string[]).includes(p));
    expect(viewer.find((a) => a.key === 'bills')!.pages.some((p) => p.href)).toBe(false);
  });

  it('shows the add button only to people who can use it', () => {
    expect(fabFor('/app/bills', () => true)).toEqual({ label: 'Add invoice', href: '/app/bills/new' });
    expect(fabFor('/app/bills', () => false)).toBeNull();
    expect(fabFor('/app/bills/recurring', () => true)?.label).toBe('Add fixed cost');
    expect(fabFor('/app/sales', () => true)?.label).toBe('Add daily report');
    expect(fabFor('/app/accounting', () => true)).toBeNull();
  });
});
