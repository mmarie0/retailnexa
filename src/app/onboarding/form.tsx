'use client';
import { useActionState } from 'react';
import { createOrganization } from './actions';
import { initialActionState } from '@/lib/actions';
import { Field, FormMessage, Input, Select, cx } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';
import { US_TIMEZONES } from '@/lib/timezones';
import { useT } from '@/lib/i18n/client';

const TYPES = [
  { value: 'retail', label: 'Retail store', body: 'You sell to the public from one or more stores.' },
  { value: 'wholesale', label: 'Wholesale', body: 'You sell to other businesses from a warehouse.' },
  { value: 'both', label: 'Both', body: 'You run stores and a wholesale operation.' },
] as const;

export function OnboardingForm({ defaultType, plan }: { defaultType: 'retail' | 'wholesale' | 'both'; plan: string }) {
  const t = useT();
  const [state, action] = useActionState(createOrganization, initialActionState);
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="flex flex-col gap-5">
      <input type="hidden" name="plan" value={plan} />
      <Field label={t('Business name')} htmlFor="name" error={fe.name}><Input id="name" name="name" autoComplete="organization" required /></Field>
      <fieldset>
        <legend className="mb-2 text-sm font-semibold">{t('What do you run?')}</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {TYPES.map((t) => (
            <label key={t.value} className={cx('flex cursor-pointer flex-col gap-1 rounded-xl border-2 border-line p-3 has-[:checked]:border-accent-strong has-[:checked]:bg-accent-soft')}>
              <span className="flex items-center gap-2 font-semibold"><input type="radio" name="business_type" value={t.value} defaultChecked={t.value === defaultType} className="accent-[#3f63de]" />{t.label}</span>
              <span className="text-sm text-muted">{t.body}</span>
            </label>
          ))}
        </div>
        {fe.business_type && <p className="mt-1 text-sm text-late">{fe.business_type}</p>}
      </fieldset>
      <Field label={t('First location name')} htmlFor="location_name" hint={t('For example the street or neighbourhood. You can add more later.')}>
        <Input id="location_name" name="location_name" placeholder={t('Main store')} />
      </Field>
      <Field label={t('Time zone')} htmlFor="timezone">
        <Select id="timezone" name="timezone" defaultValue="America/New_York">
          {US_TIMEZONES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </Select>
      </Field>
      <FormMessage state={state} />
      <SubmitButton pendingText={t('Setting up…')}>{t('Continue to billing')}</SubmitButton>
    </form>
  );
}
