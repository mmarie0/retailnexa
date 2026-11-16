'use client';
import { useActionState } from 'react';
import { usePathname } from 'next/navigation';
import { submitLead } from '@/app/(marketing)/lead-actions';
import { initialActionState } from '@/lib/actions';
import { Field, FormMessage, Input, Select, Textarea } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';

export function LeadForm({ kind }: { kind: 'demo' | 'contact' }) {
  const [state, action] = useActionState(submitLead, initialActionState);
  const path = usePathname();
  const fe = state.fieldErrors ?? {};
  if (state.ok) return <FormMessage state={state} />;
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="source_path" value={path} />
      <div className="absolute -start-[9999px]" aria-hidden="true">
        <label>Website <input name="website" tabIndex={-1} autoComplete="off" /></label>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Your name" htmlFor="name" error={fe.name}><Input id="name" name="name" autoComplete="name" required /></Field>
        <Field label="Email" htmlFor="email" error={fe.email}><Input id="email" name="email" type="email" autoComplete="email" required /></Field>
        <Field label="Business name" htmlFor="company" error={fe.company}><Input id="company" name="company" autoComplete="organization" /></Field>
        <Field label="Phone (optional)" htmlFor="phone" error={fe.phone}><Input id="phone" name="phone" type="tel" autoComplete="tel" /></Field>
        {kind === 'demo' && (
          <>
            <Field label="Business type" htmlFor="business_type" error={fe.business_type}>
              <Select id="business_type" name="business_type" defaultValue="retail">
                <option value="retail">Retail store</option><option value="wholesale">Wholesale / distribution</option><option value="both">Both</option>
              </Select>
            </Field>
            <Field label="Number of locations" htmlFor="locations_count" error={fe.locations_count}><Input id="locations_count" name="locations_count" type="number" min={1} defaultValue={1} /></Field>
          </>
        )}
      </div>
      <Field label={kind === 'demo' ? 'What would you like to see? (optional)' : 'Message'} htmlFor="message" error={fe.message}>
        <Textarea id="message" name="message" required={kind === 'contact'} />
      </Field>
      <FormMessage state={state} />
      <SubmitButton pendingText="Sending…" className="self-start">{kind === 'demo' ? 'Request demo' : 'Send message'}</SubmitButton>
    </form>
  );
}
