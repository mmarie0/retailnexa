import type { Metadata } from 'next';
import { can, getOrgContext, getSupabase } from '@/lib/auth/context';
import { ActionForm } from '@/components/action-form';
import { Card, Field, Input, PageHeader, Select } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';
import { US_TIMEZONES } from '@/lib/timezones';
import { updateOrganization } from './actions';

export const metadata: Metadata = { title: 'Business profile' };

export default async function ProfilePage() {
  const ctx = await getOrgContext();
  const supabase = await getSupabase();
  const { data: org } = await supabase.from('organizations').select('name, legal_name, phone, website, timezone, business_type, created_at').eq('id', ctx.org.id).single();
  const editable = can(ctx, 'org.manage') && ctx.access.canWrite;
  if (!org) return null;
  return (
    <>
      <PageHeader title="Business profile" description="How your business appears on invoices, statements and in RetailNexa." />
      <Card className="max-w-2xl">
        <ActionForm action={updateOrganization} className="flex flex-col gap-4">
          <fieldset disabled={!editable} className="contents">
            <Field label="Business name" htmlFor="name"><Input id="name" name="name" defaultValue={org.name} required /></Field>
            <Field label="Legal name (optional)" htmlFor="legal_name"><Input id="legal_name" name="legal_name" defaultValue={org.legal_name ?? ''} /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Phone" htmlFor="phone"><Input id="phone" name="phone" type="tel" defaultValue={org.phone ?? ''} /></Field>
              <Field label="Website" htmlFor="website"><Input id="website" name="website" defaultValue={org.website ?? ''} /></Field>
            </div>
            <Field label="Time zone" htmlFor="timezone" hint="Used for “today” on the dashboard and for day-end cutoffs.">
              <Select id="timezone" name="timezone" defaultValue={org.timezone}>
                {US_TIMEZONES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </Select>
            </Field>
            <p className="text-sm text-muted">Business type: <strong className="text-ink">{org.business_type}</strong>. It changes when you change your plan.</p>
            {editable && <SubmitButton className="self-start" pendingText="Saving…">Save changes</SubmitButton>}
          </fieldset>
        </ActionForm>
      </Card>
    </>
  );
}
