import { describe, expect, it } from 'vitest';
import { assignableRoles, canManageMember, effectivePermissions, ROLE_DEFAULTS } from './permissions';

describe('permissions', () => {
  it('overrides add and remove, but never reduce an owner', () => {
    const p = effectivePermissions('employee', [{ permission: 'reports.view', granted: true }, { permission: 'pos.use', granted: false }]);
    expect(p.has('reports.view')).toBe(true);
    expect(p.has('pos.use')).toBe(false);
    expect(effectivePermissions('owner', [{ permission: 'billing.manage', granted: false }]).has('billing.manage')).toBe(true);
  });
  it('ignores unknown permission keys', () => {
    expect(effectivePermissions('viewer', [{ permission: 'root.everything', granted: true }]).size).toBe(ROLE_DEFAULTS.viewer.length);
  });
  it('only lets non-owners assign roles below their own, and nobody invites an owner', () => {
    expect(assignableRoles('owner', 'invite')).not.toContain('owner');
    expect(assignableRoles('owner', 'change')).toContain('owner');
    expect(assignableRoles('admin', 'invite')).not.toContain('admin');
    expect(assignableRoles('manager', 'invite')).toEqual(['accountant', 'sales_rep', 'employee', 'viewer']);
  });
  it('blocks self-management and managing equal/higher ranks', () => {
    expect(canManageMember('owner', 'owner', true)).toBe(false);
    expect(canManageMember('owner', 'owner', false)).toBe(true);
    expect(canManageMember('admin', 'admin', false)).toBe(false);
    expect(canManageMember('admin', 'manager', false)).toBe(true);
  });
  it('keeps sensitive financial permissions away from employees and managers', () => {
    for (const p of ['profit.view', 'payroll.view', 'bank.view', 'billing.manage'] as const) {
      expect(ROLE_DEFAULTS.employee).not.toContain(p);
      expect(ROLE_DEFAULTS.manager).not.toContain(p);
    }
  });
});
