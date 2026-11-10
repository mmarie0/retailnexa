/**
 * Permission catalog and default role grants.
 *
 * The database (supabase/migrations/*_permissions_seed.sql) is the enforcement
 * point via RLS + private.has_permission(). This module mirrors it so the UI can
 * hide what a user cannot do. tests/db/permissions-sync.test.ts fails if the two
 * drift apart.
 */

export const MEMBER_ROLES = ['owner', 'admin', 'manager', 'accountant', 'sales_rep', 'employee', 'viewer'] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const ROLE_LABELS: Record<MemberRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  manager: 'Manager',
  accountant: 'Accountant',
  sales_rep: 'Sales rep',
  employee: 'Employee',
  viewer: 'Viewer',
};

export const ROLE_RANK: Record<MemberRole, number> = {
  owner: 100,
  admin: 80,
  manager: 60,
  accountant: 50,
  sales_rep: 40,
  employee: 30,
  viewer: 10,
};

export const PERMISSIONS = {
  'org.view': { label: 'View organization profile', sensitive: false },
  'org.manage': { label: 'Edit organization profile and grant support access', sensitive: false },
  'members.view': { label: 'View team members', sensitive: false },
  'members.manage': { label: 'Invite, disable and change roles of team members', sensitive: false },
  'roles.manage': { label: 'Grant or revoke individual permissions', sensitive: true },
  'locations.view': { label: 'View locations', sensitive: false },
  'locations.manage': { label: 'Create and edit locations and warehouses', sensitive: false },
  'billing.view': { label: 'View subscription and invoices', sensitive: false },
  'billing.manage': { label: 'Change plan, payment method, cancel or reactivate', sensitive: true },
  'audit.view': { label: 'View the audit log', sensitive: true },
  'data.export': { label: 'Export organization data', sensitive: true },
  'dashboard.view': { label: 'View the dashboard', sensitive: false },
  'sales.view': { label: 'View sales', sensitive: false },
  'sales.import': { label: 'Import sales reports', sensitive: false },
  'sales.edit': { label: 'Edit saved sales days', sensitive: false },
  'cash.view': { label: 'View cash entries', sensitive: false },
  'cash.create': { label: 'Record cash entries', sensitive: false },
  'cash.safe_view': { label: 'View safe counts and cash position', sensitive: true },
  'bills.view': { label: 'View bills', sensitive: false },
  'bills.create': { label: 'Enter bills', sensitive: false },
  'bills.approve': { label: 'Approve bills for payment', sensitive: true },
  'bills.pay': { label: 'Record bill payments', sensitive: true },
  'vendors.view': { label: 'View vendors', sensitive: false },
  'vendors.manage': { label: 'Create, edit and merge vendors', sensitive: false },
  'vendors.costs_view': { label: 'View vendor costs and price history', sensitive: true },
  'invoices.view': { label: 'View vendor invoices', sensitive: false },
  'invoices.upload': { label: 'Upload vendor invoices', sensitive: false },
  'accounting.view': { label: 'View ledger and financial statements', sensitive: true },
  'accounting.post': { label: 'Post journal entries', sensitive: true },
  'accounting.close': { label: 'Close accounting periods', sensitive: true },
  'bank.view': { label: 'View bank statements and reconciliation', sensitive: true },
  'reports.view': { label: 'View reports', sensitive: false },
  'reports.export': { label: 'Export reports', sensitive: true },
  'profit.view': { label: 'View profit figures', sensitive: true },
  'inventory.view': { label: 'View inventory', sensitive: false },
  'inventory.manage': { label: 'Receive, adjust, transfer and count inventory', sensitive: false },
  'pos.use': { label: 'Ring sales at the register', sensitive: false },
  'pos.refund': { label: 'Process returns and refunds', sensitive: false },
  'employees.view': { label: 'View employee profiles', sensitive: false },
  'employees.manage': { label: 'Manage employees and discipline records', sensitive: true },
  'payroll.view': { label: 'View payroll', sensitive: true },
  'payroll.manage': { label: 'Run and approve payroll', sensitive: true },
  'schedule.view': { label: 'View schedules', sensitive: false },
  'schedule.manage': { label: 'Edit schedules', sensitive: false },
  'tasks.view': { label: 'View tasks', sensitive: false },
  'tasks.manage': { label: 'Assign and approve tasks', sensitive: false },
  'tasks.complete': { label: 'Complete assigned tasks', sensitive: false },
  'maintenance.view': { label: 'View maintenance items', sensitive: false },
  'maintenance.complete': { label: 'Complete maintenance items', sensitive: false },
  'wholesale.catalog.manage': { label: 'Manage wholesale catalog and pricing', sensitive: false },
  'wholesale.customers.manage': { label: 'Manage wholesale customers and terms', sensitive: false },
  'wholesale.orders.view': { label: 'View wholesale orders', sensitive: false },
  'wholesale.orders.create': { label: 'Create wholesale orders', sensitive: false },
  'wholesale.orders.approve': { label: 'Approve wholesale orders', sensitive: false },
  'commissions.view': { label: 'View commissions', sensitive: true },
  'commissions.manage': { label: 'Configure and pay commissions', sensitive: true },
  'ai.ask': { label: 'Use Ask RetailNexa (limited to own permissions)', sensitive: false },
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export const ROLE_DEFAULTS: Record<MemberRole, readonly Permission[]> = {
  owner: ALL_PERMISSIONS,
  admin: ALL_PERMISSIONS.filter((p) => p !== 'billing.manage' && p !== 'roles.manage'),
  manager: [
    'org.view', 'members.view', 'locations.view', 'dashboard.view',
    'sales.view', 'sales.import', 'cash.view', 'cash.create',
    'bills.view', 'bills.create', 'vendors.view', 'invoices.view', 'invoices.upload',
    'reports.view', 'inventory.view', 'inventory.manage', 'pos.use', 'pos.refund',
    'employees.view', 'schedule.view', 'schedule.manage',
    'tasks.view', 'tasks.manage', 'tasks.complete', 'maintenance.view', 'maintenance.complete',
    'wholesale.orders.view', 'wholesale.orders.create', 'ai.ask',
  ],
  accountant: [
    'org.view', 'locations.view', 'dashboard.view', 'sales.view', 'cash.view',
    'bills.view', 'bills.create', 'bills.approve', 'vendors.view', 'vendors.costs_view',
    'invoices.view', 'invoices.upload', 'accounting.view', 'accounting.post', 'accounting.close',
    'bank.view', 'reports.view', 'reports.export', 'profit.view', 'payroll.view',
    'inventory.view', 'commissions.view', 'audit.view', 'data.export', 'billing.view', 'ai.ask',
  ],
  sales_rep: [
    'org.view', 'dashboard.view', 'inventory.view', 'wholesale.orders.view', 'wholesale.orders.create',
    'commissions.view', 'schedule.view', 'tasks.view', 'tasks.complete',
  ],
  employee: [
    'org.view', 'dashboard.view', 'cash.create', 'pos.use', 'schedule.view',
    'tasks.view', 'tasks.complete', 'maintenance.view', 'maintenance.complete',
  ],
  viewer: ['org.view', 'locations.view', 'dashboard.view', 'sales.view', 'reports.view'],
};

export function isMemberRole(value: unknown): value is MemberRole {
  return typeof value === 'string' && (MEMBER_ROLES as readonly string[]).includes(value);
}

export function isPermission(value: unknown): value is Permission {
  return typeof value === 'string' && value in PERMISSIONS;
}

/** Effective permissions from a role plus per-member overrides (owner cannot be reduced). */
export function effectivePermissions(
  role: MemberRole,
  overrides: ReadonlyArray<{ permission: string; granted: boolean }> = [],
): Set<Permission> {
  const set = new Set<Permission>(ROLE_DEFAULTS[role]);
  if (role === 'owner') return set;
  for (const o of overrides) {
    if (!isPermission(o.permission)) continue;
    if (o.granted) set.add(o.permission);
    else set.delete(o.permission);
  }
  return set;
}

/** Mirrors the DB rule: non-owners may only assign roles strictly below their own; nobody invites an owner. */
export function assignableRoles(callerRole: MemberRole, purpose: 'invite' | 'change'): MemberRole[] {
  return MEMBER_ROLES.filter((r) => {
    if (purpose === 'invite' && r === 'owner') return false;
    if (callerRole === 'owner') return true;
    return ROLE_RANK[r] < ROLE_RANK[callerRole];
  });
}

/** Whether callerRole may modify a member who currently has targetRole. */
export function canManageMember(callerRole: MemberRole, targetRole: MemberRole, isSelf: boolean): boolean {
  if (isSelf) return false;
  if (callerRole === 'owner') return true;
  return ROLE_RANK[targetRole] < ROLE_RANK[callerRole];
}
