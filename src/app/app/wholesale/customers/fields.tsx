import { Field, Input, Select, Textarea } from '@/components/ui';
import { centsToInput } from '@/lib/money';
import { TERMS } from '@/lib/wholesale/ledger';
import type { Customer, Tier } from '../_data';
import { getT } from '@/lib/i18n/server';

const check = (name: string, label: string, on: boolean | undefined) => (
  <label className="flex items-center gap-2 text-[15px]"><input type="hidden" name={name} value="false" /><input type="checkbox" name={name} value="true" defaultChecked={on} className="size-4 accent-[#3f63de]" />{label}</label>
);

/** Customer form fields (name, contact, terms, tier, credit, resale certificate, hold). */
export async function CustomerFields({ c, tiers, defaultTerms }: { c?: Customer; tiers: Tier[]; defaultTerms: number }) {
  const t = await getT();
  const p = c?.id ?? 'new';
  const terms = c?.terms ?? defaultTerms;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="id" value={c?.id ?? ''} />
      <Field label={t('Business name')} htmlFor={`${p}-name`}><Input id={`${p}-name`} name="name" defaultValue={c?.name} required maxLength={120} /></Field>
      <Field label={t('Contact (optional)')} htmlFor={`${p}-contact`}><Input id={`${p}-contact`} name="contact" defaultValue={c?.contact ?? ''} maxLength={80} /></Field>
      <Field label={t('Email (optional)')} htmlFor={`${p}-email`} hint={t('Where invoices go.')}><Input id={`${p}-email`} name="email" type="email" defaultValue={c?.email ?? ''} maxLength={200} /></Field>
      <Field label={t('Phone (optional)')} htmlFor={`${p}-phone`}><Input id={`${p}-phone`} name="phone" type="tel" defaultValue={c?.phone ?? ''} maxLength={40} /></Field>
      <Field label={t('Billing address (optional)')} htmlFor={`${p}-addr`}><Textarea id={`${p}-addr`} name="address" rows={2} defaultValue={c?.address ?? ''} maxLength={300} /></Field>
      <Field label={t('Ship-to address (optional)')} htmlFor={`${p}-ship`} hint={t('Leave blank if it’s the same.')}><Textarea id={`${p}-ship`} name="ship_address" rows={2} defaultValue={c?.ship_address ?? ''} maxLength={300} /></Field>
      <Field label={t('Payment terms')} htmlFor={`${p}-terms`}>
        <Select id={`${p}-terms`} name="terms" defaultValue={String(terms)}>
          {TERMS.map((tm) => <option key={tm.days} value={tm.days}>{t(tm.label)}</option>)}
          {!TERMS.some((tm) => tm.days === terms) && <option value={terms}>{t('Net')} {terms}</option>}
        </Select>
      </Field>
      <Field label={t('Price tier')} htmlFor={`${p}-tier`}>
        <Select id={`${p}-tier`} name="tier_id" defaultValue={c?.tier_id ?? tiers[0]?.id ?? ''}>
          <option value="">{t('List price')}</option>
          {tiers.map((tr) => <option key={tr.id} value={tr.id}>{tr.name}{tr.pct ? ` (${t('{n}% off', { n: tr.pct })})` : ''}</option>)}
        </Select>
      </Field>
      <Field label={t('Credit limit (optional)')} htmlFor={`${p}-limit`} hint={t('You’ll see a warning when they owe more.')}><Input id={`${p}-limit`} name="credit_limit" inputMode="decimal" className="num" defaultValue={c?.credit_limit_cents != null ? centsToInput(c.credit_limit_cents) : ''} placeholder="5000.00" /></Field>
      <div className="flex flex-col justify-end gap-2">
        {check('tax_exempt', t('Tax exempt (resale)'), c?.tax_exempt)}
        {check('on_hold', t('On hold (warn before new orders)'), c?.on_hold)}
      </div>
      <Field label={t('Resale certificate # (optional)')} htmlFor={`${p}-cert`}><Input id={`${p}-cert`} name="resale_cert" defaultValue={c?.resale_cert ?? ''} maxLength={60} /></Field>
      <Field label={t('Certificate expires (optional)')} htmlFor={`${p}-certx`}><Input id={`${p}-certx`} name="cert_expiry" type="date" defaultValue={c?.cert_expiry ?? ''} /></Field>
      <div className="sm:col-span-2"><Field label={t('Notes (optional)')} htmlFor={`${p}-notes`}><Textarea id={`${p}-notes`} name="notes" rows={2} defaultValue={c?.notes ?? ''} maxLength={1000} /></Field></div>
      {c && check('active', t('Active (untick to hide from order screens)'), c.is_active)}
    </div>
  );
}
