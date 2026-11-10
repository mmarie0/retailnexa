'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { cx, buttonClass } from '@/components/ui';

export interface NavItem { href: string; label: string }

export function AppNav({ items }: { items: NavItem[] }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const active = (href: string) => (href === '/app' ? path === '/app' : path === href || path.startsWith(`${href}/`));
  const links = (
    <ul className="flex flex-col gap-0.5">
      {items.map((i) => (
        <li key={i.href}>
          <Link href={i.href} onClick={() => setOpen(false)} aria-current={active(i.href) ? 'page' : undefined}
            className={cx('block rounded-[10px] px-3 py-2 font-semibold', active(i.href) ? 'bg-card text-ink shadow-[var(--shadow-card)]' : 'text-muted hover:bg-card/60 hover:text-ink')}>
            {i.label}
          </Link>
        </li>
      ))}
    </ul>
  );
  return (
    <>
      <nav aria-label="App" className="hidden lg:block">{links}</nav>
      <div className="lg:hidden">
        <button className={buttonClass('secondary', 'sm')} aria-expanded={open} aria-controls="app-mobile-nav" onClick={() => setOpen((o) => !o)}>{open ? 'Close menu' : 'Menu'}</button>
        {open && <nav id="app-mobile-nav" aria-label="App" className="mt-3">{links}</nav>}
      </div>
    </>
  );
}
