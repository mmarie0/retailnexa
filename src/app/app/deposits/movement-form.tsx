'use client';
import { useActionState, useState } from 'react';
import { initialActionState } from '@/lib/actions';
import { Field, FormMessage, Input, Select } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';
import { formatMoney } from '@/lib/billing/plans';
import { parseDollarsToCents } from '@/lib/money';
import { recordMoneyMovement } from './actions';

export type Kind = 'card_deposit' | 'cash_deposit' | 'sales_tax_payment' | 'owner_draw' | 'owner_contribution';
export const KIND_LABEL: Record<Kind, string> = {
  card_deposit: 'Card deposit from processor',
  cash_deposit: 'Cash taken to the bank',
  sales_tax_payment: 'Sales tax paid to the state',
  owner_draw: 'Owner draw',
  owner_contribution: 'Owner put money in',
};
const HELP: Record<Kind, string> = {
  card_deposit: 'Enter the card sales being settled and the processor’s fees. The bank gets the difference.',
  cash_deposit: 'Moves cash from the store to the bank. Not income — the sale was already recorded.',
  sales_tax_payment: 'Pays down the sales tax you collected. Not an expense.',
  owner_draw: 'Money taken out by the owner. Recorded as equity, never an expense.',
  owner_contribution: 'Money the owner put into the business, e.g. starting funds.',
};

export function MovementForm({ kinds, today, formKey, stores, allowWholeBusiness }: {
  kinds: Kind[]; today: string; formKey: string; stores: { id: string; label: string }[]; allowWholeBusiness: boolean;
}) {
  const [state, action] = useActionState(recordMoneyMovement, initialActionState);
  const [kind, setKind] = useState<Kind>(kinds[0]);
  const [amount, setAmount] = useState('');
  const [fees, setFees] = useState('');
  const err = state.fieldErrors ?? {};
  const a = parseDollarsToCents(amount);
  const f = parseDollarsToCents(fees) ?? 0;
  const key = state.data?.nextKey ?? formKey;

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="idempotency_key" value={key} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="What happened" htmlFor="kind">
          <Select id="kind" name="kind" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
            {kinds.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </Select>
        </Field>
        <Field label="Date" htmlFor="date" error={err.date}><Input id="date" name="date" type="date" defaultValue={today} required /></Field>
        <Field label={kind === 'card_deposit' ? 'Card sales settled' : 'Amount'} htmlFor="amount" error={err.amount}>
          <Input id="amount" name="amount" inputMode="decimal" placeholder="0.00" className="num w-full" value={amount} onChange={(e) => setAmount(e.target.value)} required />
        </Field>
        {kind === 'card_deposit' && (
          <Field label="Processor fees" htmlFor="fees" error={err.fees}
            hint={a ? `Bank receives ${formatMoney(Math.max(0, a - f))}` : undefined}>
            <Input id="fees" name="fees" inputMode="decimal" placeholder="0.00" className="num w-full" value={fees} onChange={(e) => setFees(e.target.value)} />
          </Field>
        )}
        {(kind === 'owner_draw' || kind === 'owner_contribution') && (
          <Field label={kind === 'owner_draw' ? 'Taken from' : 'Put into'} htmlFor="account">
            <Select id="account" name="account" defaultValue="bank"><option value="bank">Bank account</option><option value="cash_on_hand">Cash on hand</option></Select>
          </Field>
        )}
        {(stores.length > 1 || !allowWholeBusiness) && (
          <Field label="Store" htmlFor="location_id" error={err.location_id}
            hint={allowWholeBusiness ? undefined : 'Pick the store the cash came from.'}>
            <Select id="location_id" name="location_id" defaultValue={allowWholeBusiness ? '' : (stores[0]?.id ?? '')} required={!allowWholeBusiness}>
              {allowWholeBusiness && <option value="">Whole business</option>}
              {stores.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </Select>
          </Field>
        )}
        <Field label="Note (optional)" htmlFor="memo"><Input id="memo" name="memo" maxLength={500} /></Field>
      </div>
      <p className="text-sm text-muted">{HELP[kind]}</p>
      <FormMessage state={state} />
      <SubmitButton className="self-start" pendingText="Recording…">Record</SubmitButton>
    </form>
  );
}
