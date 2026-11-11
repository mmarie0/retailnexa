import type { ReactNode } from 'react';
import Link from 'next/link';
import { cx } from '@/components/ui';

/**
 * Overview tile, styled like the RetailNexa app: uppercase label, large number.
 * `block` turns it into a colour block (the hero number on a page).
 */
export function Stat({ label, value, sub, href, tone, block, hero }: {
  label: string; value: string; sub?: ReactNode; href?: string; tone?: 'late'; block?: 'blue' | 'indigo' | 'lav' | 'coral' | 'sunset'; hero?: boolean;
}) {
  const body = (
    <>
      <p className="text-[11px] font-bold uppercase tracking-[.08em] text-muted">{label}</p>
      <p className={cx('num font-medium leading-tight tracking-[-.02em]', hero ? 'text-[36px] max-[421px]:text-[31px]' : 'text-[22px]', tone === 'late' && !block && 'text-late')}>{value}</p>
      {sub && <p className="text-[12.5px] text-muted">{sub}</p>}
    </>
  );
  const cls = cx('flex min-w-0 flex-col gap-[3px] rounded-[18px] p-3.5', block ? `blk ${block}` : 'bg-card shadow-[var(--shadow-card)]', hero && 'p-[18px]');
  return href ? <Link href={href} className={cx(cls, 'hover:opacity-90')}>{body}</Link> : <div className={cls}>{body}</div>;
}

/** "+4.2% vs last year" with an arrow glyph so direction isn't color-only. */
export function Change({ pct, vs }: { pct: number | null; vs: string }) {
  if (pct === null) return <span>No {vs} to compare</span>;
  const up = pct >= 0;
  return (
    <span className={cx('delta', up ? 'text-paid' : 'text-late')}>
      <span aria-hidden>{up ? '▲' : '▼'}</span> {up ? '+' : ''}{pct}% <span className="text-muted">vs {vs}</span>
    </span>
  );
}

/** "+4.2%" with an arrow so direction isn't color-only; nothing when there's nothing to compare. */
export function Pct({ v }: { v: number | null }) {
  if (v === null) return null;
  return <span className={cx('delta whitespace-nowrap', v >= 0 ? 'text-paid' : 'text-late')}><span aria-hidden>{v >= 0 ? '▲' : '▼'}</span> {v >= 0 ? '+' : ''}{v}%</span>;
}
