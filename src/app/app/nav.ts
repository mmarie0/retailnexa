/**
 * App navigation, copied from the owner's RetailNexa app: five bottom tabs
 * (Overview, Bills, Sales, Staff, Upkeep), page tabs under the header for the
 * current section, a grouped "Menu" with every page, and one add button per
 * page. Pages that aren't built yet stay in the menu marked "Soon" (not links),
 * so the layout matches without promising features (#100).
 *
 * Pure data + functions so the shell and its tests share one source.
 */

export type AreaKey = 'home' | 'bills' | 'sales' | 'staff' | 'upkeep' | 'books' | 'business';
export type IconKey =
  | 'home' | 'bills' | 'sales' | 'staff' | 'upkeep' | 'invoice' | 'calendar' | 'repeat' | 'doc' | 'bank'
  | 'profit' | 'clock' | 'card' | 'book' | 'settings' | 'shield' | 'team' | 'store' | 'download' | 'plus' | 'logout';

export interface NavPage {
  key: string;
  label: string;
  href?: string; // missing = not built yet ("Soon")
  icon: IconKey;
  /** Permission that must be held for the page to show at all. */
  perm?: string | string[];
  /** Extra path prefixes that belong to this page (for highlighting). */
  match?: string[];
}

export interface NavArea {
  key: AreaKey;
  label: string;
  icon: IconKey;
  /** Shown as one of the five bottom tabs. */
  bottom: boolean;
  pages: NavPage[];
}

/** Tabs for Bills → More (same order as the live app). */
export const BILLS_MORE: NavPage[] = [
  { key: 'reps', label: 'Rep schedule', icon: 'calendar' },
  { key: 'fixed', label: 'Fixed costs', href: '/app/bills/recurring', icon: 'repeat', perm: 'bills.view' },
  { key: 'statements', label: 'Vendor statements', icon: 'doc' },
  { key: 'bank', label: 'Bank', href: '/app/bank', icon: 'bank', perm: 'bank.view' },
  { key: 'aging', label: 'What you owe by age', href: '/app/bills/aging', icon: 'clock', perm: 'bills.view' },
  { key: 'deposits', label: 'Deposits & payments', href: '/app/deposits', icon: 'card', perm: ['accounting.post', 'cash.create', 'accounting.view'] },
];

export const AREAS: NavArea[] = [
  { key: 'home', label: 'Overview', icon: 'home', bottom: true, pages: [{ key: 'home', label: 'Overview', href: '/app', icon: 'home' }] },
  {
    key: 'bills', label: 'Bills', icon: 'bills', bottom: true,
    pages: [
      { key: 'due', label: 'Due', href: '/app/bills', icon: 'bills', perm: 'bills.view', match: ['/app/bills/new'] },
      { key: 'vendors', label: 'Vendors', href: '/app/vendors', icon: 'invoice', perm: 'vendors.view' },
      { key: 'invoices', label: 'Invoices', icon: 'invoice' },
      { key: 'more', label: 'More', href: '/app/bills/more', icon: 'doc', perm: 'bills.view',
        match: ['/app/bills/recurring', '/app/bills/aging', '/app/bank', '/app/deposits'] },
    ],
  },
  {
    key: 'sales', label: 'Sales', icon: 'sales', bottom: true,
    pages: [
      { key: 'daily', label: 'Daily', href: '/app/sales', icon: 'sales', perm: 'sales.view', match: ['/app/sales/import'] },
      { key: 'history', label: 'Months & history', icon: 'calendar' },
      { key: 'profit', label: 'Profit', href: '/app/accounting/profit-loss', icon: 'profit', perm: 'accounting.view' },
      { key: 'categories', label: 'Categories', icon: 'doc' },
    ],
  },
  {
    key: 'staff', label: 'Staff', icon: 'staff', bottom: true,
    pages: [
      { key: 'team', label: 'Employees', href: '/app/staff', icon: 'staff', perm: ['employees.view', 'schedule.view', 'payroll.view'] },
      { key: 'schedule', label: 'Schedule', icon: 'calendar' },
      { key: 'payroll', label: 'Payroll', icon: 'card' },
      { key: 'stubs', label: 'Paystubs', icon: 'doc' },
      { key: 'labor', label: 'Labor %', icon: 'profit' },
    ],
  },
  { key: 'upkeep', label: 'Upkeep', icon: 'upkeep', bottom: true, pages: [{ key: 'tasks', label: 'Maintenance', href: '/app/upkeep', icon: 'upkeep', perm: ['maintenance.view', 'tasks.view'] }] },
  {
    key: 'books', label: 'Books', icon: 'book', bottom: false,
    pages: [
      { key: 'accounting', label: 'Reports', href: '/app/accounting', icon: 'book', perm: 'accounting.view',
        match: ['/app/accounting/balance-sheet', '/app/accounting/cash-flow', '/app/accounting/journal', '/app/accounting/sales-tax', '/app/accounting/trial-balance'] },
      { key: 'audit', label: 'Audit log', href: '/app/audit', icon: 'shield', perm: 'audit.view' },
      { key: 'export', label: 'Export data', href: '/app/settings/export', icon: 'download', perm: 'data.export' },
    ],
  },
  {
    key: 'business', label: 'Business', icon: 'settings', bottom: false,
    pages: [
      { key: 'profile', label: 'Business profile', href: '/app/settings', icon: 'settings', perm: 'org.view' },
      { key: 'locations', label: 'Locations', href: '/app/settings/locations', icon: 'store', perm: 'locations.view' },
      { key: 'team', label: 'Team', href: '/app/settings/team', icon: 'team', perm: 'members.view' },
      { key: 'billing', label: 'Billing', href: '/app/billing', icon: 'card', perm: 'billing.view' },
      { key: 'support', label: 'Support access', href: '/app/settings/support-access', icon: 'shield', perm: 'org.manage' },
    ],
  },
];

/** Label for the floating add button on each page (as in the live app). */
export const FAB: Record<string, { label: string; href: string; perm: string } | undefined> = {
  due: { label: 'Add invoice', href: '/app/bills/new', perm: 'bills.create' },
  vendors: { label: 'Add vendor', href: '/app/vendors#add', perm: 'vendors.manage' },
  daily: { label: 'Add daily report', href: '/app/sales/import', perm: 'sales.import' },
  fixed: { label: 'Add fixed cost', href: '/app/bills/recurring#add', perm: 'bills.create' },
  bank: { label: 'Upload bank statement', href: '/app/bank#import', perm: 'accounting.post' },
};

const allowed = (p: NavPage, can: (perm: string) => boolean) =>
  !p.perm || (Array.isArray(p.perm) ? p.perm.some(can) : can(p.perm));

/** Areas with only the pages this user may see (unbuilt "Soon" pages always show). */
export function visibleAreas(can: (perm: string) => boolean): NavArea[] {
  // The five bottom tabs always show (same layout as the app); a tab with no page this person may open is shown disabled.
  return AREAS.map((a) => ({ ...a, pages: a.pages.filter((p) => allowed(p, can)) })).filter((a) => a.bottom || a.pages.length > 0);
}

export function visibleMore(can: (perm: string) => boolean): NavPage[] {
  return BILLS_MORE.filter((p) => allowed(p, can));
}

const under = (path: string, base: string) => path === base || path.startsWith(`${base}/`);

/**
 * The section and page for a path: an exact page link wins, then a page's
 * `match` list, then the longest page link that the path is under.
 */
export function locate(path: string, areas: NavArea[] = AREAS): { area: AreaKey; page: string | null } {
  const all = areas.flatMap((a) => a.pages.map((p) => ({ a: a.key, p })));
  const exact = all.find(({ p }) => p.href === path);
  if (exact) return { area: exact.a, page: exact.p.key };
  const matched = all.find(({ p }) => (p.match ?? []).some((m) => under(path, m)));
  if (matched) return { area: matched.a, page: matched.p.key };
  const prefix = all.filter(({ p }) => p.href && p.href !== '/app' && under(path, p.href)).sort((x, y) => y.p.href!.length - x.p.href!.length)[0];
  return prefix ? { area: prefix.a, page: prefix.p.key } : { area: 'home', page: null };
}

/** The add button for the current page, if the user may use it. */
export function fabFor(path: string, can: (perm: string) => boolean): { label: string; href: string } | null {
  const more = BILLS_MORE.find((p) => p.href && (path === p.href || path.startsWith(`${p.href}/`)));
  const key = more?.key ?? locate(path).page;
  const f = key ? FAB[key] : undefined;
  return f && can(f.perm) ? { label: f.label, href: f.href } : null;
}
