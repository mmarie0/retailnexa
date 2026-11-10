'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cx } from '@/components/ui';
import { fabFor, locate, type IconKey, type NavArea, type NavPage } from './nav';

/* Icon paths copied from the RetailNexa app so the menus look the same. */
const PATHS: Record<IconKey, ReactNode> = {
  home: <path d="M4 11l8-6.5 8 6.5V20a1 1 0 01-1 1h-4.5v-6h-5v6H5a1 1 0 01-1-1z" />,
  bills: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 8h6M9 12h6M9 16h3" /></>,
  sales: <><path d="M4 20h16" /><path d="M7 16v-4M12 16V7M17 16v-6" /></>,
  staff: <><circle cx="9" cy="8" r="3.2" /><path d="M3.5 19.5c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5" /><circle cx="17" cy="9" r="2.5" /><path d="M16 14.6c2.4.1 4 1.7 4.5 4.4" /></>,
  upkeep: <path d="M14.5 5.5a4 4 0 00-5.2 5.1L4 15.9V20h4.1l5.3-5.3a4 4 0 005.1-5.2l-2.6 2.6-2.4-.6-.6-2.4z" />,
  invoice: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 8h6M9 12h6M9 16h3" /></>,
  calendar: <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 10h16M9 3v4M15 3v4" /></>,
  repeat: <><path d="M17 2l3 3-3 3" /><path d="M4 11V9a4 4 0 014-4h12M7 22l-3-3 3-3" /><path d="M20 13v2a4 4 0 01-4 4H4" /></>,
  doc: <><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></>,
  bank: <><path d="M3 10l9-6 9 6" /><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18" /></>,
  profit: <><path d="M4 17l5-5 4 4 7-7" /><path d="M15 9h5v5" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  card: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18M7 15h4" /></>,
  book: <><path d="M5 4h11a3 3 0 013 3v13H8a3 3 0 01-3-3z" /><path d="M5 17a3 3 0 013-3h11" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 00-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 00-2-1.2L14 3h-4l-.6 2.6a7 7 0 00-2 1.2l-2.3-.9-2 3.4 2 1.5A7 7 0 005 12a7 7 0 00.1 1.2l-2 1.5 2 3.4 2.3-.9a7 7 0 002 1.2L10 21h4l.6-2.6a7 7 0 002-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z" /></>,
  shield: <><path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z" /><path d="M9 12l2 2 4-4" /></>,
  team: <><circle cx="9" cy="8" r="3.2" /><path d="M3.5 19.5c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5" /><circle cx="17" cy="9" r="2.5" /><path d="M16 14.6c2.4.1 4 1.7 4.5 4.4" /></>,
  store: <><path d="M4 9l1.5-5h13L20 9" /><path d="M4 9h16v2a3 3 0 01-5.3 1.9A3 3 0 0112 14a3 3 0 01-2.7-1.1A3 3 0 014 11z" /><path d="M5 13.5V20h14v-6.5M10 20v-4h4v4" /></>,
  download: <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />,
  plus: <path d="M12 5v14M5 12h14" />,
  logout: <><path d="M15 4h3a2 2 0 012 2v12a2 2 0 01-2 2h-3" /><path d="M10 16l-4-4 4-4M6 12h10" /></>,
};
export function Icon({ k, className }: { k: IconKey; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={cx('size-[18px] flex-none', className)}>
      {PATHS[k]}
    </svg>
  );
}

function BrandMark() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" className="flex-none text-accent">
      <rect x="4" y="2.5" width="16" height="19" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 8h8M8 12h8M8 16h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

const soonPill = <span className="ml-auto rounded-full bg-soft px-2 py-0.5 text-[11px] font-bold text-muted">Soon</span>;

export function AppShell({ areas, more, orgName, orgSwitcher, email, today, fabPerms, children }: {
  areas: NavArea[];
  /** Bills → More pages this user may see; listed directly in the menu. */
  more: NavPage[];
  orgName: string;
  orgSwitcher?: ReactNode;
  email: string;
  today: string;
  /** Permissions for the add buttons (empty when the account is read-only). */
  fabPerms: string[];
  children: ReactNode;
}) {
  const path = usePathname();
  const here = locate(path, areas);
  const area = areas.find((a) => a.key === here.area) ?? areas[0];
  const fab = fabFor(path, (p) => fabPerms.includes(p));
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    const onClick = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onClick); };
  }, [menuOpen]);

  const firstHref = (a: NavArea) => a.pages.find((p) => p.href)?.href;

  return (
    <div className="mx-auto min-h-dvh max-w-[820px] px-4 pb-[170px]">
      <header className="sticky top-0 z-20 -mx-4 bg-paper px-4 pt-3">
        <div className="flex items-center justify-between gap-3">
          <div ref={menuRef} className="relative flex min-w-0 items-center gap-2.5">
            <button type="button" aria-label="Menu" aria-haspopup="menu" aria-expanded={menuOpen} aria-controls="navmenu" onClick={() => setMenuOpen((o) => !o)}
              className={cx('inline-flex flex-none items-center gap-1.5 rounded-xl px-2.5 py-[7px] text-[13.5px] font-bold shadow-[var(--shadow-card)]', menuOpen ? 'bg-accent text-white' : 'bg-card text-ink')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" className="size-[18px]"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
              <span className="max-[421px]:hidden">Menu</span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true" className={cx('size-3.5 transition-transform', menuOpen ? 'rotate-180 text-white' : 'text-muted')}><path d="M6 9l6 6 6-6" /></svg>
            </button>
            {menuOpen && (
              <nav id="navmenu" aria-label="All pages" onClick={(e) => { if ((e.target as HTMLElement).closest('a')) setMenuOpen(false); }} className="absolute left-0 top-[calc(100%+8px)] z-[45] max-h-[calc(100dvh-180px)] w-[min(300px,calc(100vw-32px))] overflow-y-auto rounded-2xl bg-card p-2 shadow-[0_14px_36px_rgba(40,60,140,.24)]">
                <div className="px-3 pb-2 pt-1.5">
                  <p className="truncate font-bold">{orgName}</p>
                  {orgSwitcher}
                </div>
                {areas.filter((a) => a.pages.length > 0).map((a) => (
                  <div key={a.key} className="border-t border-soft py-1">
                    <p className="flex items-center gap-1.5 px-3 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-[.08em] text-muted"><Icon k={a.icon} className="size-4 text-accent" />{a.label}</p>
                    {(a.key === 'bills' ? [...a.pages.filter((p) => p.key !== 'more'), ...more] : a.pages)
                      .map((p) => p.href ? (
                        <Link key={p.key} href={p.href} aria-current={path === p.href ? 'page' : undefined}
                          className={cx('flex items-center gap-2.5 rounded-[10px] px-3 py-[9px] text-[14.5px] font-medium hover:bg-soft', path === p.href && 'bg-accent-soft font-bold text-accent-strong')}>
                          <Icon k={p.icon} className="text-accent" />{p.label}
                        </Link>
                      ) : (
                        <span key={p.key} className="flex items-center gap-2.5 px-3 py-[9px] text-[14.5px] font-medium text-muted"><Icon k={p.icon} />{p.label}{soonPill}</span>
                      ))}
                  </div>
                ))}
                <div className="border-t border-soft py-1">
                  <p className="truncate px-3 pb-1 pt-1.5 text-[12.5px] text-muted" title={email}>{email}</p>
                  <Link href="/account/security" className="flex items-center gap-2.5 rounded-[10px] px-3 py-[9px] text-[14.5px] font-medium hover:bg-soft"><Icon k="shield" className="text-accent" />Two-factor authentication</Link>
                  <Link href="/onboarding?new=1" className="flex items-center gap-2.5 rounded-[10px] px-3 py-[9px] text-[14.5px] font-medium hover:bg-soft"><Icon k="plus" className="text-accent" />Add another business</Link>
                  <form action="/auth/signout" method="post">
                    <button className="flex w-full items-center gap-2.5 rounded-[10px] px-3 py-[9px] text-left text-[14.5px] font-medium hover:bg-soft"><Icon k="logout" className="text-accent" />Log out</button>
                  </form>
                </div>
              </nav>
            )}
            <Link href="/app" className="flex min-w-0 items-center gap-2 text-[22px] font-bold tracking-[-.02em] max-[421px]:text-xl"><BrandMark /><span className="truncate">RetailNexa</span></Link>
          </div>
          <span className="flex flex-none items-center gap-2.5">
            <span className="text-[13px] text-muted max-[421px]:hidden">{today}</span>
            <Link href="/help" className="inline-flex items-center gap-[7px] rounded-full bg-card py-[5px] pl-[5px] pr-3 text-[13.5px] font-bold text-accent-strong shadow-[var(--shadow-card)]">
              <span className="grid size-[22px] place-items-center rounded-full bg-accent text-[13px] font-extrabold text-white">?</span>Need help?
            </Link>
          </span>
        </div>
        {area.pages.length > 1 ? (
          <nav aria-label="Pages" className="mt-2 flex gap-1 overflow-x-auto [scrollbar-width:none]">
            {area.pages.map((p) => p.href ? (
              <Link key={p.key} href={p.href} aria-current={here.page === p.key ? 'page' : undefined}
                className={cx('whitespace-nowrap border-b-2 px-2.5 pb-2.5 pt-2', here.page === p.key ? 'border-accent font-semibold text-ink' : 'border-transparent font-medium text-muted hover:text-ink')}>
                {p.label}
              </Link>
            ) : (
              <span key={p.key} title="Coming soon" className="whitespace-nowrap border-b-2 border-transparent px-2.5 pb-2.5 pt-2 font-medium text-muted/60">{p.label}</span>
            ))}
          </nav>
        ) : <div className="h-3" />}
      </header>

      <main id="main" className="flex min-w-0 flex-col gap-[18px] pt-4">{children}</main>

      {fab && (
        <Link href={fab.href} data-fab className="fixed bottom-[calc(84px+env(safe-area-inset-bottom,0px))] right-4 z-30 flex items-center gap-2 rounded-full bg-accent px-[18px] py-3.5 text-[15px] font-semibold text-white shadow-[0_10px_24px_rgba(91,127,245,.45)]">
          <Icon k="plus" className="size-[18px]" />{fab.label}
        </Link>
      )}

      <nav aria-label="Sections" className="fixed inset-x-0 bottom-0 z-40 flex justify-center rounded-t-[22px] bg-card px-2 pb-[calc(6px+env(safe-area-inset-bottom,0px))] pt-1.5 shadow-[0_-6px_24px_rgba(40,110,190,.10)]">
        <div className="grid w-full max-w-[560px] grid-cols-5">
          {areas.filter((a) => a.bottom).map((a) => {
            const on = area.key === a.key;
            const href = firstHref(a);
            // A section with nothing this person can open stays visible (same five tabs as the app) but isn't a link (#123).
            if (!href) {
              return (
                <span key={a.key} aria-disabled="true" title="Not available for your role yet" className="flex flex-col items-center gap-[3px] rounded-xl px-0.5 py-1.5 text-[11.5px] font-semibold text-muted/50">
                  <Icon k={a.icon} className="size-[22px]" />{a.label}
                </span>
              );
            }
            return (
              <Link key={a.key} href={href} aria-current={on ? 'page' : undefined}
                className={cx('flex flex-col items-center gap-[3px] rounded-xl px-0.5 py-1.5 text-[11.5px] font-semibold', on ? 'bg-accent text-white' : 'text-muted hover:text-ink')}>
                <Icon k={a.icon} className="size-[22px]" />{a.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
