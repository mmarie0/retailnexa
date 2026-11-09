'use client';
import { useActionState, useState } from 'react';
import { initialActionState, type ActionState } from '@/lib/actions';
import { FormMessage, Input, cx, buttonClass } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';
import { formatMoney, monthlyTotalCents, normalizeSelection, PLANS, TRIAL_DAYS, MAX_EXTRA_LOCATIONS } from '@/lib/billing/plans';
import { cancelSubscription, openPortal, resumeSubscription, startCheckout } from './actions';

export function PlanPicker({ defaults, trialEligible }: { defaults: { retail: boolean; wholesale: boolean; locations: number }; trialEligible: boolean }) {
  const [state, action] = useActionState(startCheckout, initialActionState);
  const [retail, setRetail] = useState(defaults.retail);
  const [wholesale, setWholesale] = useState(defaults.wholesale);
  const [locations, setLocations] = useState(defaults.locations);
  const total = monthlyTotalCents(normalizeSelection({ retail, wholesale, extraLocations: locations - 1 }));
  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {(['retail', 'wholesale'] as const).map((k) => {
          const on = k === 'retail' ? retail : wholesale;
          return (
            <label key={k} className={cx('flex cursor-pointer gap-3 rounded-xl border-2 p-4', on ? 'border-accent-strong bg-accent-soft' : 'border-line')}>
              <input type="checkbox" name={k} checked={on} onChange={(e) => (k === 'retail' ? setRetail : setWholesale)(e.target.checked)} className="mt-1 size-4 accent-[#3f63de]" />
              <span>
                <span className="block font-bold">{PLANS[k].name} · {formatMoney(PLANS[k].monthlyCents)}/mo</span>
                <span className="text-sm text-muted">{PLANS[k].summary}</span>
              </span>
            </label>
          );
        })}
      </div>
      {retail && (
        <label className="flex items-center gap-3">
          <span className="font-semibold">Store locations</span>
          <Input name="locations" type="number" min={1} max={MAX_EXTRA_LOCATIONS + 1} value={locations}
            onChange={(e) => setLocations(Math.min(MAX_EXTRA_LOCATIONS + 1, Math.max(1, Number(e.target.value) || 1)))} className="w-24" />
          <span className="text-sm text-muted">{formatMoney(PLANS.retail.extraLocationCents!)}/mo each after the first</span>
        </label>
      )}
      <div className="rounded-xl bg-soft p-4">
        <p className="num text-2xl font-extrabold">{formatMoney(total)}<span className="text-base font-medium text-muted"> /month + tax</span></p>
        <p className="mt-1 text-sm text-muted">
          {trialEligible
            ? `You pay $0 today. Your first payment is taken when your ${TRIAL_DAYS}-day trial ends unless you cancel first.`
            : 'Your first payment is taken today. This business has already used its free trial.'}
        </p>
      </div>
      <FormMessage state={state} />
      <SubmitButton disabled={!retail && !wholesale} pendingText="Opening secure checkout…" className="self-start">
        {trialEligible ? 'Add card and start free trial' : 'Continue to payment'}
      </SubmitButton>
      <p className="text-sm text-muted">Card details are entered on Stripe’s secure page and never reach RetailNexa.</p>
    </form>
  );
}

function SimpleAction({ action, label, pending, variant = 'secondary' }: { action: (s: ActionState) => Promise<ActionState>; label: string; pending: string; variant?: 'secondary' | 'danger' | 'primary' }) {
  const [state, run] = useActionState(action, initialActionState);
  return (
    <form action={run} className="flex flex-col gap-2">
      <SubmitButton variant={variant} pendingText={pending}>{label}</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

export function PortalButton() {
  return <SimpleAction action={() => openPortal()} label="Manage payment method and invoices" pending="Opening Stripe…" />;
}

export function CancelControls({ cancelScheduled, endsLabel }: { cancelScheduled: boolean; endsLabel: string }) {
  const [confirming, setConfirming] = useState(false);
  if (cancelScheduled) return <SimpleAction action={resumeSubscription} label="Resume subscription" pending="Resuming…" variant="primary" />;
  if (!confirming) return <button className={buttonClass('danger')} onClick={() => setConfirming(true)}>Cancel subscription</button>;
  return (
    <div className="rounded-xl border border-late-soft p-4">
      <p className="font-semibold">Cancel at the end of the current period ({endsLabel})?</p>
      <p className="mt-1 text-sm text-muted">You keep full access until then. Afterwards your records stay available read-only and can be exported or reactivated.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <SimpleAction action={cancelSubscription} label="Yes, cancel" pending="Cancelling…" variant="danger" />
        <button className={buttonClass('ghost')} onClick={() => setConfirming(false)}>Keep my subscription</button>
      </div>
    </div>
  );
}
