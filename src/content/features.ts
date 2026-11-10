/**
 * Single source of truth for what the marketing site says the product does.
 * `status` MUST reflect what is actually shipped and tested — update it when a
 * module is released (see docs/PROJECT_STATUS.md). Pages render an
 * "In development" badge for anything not yet available.
 */
export type FeatureStatus = 'available' | 'in_development';

export interface Feature {
  title: string;
  body: string;
  status: FeatureStatus;
}

export const RETAIL_FEATURES: Feature[] = [
  { title: 'Daily sales at a glance', body: 'Today, yesterday and month to date, compared with the same weekday last year. Import register reports from your POS as CSV.', status: 'in_development' },
  { title: 'Bills and vendors', body: 'Every vendor’s balance, terms, invoices and price history in one profile. Match the names that show up on your bank statement.', status: 'in_development' },
  { title: 'Inventory and labels', body: 'Products with SKUs, UPCs and variants. Receive stock, count shelves, print barcode labels and see what needs reordering.', status: 'in_development' },
  { title: 'Register (POS)', body: 'Scan, search or tap shortcut buttons. Cash and card, returns, discounts and drawer counts.', status: 'in_development' },
  { title: 'Staff, schedules and tasks', body: 'Shifts, time clock, timesheets and payroll prep. Assign tasks with photo proof and manager sign-off.', status: 'in_development' },
  { title: 'Multiple stores', body: 'Run several locations under one account and see them separately or combined.', status: 'available' },
];

export const WHOLESALE_FEATURES: Feature[] = [
  { title: 'Catalog with case packs', body: 'Sell by piece, pack or case. Set minimums and increments such as 6, 12, 24 or 48 per item.', status: 'in_development' },
  { title: 'Customer pricing and credit', body: 'Price tiers, negotiated prices, payment terms, credit limits and statements for each customer.', status: 'in_development' },
  { title: 'Sales rep portal', body: 'Reps see their own customers and orders, place orders on the road and track commission.', status: 'in_development' },
  { title: 'Ordering portal', body: 'A branded ordering page your customers use to search, reorder and save carts.', status: 'in_development' },
  { title: 'Warehouse operations', body: 'Purchase orders, receiving, picking, packing, partial shipments, backorders and returns.', status: 'in_development' },
  { title: 'Multiple warehouses', body: 'Track each warehouse separately under one account.', status: 'available' },
];

export const ACCOUNTING_FEATURES: Feature[] = [
  { title: 'Double-entry ledger', body: 'Chart of accounts, journal entries and a trial balance that always balances.', status: 'in_development' },
  { title: 'Real financial statements', body: 'Profit and loss, balance sheet and cash flow, on a cash or accrual basis.', status: 'in_development' },
  { title: 'Payables and receivables', body: 'Partial payments, credit memos, refunds and aging reports.', status: 'in_development' },
  { title: 'Bank reconciliation', body: 'Import statements and match every line to a bill, deposit or transfer.', status: 'in_development' },
  { title: 'Accountant access', body: 'Invite your accountant with their own role. Every change is recorded in the audit log.', status: 'available' },
];

export const PLATFORM_FEATURES: Feature[] = [
  { title: 'Roles and permissions', body: 'Owner, admin, manager, accountant, sales rep, employee and viewer, with per-person adjustments.', status: 'available' },
  { title: 'Audit log', body: 'A permanent record of who changed what, which no one can edit or delete.', status: 'available' },
  { title: 'Your data, exportable', body: 'Export your records at any time, including after you cancel.', status: 'available' },
  { title: 'Ask RetailNexa', body: 'Ask questions about your numbers in plain English, with links back to the records behind every answer.', status: 'in_development' },
];
