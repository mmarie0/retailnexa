/** In-app help (#116): what each part of RetailNexa does and how to use it. Shown only for pages the person can open. */
export interface HelpEntry { id: string; title: string; what: string; steps: string[]; tip?: string; href: string; perm?: string }

export const APP_HELP: HelpEntry[] = [
  { id: 'overview', title: 'Overview', what: 'Your month at a glance, and any dates you pick.', href: '/app', steps: [
    'Open Overview to see this month’s sales against last year, bills to pay and projected profit.',
    'Tap a date range (This week, Last 30 days, This year…) or pick Custom dates to compare with last year.',
    'Tap “Customize this page” to add, remove or reorder the boxes. Your layout is just for you.',
  ] },
  { id: 'bills', title: 'Bills and what’s due', what: 'Every bill, when it’s due and what’s left to pay.', href: '/app/bills', perm: 'bills.view', steps: [
    'Tap Add invoice to enter a bill: vendor, invoice number, date and amount.',
    'The Due calendar shows each day’s bills; set a monthly budget to see how you’re tracking.',
    'Open a bill to approve it and record a payment (put the check number in Reference).',
  ], tip: 'Set each vendor’s terms on Vendors so due dates fill in by themselves.' },
  { id: 'fixed', title: 'Fixed costs', what: 'Rent, power, card fees and other bills that repeat.', href: '/app/bills/recurring', perm: 'bills.view', steps: [
    'Use a quick-add chip (Rent, Utilities…) or add your own, with how often it repeats.',
    'Upcoming ones show on the Due calendar before the bill exists.',
  ] },
  { id: 'invoices', title: 'Invoice files', what: 'Keep photos and PDFs of vendor invoices in one place.', href: '/app/bills/invoices', perm: 'invoices.view', steps: [
    'Upload photos or PDFs; each is filed by month.', 'Link a file to its bill so it’s one tap away.',
  ] },
  { id: 'statements', title: 'Vendor statements', what: 'Check a vendor’s statement against your bills.', href: '/app/bills/statements', perm: 'bills.view', steps: [
    'Download the statement from the vendor as CSV (Date, Invoice #, Amount).',
    'Import it: each line is matched to a bill, and missing or different amounts are flagged.',
    'Add every missing invoice as a draft bill in one tap, then approve them.',
  ] },
  { id: 'bank', title: 'Bank, checks and card deposits', what: 'Match your bank statement, track checks and card deposits.', href: '/app/bank', perm: 'bank.view', steps: [
    'Import your bank statement (CSV or Excel) on the Statement tab and match each line.',
    'Check register shows which checks have cleared and which are outstanding.',
    'Card deposits checks that each day’s card sales arrived 1 to 5 days later, less fees.',
  ] },
  { id: 'balances', title: 'Location balances', what: 'What your other stores owe you, and what you owe them.', href: '/app/bills/balances', perm: 'bills.view', steps: [
    'Add a balance when a store borrows stock or covers a bill, with line items if you like.',
    'Mark it collected (or record part payments). The month-end check shows what’s left both ways.',
  ] },
  { id: 'sales', title: 'Daily sales', what: 'End-of-day totals from your POS.', href: '/app/sales', perm: 'sales.view', steps: [
    'Download the daily report from your POS and import it, or enter a day by hand.',
    'Look up any dates with From and To.',
  ], tip: 'RetailNexa can’t log in to your POS. Download the report there, then upload it here.' },
  { id: 'months', title: 'Months, history and categories', what: 'Your monthly sales report and three years side by side.', href: '/app/sales/history', perm: 'sales.view', steps: [
    'At month end, upload the POS monthly report (transactions, store card, points).',
    'Upload the category report on Categories to compare departments with last month and last year.',
  ] },
  { id: 'profit', title: 'Profit and partners', what: 'Profit by month, partner shares, and what cash you can take.', href: '/app/profit', perm: 'profit.view', steps: [
    'Profit by month = sales + tax − bills − payroll, with other stores’ balances. Enter a month by hand if your accountant closed it.',
    'On Partners, set each partner’s %, record a distribution and pay each share.',
    'The Calculator works out the cash you can take; Report prints a year report or one partner’s statement.',
  ] },
  { id: 'yearend', title: 'Year-end report', what: 'One Excel file for your accountant.', href: '/app/profit/year-end', perm: 'profit.view', steps: [
    'Pick the year and tap Download. You get a summary, sales tax, expenses by vendor, bills, payroll and more.',
  ] },
  { id: 'staff', title: 'Staff, schedule and payroll', what: 'Employees, weekly schedules and pay runs.', href: '/app/staff', perm: 'employees.view', steps: [
    'Add each employee with their pay and regular week.',
    'Plan the week on Schedule; copy last week to save time.',
    'Payroll fills in hours from the schedule. Pay runs are records only: no tax withholding is filed.',
  ] },
  { id: 'upkeep', title: 'Upkeep', what: 'Recurring store maintenance and what it costs.', href: '/app/upkeep', perm: 'maintenance.view', steps: [
    'Tap a suggested task (HVAC filters, pest control…) or add your own with how often it’s due.',
    'Mark it done with what it cost; overdue jobs float to the top.',
  ] },
  { id: 'team', title: 'Team and permissions', what: 'Invite people and choose what each can see.', href: '/app/settings/team', perm: 'members.view', steps: [
    'Invite by email and pick a role (manager, accountant, employee…).',
    'Limit a person to certain stores, or turn single permissions on or off.',
  ] },
];
