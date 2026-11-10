-- =============================================================================
-- Permission catalog + default role grants.
-- MUST stay in sync with src/lib/auth/permissions.ts (enforced by tests/db).
-- =============================================================================
insert into public.permissions (key, description, sensitive) values
  ('org.view',                    'View organization profile', false),
  ('org.manage',                  'Edit organization profile and grant support access', false),
  ('members.view',                'View team members', false),
  ('members.manage',              'Invite, disable and change roles of team members', false),
  ('roles.manage',                'Grant or revoke individual permissions', true),
  ('locations.view',              'View locations', false),
  ('locations.manage',            'Create and edit locations and warehouses', false),
  ('billing.view',                'View subscription and invoices', false),
  ('billing.manage',              'Change plan, payment method, cancel or reactivate', true),
  ('audit.view',                  'View the audit log', true),
  ('data.export',                 'Export organization data', true),
  ('dashboard.view',              'View the dashboard', false),
  ('sales.view',                  'View sales', false),
  ('sales.import',                'Import sales reports', false),
  ('sales.edit',                  'Edit saved sales days', false),
  ('cash.view',                   'View cash entries', false),
  ('cash.create',                 'Record cash entries', false),
  ('cash.safe_view',              'View safe counts and cash position', true),
  ('bills.view',                  'View bills', false),
  ('bills.create',                'Enter bills', false),
  ('bills.approve',               'Approve bills for payment', true),
  ('bills.pay',                   'Record bill payments', true),
  ('vendors.view',                'View vendors', false),
  ('vendors.manage',              'Create, edit and merge vendors', false),
  ('vendors.costs_view',          'View vendor costs and price history', true),
  ('invoices.view',               'View vendor invoices', false),
  ('invoices.upload',             'Upload vendor invoices', false),
  ('accounting.view',             'View ledger and financial statements', true),
  ('accounting.post',             'Post journal entries', true),
  ('accounting.close',            'Close accounting periods', true),
  ('bank.view',                   'View bank statements and reconciliation', true),
  ('reports.view',                'View reports', false),
  ('reports.export',              'Export reports', true),
  ('profit.view',                 'View profit figures', true),
  ('inventory.view',              'View inventory', false),
  ('inventory.manage',            'Receive, adjust, transfer and count inventory', false),
  ('pos.use',                     'Ring sales at the register', false),
  ('pos.refund',                  'Process returns and refunds', false),
  ('employees.view',              'View employee profiles', false),
  ('employees.manage',            'Manage employees and discipline records', true),
  ('payroll.view',                'View payroll', true),
  ('payroll.manage',              'Run and approve payroll', true),
  ('schedule.view',               'View schedules', false),
  ('schedule.manage',             'Edit schedules', false),
  ('tasks.view',                  'View tasks', false),
  ('tasks.manage',                'Assign and approve tasks', false),
  ('tasks.complete',              'Complete assigned tasks', false),
  ('maintenance.view',            'View maintenance items', false),
  ('maintenance.complete',        'Complete maintenance items', false),
  ('wholesale.catalog.manage',    'Manage wholesale catalog and pricing', false),
  ('wholesale.customers.manage',  'Manage wholesale customers and terms', false),
  ('wholesale.orders.view',       'View wholesale orders', false),
  ('wholesale.orders.create',     'Create wholesale orders', false),
  ('wholesale.orders.approve',    'Approve wholesale orders', false),
  ('commissions.view',            'View commissions', true),
  ('commissions.manage',          'Configure and pay commissions', true),
  ('ai.ask',                      'Use Ask RetailNexa (limited to own permissions)', false);

-- Owner implicitly has every permission (see private.has_permission); rows kept for clarity.
insert into public.role_permissions (role, permission)
select 'owner', key from public.permissions;

-- Admin: everything except billing changes and permission-level overrides.
insert into public.role_permissions (role, permission)
select 'admin', key from public.permissions where key not in ('billing.manage', 'roles.manage');

insert into public.role_permissions (role, permission)
select 'manager', unnest(array[
  'org.view', 'members.view', 'locations.view', 'dashboard.view',
  'sales.view', 'sales.import', 'cash.view', 'cash.create',
  'bills.view', 'bills.create', 'vendors.view', 'invoices.view', 'invoices.upload',
  'reports.view', 'inventory.view', 'inventory.manage', 'pos.use', 'pos.refund',
  'employees.view', 'schedule.view', 'schedule.manage',
  'tasks.view', 'tasks.manage', 'tasks.complete', 'maintenance.view', 'maintenance.complete',
  'wholesale.orders.view', 'wholesale.orders.create', 'ai.ask'
]);

insert into public.role_permissions (role, permission)
select 'accountant', unnest(array[
  'org.view', 'locations.view', 'dashboard.view', 'sales.view', 'cash.view',
  'bills.view', 'bills.create', 'bills.approve', 'vendors.view', 'vendors.costs_view',
  'invoices.view', 'invoices.upload', 'accounting.view', 'accounting.post', 'accounting.close',
  'bank.view', 'reports.view', 'reports.export', 'profit.view', 'payroll.view',
  'inventory.view', 'commissions.view', 'audit.view', 'data.export', 'billing.view', 'ai.ask'
]);

insert into public.role_permissions (role, permission)
select 'sales_rep', unnest(array[
  'org.view', 'dashboard.view', 'inventory.view', 'wholesale.orders.view', 'wholesale.orders.create',
  'commissions.view', 'schedule.view', 'tasks.view', 'tasks.complete'
]);

insert into public.role_permissions (role, permission)
select 'employee', unnest(array[
  'org.view', 'dashboard.view', 'cash.create', 'pos.use', 'schedule.view',
  'tasks.view', 'tasks.complete', 'maintenance.view', 'maintenance.complete'
]);

insert into public.role_permissions (role, permission)
select 'viewer', unnest(array[
  'org.view', 'locations.view', 'dashboard.view', 'sales.view', 'reports.view'
]);
