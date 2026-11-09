/** Help center articles. Plain paragraphs; keep each article about one task. */
export interface HelpArticle {
  slug: string;
  title: string;
  summary: string;
  category: 'Getting started' | 'Team and access' | 'Billing' | 'Your data';
  body: string[];
}

export const HELP_ARTICLES: HelpArticle[] = [
  {
    slug: 'start-your-trial', category: 'Getting started', title: 'Create your account and start the free trial',
    summary: 'Sign up, name your business and add a payment method.',
    body: [
      'Go to Start free trial and enter your name, email and a password of at least 10 characters. Confirm your email from the message we send you.',
      'Next, enter your business name, choose retail, wholesale or both, and name your first location. You can add more locations later from Settings → Locations.',
      'On the billing page, choose your plan and add a card through Stripe’s secure checkout. You pay nothing today. Your first payment is taken when the 7-day trial ends unless you cancel before then.',
    ],
  },
  {
    slug: 'invite-your-team', category: 'Team and access', title: 'Invite your team and choose their roles',
    summary: 'Give managers, employees, sales reps and your accountant their own logins.',
    body: [
      'Open Settings → Team and choose Invite someone. Enter their email and pick a role. They get a link that is valid for 7 days and only works for that email address.',
      'Roles control what each person can see. Employees never see profit, payroll, bank statements or vendor costs. Managers run the floor but cannot change billing. Accountants see the books but cannot change the team.',
      'You can only give roles below your own, and nobody can change their own access. Every change is recorded in the audit log.',
    ],
  },
  {
    slug: 'roles-and-permissions', category: 'Team and access', title: 'What each role can do',
    summary: 'Owner, admin, manager, accountant, sales rep, employee and viewer explained.',
    body: [
      'Owner: everything, including billing and permission changes. Every business must keep at least one owner.',
      'Admin: everything except billing changes and per-person permission adjustments.',
      'Manager: sales, cash, bills, inventory, schedules and tasks, without profit, payroll or bank access.',
      'Accountant: the books, bills, bank, payroll figures, reports and exports, without team management.',
      'Sales rep: wholesale ordering and their own commissions. Employee: register, cash entries, schedule and tasks. Viewer: read-only sales and reports.',
      'Owners can switch individual permissions on or off for a person from Settings → Team.',
    ],
  },
  {
    slug: 'locations', category: 'Getting started', title: 'Add stores and warehouses',
    summary: 'Run several locations under one account.',
    body: [
      'Open Settings → Locations and choose Add location. Pick store, warehouse or office and enter the address and time zone.',
      'Locations can be turned off but not deleted, so their history stays intact.',
      'On the Retail plan, each store beyond the first adds to your monthly price. Update your plan from the billing page.',
    ],
  },
  {
    slug: 'manage-billing', category: 'Billing', title: 'Update your card, see invoices, cancel or reactivate',
    summary: 'Everything about your subscription lives on the billing page.',
    body: [
      'Owners open Billing from the menu. Manage payment method opens Stripe’s secure portal, where you can change your card and download past invoices.',
      'Cancel subscription stops renewal at the end of the current period. Until then nothing changes. You can undo it with Resume subscription.',
      'After a subscription ends, your account becomes read-only. Your records are kept and you can export them. Choose Reactivate on the billing page to subscribe again; reactivated accounts do not get a second free trial.',
      'If a payment fails, you keep full access for 7 days while Stripe retries. Update your card to avoid interruption.',
    ],
  },
  {
    slug: 'export-your-data', category: 'Your data', title: 'Export your data',
    summary: 'Download your records at any time, including after cancelling.',
    body: [
      'Owners and accountants can open Settings → Export data and download a file of your business records.',
      'Exports stay available while your account is read-only after cancellation.',
    ],
  },
  {
    slug: 'support-access', category: 'Your data', title: 'Let RetailNexa support look at your account',
    summary: 'Support staff cannot see your business records unless you allow it.',
    body: [
      'Our support team can see your business name, plan and team list so they can help with billing and logins. They cannot see your sales, bills or books.',
      'If you want help with your records, open Settings → Support access and grant access for 1 to 72 hours with a short reason. You can revoke it at any time, and it expires on its own.',
      'Every grant, revoke and support action is recorded in your audit log.',
    ],
  },
];

export function findArticle(slug: string) {
  return HELP_ARTICLES.find((a) => a.slug === slug) ?? null;
}
