import Link from 'next/link';
import { cx } from '@/components/ui';

const TABS = [
  { href: '/app/profit', label: 'By month' },
  { href: '/app/profit/partners', label: 'Partners' },
  { href: '/app/profit/calculator', label: 'Calculator' },
  { href: '/app/profit/report', label: 'Report' },
  { href: '/app/profit/year-end', label: 'Year-end' },
];

export function ProfitTabs({ active }: { active: string }) {
  return (
    <nav aria-label="Profit" className="no-print flex flex-wrap gap-1 self-start rounded-full bg-soft p-1">
      {TABS.map((t) => (
        <Link key={t.href} href={t.href} aria-current={active === t.href ? 'page' : undefined}
          className={cx('rounded-full px-3.5 py-1.5 text-sm font-semibold', active === t.href ? 'bg-card text-ink shadow-[var(--shadow-card)]' : 'text-muted hover:text-ink')}>{t.label}</Link>
      ))}
    </nav>
  );
}
