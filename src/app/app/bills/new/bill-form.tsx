'use client';
import { useActionState, useMemo, useState } from 'react';
import { initialActionState } from '@/lib/actions';
import { Button, Field, FormMessage, Input, Select } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';
import { formatMoney } from '@/lib/billing/plans';
import { parseDollarsToCents } from '@/lib/money';
import { createBill } from '../actions';

type Option = { id: string; label: string };
type Vendor = Option & { terms: number };
type Line = { key: number; account: string; amount: string; description: string };

function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function BillForm({ vendors, accounts, locations, today, initialDue }: { vendors: Vendor[]; accounts: Option[]; locations: Option[]; today: string; initialDue?: string }) {
  const [state, action] = useActionState(createBill, initialActionState);
  const [vendorId, setVendorId] = useState('');
  const [billDate, setBillDate] = useState(initialDue && initialDue < today ? initialDue : today);
  const [due, setDue] = useState(initialDue ?? '');
  const [lines, setLines] = useState<Line[]>([{ key: 0, account: '', amount: '', description: '' }]);
  const vendor = vendors.find((v) => v.id === vendorId);
  const suggestedDue = vendor && billDate ? addDays(billDate, vendor.terms) : '';
  const total = useMemo(() => lines.reduce((a, l) => a + (parseDollarsToCents(l.amount) ?? 0), 0), [lines]);
  const err = state.fieldErrors ?? {};
  const update = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  return (
    <form action={action} className="flex flex-col gap-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Vendor" htmlFor="vendor_id" error={err.vendor_id}>
          <Select id="vendor_id" name="vendor_id" value={vendorId} onChange={(e) => setVendorId(e.target.value)} required>
            <option value="">Choose…</option>
            {vendors.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
          </Select>
        </Field>
        <Field label="Vendor invoice number" htmlFor="bill_number" error={err.bill_number}>
          <Input id="bill_number" name="bill_number" required maxLength={60} />
        </Field>
        <Field label="Bill date" htmlFor="bill_date" error={err.bill_date}>
          <Input id="bill_date" name="bill_date" type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} required />
        </Field>
        <Field label="Due date" htmlFor="due_date" error={err.due_date} hint={suggestedDue && !due ? `Net ${vendor?.terms}: leave blank for ${suggestedDue}.` : undefined}>
          <Input id="due_date" name="due_date" type="date" value={due} min={billDate} onChange={(e) => setDue(e.target.value)} />
        </Field>
        {locations.length > 1 && (
          <Field label="Location" htmlFor="location_id">
            <Select id="location_id" name="location_id" defaultValue=""><option value="">Whole business</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}</Select>
          </Field>
        )}
        <Field label="Memo" htmlFor="memo"><Input id="memo" name="memo" maxLength={500} /></Field>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-semibold">Lines</legend>
        {lines.map((l, i) => (
          <div key={l.key} className="grid gap-2 sm:grid-cols-[1.2fr_1.5fr_8rem_auto]">
            <Select name="line_account" aria-label={`Line ${i + 1} account`} value={l.account} onChange={(e) => update(l.key, { account: e.target.value })}>
              <option value="">Account…</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
            </Select>
            <Input name="line_description" aria-label={`Line ${i + 1} description`} placeholder="Description" maxLength={300}
              value={l.description} onChange={(e) => update(l.key, { description: e.target.value })} />
            <Input name="line_amount" aria-label={`Line ${i + 1} amount`} inputMode="decimal" placeholder="0.00" className="num w-full text-right"
              value={l.amount} onChange={(e) => update(l.key, { amount: e.target.value })} />
            <Button type="button" variant="ghost" size="sm" disabled={lines.length === 1} aria-label={`Remove line ${i + 1}`}
              onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>Remove</Button>
          </div>
        ))}
        <div className="flex items-center justify-between gap-3">
          <Button type="button" variant="secondary" size="sm" disabled={lines.length >= 100}
            onClick={() => setLines((ls) => [...ls, { key: Math.max(...ls.map((x) => x.key)) + 1, account: '', amount: '', description: '' }])}>Add line</Button>
          <p className="font-semibold">Total <span className="num ml-2">{formatMoney(total)}</span></p>
        </div>
      </fieldset>

      <FormMessage state={state} />
      <SubmitButton className="self-start" pendingText="Saving…">Save as draft</SubmitButton>
    </form>
  );
}
