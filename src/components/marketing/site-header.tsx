'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Logo, buttonClass, cx } from '@/components/ui';

const NAV = [
  { href: '/features', label: 'Features' },
  { href: '/solutions/retail', label: 'Retail' },
  { href: '/solutions/wholesale', label: 'Wholesale' },
  { href: '/solutions/accounting', label: 'Accounting' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/demo', label: 'Live demo' },
];

export function SiteHeader() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-paper/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <Link href="/" aria-label="RetailNexa home"><Logo /></Link>
        <nav aria-label="Main" className="hidden items-center gap-1 lg:flex">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} aria-current={path === n.href ? 'page' : undefined}
              className={cx('rounded-lg px-3 py-2 text-[15px] font-semibold', path === n.href ? 'text-ink' : 'text-muted hover:text-ink')}>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="hidden items-center gap-2 lg:flex">
          <Link href="/login" className={buttonClass('ghost', 'sm')}>Log in</Link>
          <Link href="/signup" className={buttonClass('primary', 'sm')}>Start free trial</Link>
        </div>
        <button className={cx(buttonClass('secondary', 'sm'), 'lg:hidden')} aria-expanded={open} aria-controls="mobile-nav" onClick={() => setOpen((o) => !o)}>
          {open ? 'Close' : 'Menu'}
        </button>
      </div>
      {open && (
        <nav id="mobile-nav" aria-label="Main" className="border-t border-line px-4 pb-4 lg:hidden">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} onClick={() => setOpen(false)} className="block border-b border-line py-3 font-semibold">{n.label}</Link>
          ))}
          <div className="mt-3 flex gap-2">
            <Link href="/login" className={cx(buttonClass('secondary'), 'flex-1')}>Log in</Link>
            <Link href="/signup" className={cx(buttonClass('primary'), 'flex-1')}>Start free trial</Link>
          </div>
        </nav>
      )}
    </header>
  );
}
