'use client';
import { useId, useMemo, useRef, useState } from 'react';

export interface TrendPoint {
  label: string; // x label, e.g. "Nov 3"
  current: number;
  previous: number | null;
}

interface Props {
  title: string;
  points: TrendPoint[];
  currentLabel: string;
  previousLabel: string;
  format: (v: number) => string;
}

const W = 640, H = 220, PAD = { t: 16, r: 16, b: 28, l: 56 };
const CURRENT = '#5B7FF5';
const PREVIOUS = '#E2584F';

function niceMax(v: number) {
  if (v <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / mag) * mag;
}

/**
 * Two-series trend (this period vs comparable period). One y-axis, thin lines,
 * previous period dashed as a secondary encoding, legend + crosshair tooltip,
 * keyboard navigation and a table view.
 */
export function TrendChart({ title, points, currentLabel, previousLabel, format }: Props) {
  const [active, setActive] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const id = useId();

  const { x, y, max, curPath, prevPath } = useMemo(() => {
    const max = niceMax(Math.max(...points.flatMap((p) => [p.current, p.previous ?? 0])));
    const x = (i: number) => PAD.l + (points.length <= 1 ? 0 : (i * (W - PAD.l - PAD.r)) / (points.length - 1));
    const y = (v: number) => PAD.t + (H - PAD.t - PAD.b) * (1 - v / max);
    const curPath = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.current).toFixed(1)}`).join('');
    const prevPath = points
      .map((p, i) => (p.previous == null ? null : `${x(i).toFixed(1)},${y(p.previous).toFixed(1)}`))
      .filter(Boolean)
      .map((pt, i) => `${i ? 'L' : 'M'}${pt}`)
      .join('');
    return { x, y, max, curPath, prevPath };
  }, [points]);

  const ticks = [0, 0.5, 1].map((f) => f * max);
  const labelEvery = Math.max(1, Math.ceil(points.length / 7));

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const rect = svgRef.current!.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const step = (W - PAD.l - PAD.r) / Math.max(1, points.length - 1);
    setActive(Math.min(points.length - 1, Math.max(0, Math.round((px - PAD.l) / step))));
  }
  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowRight') setActive((a) => Math.min(points.length - 1, (a ?? -1) + 1));
    else if (e.key === 'ArrowLeft') setActive((a) => Math.max(0, (a ?? points.length) - 1));
    else if (e.key === 'Escape') setActive(null);
    else return;
    e.preventDefault();
  }

  const a = active != null ? points[active] : null;

  return (
    <figure className="m-0">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <figcaption className="font-bold">{title}</figcaption>
        <div className="flex items-center gap-4 text-sm text-muted">
          <span className="inline-flex items-center gap-1.5"><svg width="18" height="4" aria-hidden="true"><line x1="0" y1="2" x2="18" y2="2" stroke={CURRENT} strokeWidth="2.5" /></svg>{currentLabel}</span>
          <span className="inline-flex items-center gap-1.5"><svg width="18" height="4" aria-hidden="true"><line x1="0" y1="2" x2="18" y2="2" stroke={PREVIOUS} strokeWidth="2" strokeDasharray="4 3" /></svg>{previousLabel}</span>
          <button type="button" onClick={() => setShowTable((s) => !s)} className="font-semibold text-accent-strong underline-offset-2 hover:underline" aria-expanded={showTable} aria-controls={`${id}-table`}>
            {showTable ? 'Show chart' : 'Show table'}
          </button>
        </div>
      </div>

      {!showTable ? (
        <div className="relative">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            className="h-auto w-full touch-none select-none"
            role="img"
            aria-label={`${title}. Use left and right arrow keys to read values.`}
            tabIndex={0}
            onPointerMove={onMove}
            onPointerLeave={() => setActive(null)}
            onKeyDown={onKey}
            onBlur={() => setActive(null)}
          >
            {ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="#D6E6F5" strokeWidth="1" />
                <text x={PAD.l - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="#4f6288">{format(t)}</text>
              </g>
            ))}
            {points.map((p, i) => (i % labelEvery === 0 || i === points.length - 1) && (
              <text key={p.label} x={x(i)} y={H - 8} textAnchor="middle" fontSize="11" fill="#4f6288">{p.label}</text>
            ))}
            {prevPath && <path d={prevPath} fill="none" stroke={PREVIOUS} strokeWidth="2" strokeDasharray="5 4" strokeLinejoin="round" strokeLinecap="round" />}
            <path d={curPath} fill="none" stroke={CURRENT} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
            {a && active != null && (
              <g pointerEvents="none">
                <line x1={x(active)} x2={x(active)} y1={PAD.t} y2={H - PAD.b} stroke="#1F2A4D" strokeOpacity=".25" />
                {a.previous != null && <circle cx={x(active)} cy={y(a.previous)} r="4.5" fill={PREVIOUS} stroke="#fff" strokeWidth="2" />}
                <circle cx={x(active)} cy={y(a.current)} r="5" fill={CURRENT} stroke="#fff" strokeWidth="2" />
              </g>
            )}
          </svg>
          {a && active != null && (
            <div
              className="pointer-events-none absolute top-2 z-10 min-w-40 rounded-lg border border-line bg-card px-3 py-2 text-sm shadow-[var(--shadow-card)]"
              style={{ left: `${(x(active) / W) * 100}%`, transform: `translateX(${active > points.length / 2 ? '-105%' : '5%'})` }}
              aria-live="polite"
            >
              <p className="font-semibold">{a.label}</p>
              <p className="num flex justify-between gap-4"><span className="text-muted">{currentLabel}</span>{format(a.current)}</p>
              {a.previous != null && <p className="num flex justify-between gap-4"><span className="text-muted">{previousLabel}</span>{format(a.previous)}</p>}
            </div>
          )}
        </div>
      ) : (
        <div id={`${id}-table`} className="max-h-72 overflow-auto rounded-lg border border-line">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-soft text-left">
              <tr><th className="px-3 py-2">Day</th><th className="px-3 py-2 text-right">{currentLabel}</th><th className="px-3 py-2 text-right">{previousLabel}</th></tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.label} className="border-t border-line">
                  <td className="px-3 py-1.5">{p.label}</td>
                  <td className="num px-3 py-1.5 text-right">{format(p.current)}</td>
                  <td className="num px-3 py-1.5 text-right">{p.previous == null ? '—' : format(p.previous)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </figure>
  );
}
