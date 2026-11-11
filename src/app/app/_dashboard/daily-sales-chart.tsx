'use client';
import { useState } from 'react';
import { formatMoney } from '@/lib/billing/plans';
import { useT } from '@/lib/i18n/client';

type Point = { date: string; netCents: number | null };
const dayLabel = (d: string, opts: Intl.DateTimeFormatOptions) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', ...opts });

/** Single-series bar chart: net sales per day, last 14 days. Missing days show a dashed "no report" stub. */
export function DailySalesChart({ points, title = 'Net sales, last 14 days' }: { points: Point[]; title?: string }) {
  const t = useT();
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(1, ...points.map((p) => p.netCents ?? 0));
  const shown = active ?? null;

  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-bold">{title}</span>
        <span className="text-sm text-muted" aria-live="polite">
          {shown !== null
            ? `${dayLabel(points[shown].date, { weekday: 'short', month: 'short', day: 'numeric' })}: ${points[shown].netCents === null ? 'no report' : formatMoney(points[shown].netCents!)}`
            : t('Hover a bar for the day’s total')}
        </span>
      </figcaption>
      <div className="relative mt-3 h-40" onMouseLeave={() => setActive(null)}>
        {/* recessive gridlines at 50% and 100% of the max */}
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-line" />
        <span aria-hidden className="pointer-events-none absolute -top-2.5 right-0 bg-card pl-1 text-xs text-muted">{formatMoney(max)}</span>
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed border-line" />
        <div aria-hidden className="absolute inset-x-0 bottom-0 border-t border-muted/40" />
        <ol className="relative flex h-full items-end gap-[2px]">
          {points.map((p, i) => {
            const pct = p.netCents === null ? 0 : Math.max(1.5, (p.netCents / max) * 100);
            const label = `${dayLabel(p.date, { weekday: 'long', month: 'long', day: 'numeric' })}: ${p.netCents === null ? 'no report recorded' : formatMoney(p.netCents)}`;
            return (
              <li key={p.date} className="flex h-full flex-1 items-end justify-center"
                onMouseEnter={() => setActive(i)} onFocus={() => setActive(i)} onBlur={() => setActive(null)}
                tabIndex={0} aria-label={label} title={label}>
                {p.netCents === null ? (
                  <span aria-hidden className="mb-0 h-2 w-full max-w-7 rounded-t border border-b-0 border-dashed border-muted/50" />
                ) : (
                  <span aria-hidden style={{ height: `${pct}%` }}
                    className={`w-full max-w-7 rounded-t-[4px] transition-opacity ${active === null || active === i ? 'bg-[#3f63de]' : 'bg-[#3f63de] opacity-40'}`} />
                )}
              </li>
            );
          })}
        </ol>
      </div>
      <div aria-hidden className="flex justify-between text-xs text-muted">
        <span>{dayLabel(points[0].date, { month: 'short', day: 'numeric' })}</span>
        <span>{dayLabel(points[points.length - 1].date, { month: 'short', day: 'numeric' })}</span>
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer font-semibold text-accent-strong">{t('Show as table')}</summary>
        <table className="mt-2 w-full">
          <thead className="text-left text-muted"><tr><th className="py-1 font-semibold">{t('Day')}</th><th className="text-right font-semibold">{t('Net sales')}</th></tr></thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.date} className="border-t border-line">
                <td className="py-1">{dayLabel(p.date, { weekday: 'short', month: 'short', day: 'numeric' })}</td>
                <td className="num text-right">{p.netCents === null ? '—' : formatMoney(p.netCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
