'use client';
import { useState } from 'react';
import { formatMoney } from '@/lib/billing/plans';

type Point = { ym: string; cents: number | null; lastYearCents: number | null; projected: boolean };
const CUR = '#3f63de', LY = '#e07b39';
const mon = (ym: string, o: Intl.DateTimeFormatOptions) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', ...o });

/** Net sales by month, this year beside last year (#108). This month's bar is the projection when there is one. */
export function TrendChart({ points, title = '12-month sales trend' }: { points: Point[]; title?: string }) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(1, ...points.flatMap((p) => [p.cents ?? 0, p.lastYearCents ?? 0]));
  const anyLy = points.some((p) => p.lastYearCents);
  const h = (v: number | null) => (v ? Math.max(1.5, (v / max) * 100) : 0);
  const tip = (p: Point) => `${mon(p.ym, { month: 'long', year: 'numeric' })}: ${p.cents === null ? 'no sales' : formatMoney(p.cents)}${p.projected ? ' projected' : ''}${anyLy ? ` · last year ${p.lastYearCents === null ? '—' : formatMoney(p.lastYearCents)}` : ''}`;

  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-bold">{title}</span>
        <span className="text-sm text-muted" aria-live="polite">{active !== null ? tip(points[active]) : 'Hover a month for its totals'}</span>
      </figcaption>
      <div className="relative mt-3 h-40" onMouseLeave={() => setActive(null)}>
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-line" />
        <span aria-hidden className="pointer-events-none absolute -top-2.5 right-0 bg-card pl-1 text-xs text-muted">{formatMoney(max)}</span>
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed border-line" />
        <div aria-hidden className="absolute inset-x-0 bottom-0 border-t border-muted/40" />
        <ol className="relative flex h-full items-end gap-1.5">
          {points.map((p, i) => (
            <li key={p.ym} tabIndex={0} aria-label={tip(p)} title={tip(p)}
              onMouseEnter={() => setActive(i)} onFocus={() => setActive(i)} onBlur={() => setActive(null)}
              className={`flex h-full flex-1 items-end justify-center gap-[2px] transition-opacity ${active === null || active === i ? '' : 'opacity-40'}`}>
              {anyLy && <span aria-hidden className="w-full max-w-3 rounded-t-[4px]" style={{ height: `${h(p.lastYearCents)}%`, background: LY }} />}
              <span aria-hidden className="w-full max-w-3 rounded-t-[4px]"
                style={{ height: `${h(p.cents)}%`, background: p.projected ? `repeating-linear-gradient(135deg, ${CUR} 0 3px, #8ea4ee 3px 6px)` : CUR }} />
            </li>
          ))}
        </ol>
      </div>
      <div aria-hidden className="flex gap-1.5 text-xs text-muted">
        {points.map((p) => <span key={p.ym} className="flex-1 text-center">{mon(p.ym, { month: 'narrow' })}</span>)}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <span className="flex items-center gap-1.5"><i aria-hidden className="size-2.5 rounded-sm" style={{ background: CUR }} />Net sales{points.some((p) => p.projected) ? ' (striped = this month on pace)' : ''}</span>
        {anyLy && <span className="flex items-center gap-1.5"><i aria-hidden className="size-2.5 rounded-sm" style={{ background: LY }} />Last year</span>}
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer font-semibold text-accent-strong">Show as table</summary>
        <table className="mt-2 w-full">
          <thead className="text-left text-muted"><tr><th className="py-1 font-semibold">Month</th><th className="text-right font-semibold">Net sales</th><th className="text-right font-semibold">Last year</th></tr></thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.ym} className="border-t border-line">
                <td className="py-1">{mon(p.ym, { month: 'short', year: 'numeric' })}{p.projected ? ' (on pace)' : ''}</td>
                <td className="num text-right">{p.cents === null ? '—' : formatMoney(p.cents)}</td>
                <td className="num text-right">{p.lastYearCents === null ? '—' : formatMoney(p.lastYearCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
