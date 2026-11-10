import Link from 'next/link';
import { cx } from '@/components/ui';

const TABS = [
  { href: '/app/accounting', label: 'Chart of accounts' },
  { href: '/app/accounting/journal', label: 'Journal' },
  { href: '/app/accounting/profit-loss', label: 'Profit & loss' },
  { href: '/app/accounting/balance-sheet', label: 'Balance sheet' },
  { href: '/app/accounting/cash-flow', label: 'Cash flow' },
  { href: '/app/accounting/sales-tax', label: 'Sales tax' },
  { href: '/app/accounting/trial-balance', label: 'Trial balance' },
];

export function AccountingTabs({ active }: { active: string }) {
  return (
    <nav aria-label="Accounting" className="flex flex-wrap gap-1 rounded-full bg-soft p-1 self-start">
      {TABS.map((t) => (
        <Link key={t.href} href={t.href} aria-current={active === t.href ? 'page' : undefined}
          className={cx('rounded-full px-3.5 py-1.5 text-sm font-semibold', active === t.href ? 'bg-card text-ink shadow-[var(--shadow-card)]' : 'text-muted hover:text-ink')}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

export const TYPE_LABEL: Record<string, string> = {
  asset: 'Assets', liability: 'Liabilities', equity: 'Equity', revenue: 'Income', expense: 'Expenses',
};
export const TYPE_ORDER = ['asset', 'liability', 'equity', 'revenue', 'expense'];
