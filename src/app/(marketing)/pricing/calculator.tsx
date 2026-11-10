'use client';
import Link from 'next/link';
import { useState } from 'react';
import { buttonClass, cx } from '@/components/ui';
import { formatMoney, monthlyTotalCents, normalizeSelection, PLANS, TRIAL_DAYS, MAX_EXTRA_LOCATIONS } from '@/lib/billing/plans';

export function PricingCalculator() {
  const [retail, setRetail] = useState(true);
  const [wholesale, setWholesale] = useState(false);
  const [locations, setLocations] = useState(1);
  const sel = normalizeSelection({ retail, wholesale, extraLocations: locations - 1 });
  const total = monthlyTotalCents(sel);
  const params = new URLSearchParams({ retail: String(retail), wholesale: String(wholesale), locations: String(locations) });

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1fr_0.9fr]">
      {(['retail', 'wholesale'] as const).map((k) => {
        const p = PLANS[k];
        const on = k === 'retail' ? retail : wholesale;
        return (
          <div key={k} className={cx('flex flex-col rounded-[22px] border-2 bg-card p-6', on ? 'border-accent-strong' : 'border-line')}>
            <label className="flex cursor-pointer items-start justify-between gap-4">
              <span>
                <span className="block text-2xl font-extrabold">{p.name}</span>
                <span className="mt-1 block text-muted">{p.summary}</span>
              </span>
              <input type="checkbox" className="mt-2 size-5 accent-[#3f63de]" checked={on} onChange={(e) => (k === 'retail' ? setRetail : setWholesale)(e.target.checked)} aria-label={`Include ${p.name}`} />
            </label>
            <p className="num mt-5"><span className="text-4xl font-extrabold">{formatMoney(p.monthlyCents)}</span><span className="text-muted"> /month</span></p>
            {p.extraLocationCents && <p className="text-sm text-muted">+ {formatMoney(p.extraLocationCents)}/month for each additional store</p>}
            <ul className="mt-5 space-y-2">
              {p.includes.map((i) => {
                const soon = i.endsWith('(coming soon)');
                return <li key={i} className={soon ? 'flex gap-2 text-muted' : 'flex gap-2'}><span aria-hidden="true" className={soon ? 'text-muted' : 'text-paid'}>{soon ? '○' : '✓'}</span>{i}</li>;
              })}
            </ul>
          </div>
        );
      })}
      <div className="flex flex-col rounded-[22px] bg-indigo p-6 text-white">
        <p className="text-lg font-bold">Your monthly total</p>
        {retail && (
          <label className="mt-4 block">
            <span className="block text-sm text-white/85">Store locations</span>
            <input type="number" min={1} max={MAX_EXTRA_LOCATIONS + 1} value={locations}
              onChange={(e) => setLocations(Math.min(MAX_EXTRA_LOCATIONS + 1, Math.max(1, Number(e.target.value) || 1)))}
              className="num mt-1 w-24 rounded-lg border border-white/30 bg-white/10 px-3 py-2 text-white" />
          </label>
        )}
        <p className="num mt-6 text-5xl font-extrabold">{formatMoney(total)}</p>
        <p className="mt-1 text-white/85">per month after your {TRIAL_DAYS}-day free trial</p>
        <p className="mt-4 text-sm text-white/85">You add a card to start, and pay $0 today. Your first payment of {formatMoney(total)} is taken on day {TRIAL_DAYS + 1} unless you cancel before then. Prices exclude any applicable sales tax.</p>
        <Link href={`/signup?${params}`} aria-disabled={!retail && !wholesale}
          className={cx(buttonClass('secondary', 'lg'), 'mt-auto', !retail && !wholesale && 'pointer-events-none opacity-50')}>
          Start free trial
        </Link>
      </div>
    </div>
  );
}
