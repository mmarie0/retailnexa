import type { Metadata } from 'next';
import { can } from '@/lib/auth/context';
import { ActionForm } from '@/components/action-form';
import { Card, Field, Input, Notice, PageHeader, Select, Textarea } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';
import { TERMS } from '@/lib/wholesale/ledger';
import { ReadOnlyNotice } from '../../read-only-notice';
import { loadSettings, wsContext } from '../_data';
import { saveSettings } from '../actions';
import { getT } from '@/lib/i18n/server';

export const metadata: Metadata = { title: 'Wholesale settings' };

/** Numbering, default terms, sales tax, markup and payment instructions (the Ledger's Setup page). */
export default async function WholesaleSettingsPage() {
  const t = await getT();
  const ctx = await wsContext();
  if (!can(ctx, 'wholesale.catalog.manage')) return <Notice tone="warning">{t('Only owners and admins can change wholesale settings.')}</Notice>;
  const s = await loadSettings(ctx.org.id);
  const edit = ctx.access.canWrite;
  return (
    <>
      <PageHeader title={t('Wholesale settings')} description={t('How orders and invoices are numbered, your usual terms and tax, and what customers see about paying you.')} />
      <ReadOnlyNotice show={!edit} />
      <Card>
        <ActionForm action={saveSettings} className="grid gap-3 sm:grid-cols-2">
          <Field label={t('Default payment terms')} htmlFor="terms" hint={t('New customers start with this.')}>
            <Select id="terms" name="default_terms" defaultValue={String(s.default_terms)}>{TERMS.map((tm) => <option key={tm.days} value={tm.days}>{t(tm.label)}</option>)}</Select>
          </Field>
          <Field label={t('Sales tax %')} htmlFor="tax" hint={t('Added to orders for customers who aren’t tax exempt. 0 if you only sell for resale.')}>
            <Input id="tax" name="tax_rate" type="number" min={0} max={30} step="0.001" defaultValue={s.tax_rate} className="num" />
          </Field>
          <Field label={t('Invoice prefix')} htmlFor="ip"><Input id="ip" name="inv_prefix" defaultValue={s.inv_prefix} maxLength={10} /></Field>
          <Field label={t('Next invoice number')} htmlFor="ni"><Input id="ni" name="next_inv" type="number" min={1} defaultValue={s.next_inv} className="num" /></Field>
          <Field label={t('Order prefix')} htmlFor="sp"><Input id="sp" name="so_prefix" defaultValue={s.so_prefix} maxLength={10} /></Field>
          <Field label={t('Next order number')} htmlFor="ns"><Input id="ns" name="next_so" type="number" min={1} defaultValue={s.next_so} className="num" /></Field>
          <Field label={t('Usual markup %')} htmlFor="mk" hint={t('Used to suggest a price from cost when you add an item.')}>
            <Input id="mk" name="markup" type="number" min={0} max={1000} step="0.01" defaultValue={s.markup} className="num" />
          </Field>
          <div className="sm:col-span-2">
            <Field label={t('How to pay you (printed on invoices)')} htmlFor="pay"><Textarea id="pay" name="pay_instructions" rows={3} maxLength={500} defaultValue={s.pay_instructions ?? ''} placeholder={t('Checks payable to … · Zelle … · ACH routing …')} /></Field>
          </div>
          {edit && <div><SubmitButton>{t('Save settings')}</SubmitButton></div>}
        </ActionForm>
      </Card>
      <p className="text-sm text-muted">{t('Numbers never repeat: if a number is already used, the next free one is taken.')}</p>
    </>
  );
}
