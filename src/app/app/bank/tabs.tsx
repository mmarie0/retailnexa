import Link from 'next/link';
import { cx } from '@/components/ui';

const TABS = [
  { href: '/app/bank', label: 'Statement' },
  { href: '/app/bank/checks', label: 'Check register' },
  { href: '/app/bank/card-deposits', label: 'Card deposits' },
];

/** Bank sections (#109). */
export function BankTabs({ active }: { active: string }) {
  return (
    <nav aria-label="Bank" className="flex flex-wrap gap-1 self-start rounded-full bg-soft p-1">
      {TABS.map((t) => (
        <Link key={t.href} href={t.href} aria-current={active === t.href ? 'page' : undefined}
          className={cx('rounded-full px-3.5 py-1.5 text-sm font-semibold', active === t.href ? 'bg-card text-ink shadow-[var(--shadow-card)]' : 'text-muted hover:text-ink')}>{t.label}</Link>
      ))}
    </nav>
  );
}
