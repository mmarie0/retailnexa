import type { ReactNode } from 'react';
import Link from 'next/link';
import { Card, cx } from '@/components/ui';

export function Stat({ label, value, sub, href, tone }: { label: string; value: string; sub?: ReactNode; href?: string; tone?: 'late' }) {
  const body = (
    <>
      <p className="text-sm text-muted">{label}</p>
      <p className={cx('num text-2xl font-bold leading-tight', tone === 'late' && 'text-late')}>{value}</p>
      {sub && <p className="mt-0.5 text-sm text-muted">{sub}</p>}
    </>
  );
  return <Card>{href ? <Link href={href} className="block hover:opacity-80">{body}</Link> : body}</Card>;
}

/** "+4.2% vs last year" with an arrow glyph so direction isn't color-only. */
export function Change({ pct, vs }: { pct: number | null; vs: string }) {
  if (pct === null) return <span>No {vs} to compare</span>;
  const up = pct >= 0;
  return (
    <span className={up ? 'text-paid' : 'text-late'}>
      <span aria-hidden>{up ? '▲' : '▼'}</span> {up ? '+' : ''}{pct}% <span className="text-muted">vs {vs}</span>
    </span>
  );
}
