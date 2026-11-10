import type { Metadata } from 'next';
import { can, getOrgContext, getSupabase } from '@/lib/auth/context';
import { ActionForm } from '@/components/action-form';
import { Badge, Card, EmptyState, Field, Input, PageHeader, Select } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';
import { US_TIMEZONES } from '@/lib/timezones';
import { createLocation, updateLocation } from '../actions';

export const metadata: Metadata = { title: 'Locations' };

type Loc = { id: string; name: string; kind: string; address_line1: string | null; city: string | null; region: string | null; postal_code: string | null; timezone: string | null; is_active: boolean };

function LocationFields({ l }: { l?: Loc }) {
  const p = l?.id ?? 'new';
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Name" htmlFor={`${p}-name`}><Input id={`${p}-name`} name="name" defaultValue={l?.name} required /></Field>
      <Field label="Type" htmlFor={`${p}-kind`}>
        <Select id={`${p}-kind`} name="kind" defaultValue={l?.kind ?? 'store'}><option value="store">Store</option><option value="warehouse">Warehouse</option><option value="office">Office</option></Select>
      </Field>
      <Field label="Street address" htmlFor={`${p}-a1`}><Input id={`${p}-a1`} name="address_line1" defaultValue={l?.address_line1 ?? ''} /></Field>
      <Field label="City" htmlFor={`${p}-city`}><Input id={`${p}-city`} name="city" defaultValue={l?.city ?? ''} /></Field>
      <Field label="State" htmlFor={`${p}-region`}><Input id={`${p}-region`} name="region" defaultValue={l?.region ?? ''} /></Field>
      <Field label="ZIP code" htmlFor={`${p}-zip`}><Input id={`${p}-zip`} name="postal_code" defaultValue={l?.postal_code ?? ''} /></Field>
      <Field label="Time zone" htmlFor={`${p}-tz`}>
        <Select id={`${p}-tz`} name="timezone" defaultValue={l?.timezone ?? ''}><option value="">Same as business</option>{US_TIMEZONES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</Select>
      </Field>
    </div>
  );
}

export default async function LocationsPage() {
  const ctx = await getOrgContext();
  const supabase = await getSupabase();
  const { data } = await supabase.from('locations').select('id, name, kind, address_line1, city, region, postal_code, timezone, is_active').eq('organization_id', ctx.org.id).order('created_at');
  const locations = (data ?? []) as Loc[];
  const editable = can(ctx, 'locations.manage') && ctx.access.canWrite;
  const activeStores = locations.filter((l) => l.is_active && l.kind === 'store').length;
  const paidStores = ctx.subscription?.products.includes('retail') ? 1 + ctx.subscription.extraLocations : null;

  return (
    <>
      <PageHeader title="Locations" description="Stores, warehouses and offices. Locations can be turned off but not deleted, so their history stays intact." />
      {paidStores !== null && activeStores > paidStores && (
        <p className="rounded-xl bg-soon-soft px-4 py-3 text-soon">You have {activeStores} active stores but your plan covers {paidStores}. Update your plan on the billing page.</p>
      )}
      {locations.length === 0 ? <EmptyState title="No locations yet" /> : (
        <ul className="flex flex-col gap-3">
          {locations.map((l) => (
            <li key={l.id}>
              <Card>
                <details>
                  <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-3">
                    <span className="font-bold">{l.name} <span className="font-normal text-muted">· {l.kind}{l.city ? ` · ${l.city}` : ''}</span></span>
                    {l.is_active ? <Badge tone="good">Active</Badge> : <Badge>Turned off</Badge>}
                  </summary>
                  {editable ? (
                    <ActionForm action={updateLocation} className="mt-4 flex flex-col gap-3">
                      <input type="hidden" name="id" value={l.id} />
                      <LocationFields l={l} />
                      <label className="flex items-center gap-2 text-[15px]">
                        <input type="hidden" name="is_active" value="false" />
                        <input type="checkbox" name="is_active" value="true" defaultChecked={l.is_active} className="size-4 accent-[#3f63de]" /> Active
                      </label>
                      <SubmitButton className="self-start" variant="secondary" pendingText="Saving…">Save location</SubmitButton>
                    </ActionForm>
                  ) : <p className="mt-3 text-muted">{[l.address_line1, l.city, l.region, l.postal_code].filter(Boolean).join(', ') || 'No address on file.'}</p>}
                </details>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {editable && (
        <Card>
          <h2 className="mb-4 text-lg font-bold">Add a location</h2>
          <ActionForm action={createLocation} className="flex flex-col gap-4">
            <LocationFields />
            <SubmitButton className="self-start" pendingText="Adding…">Add location</SubmitButton>
          </ActionForm>
        </Card>
      )}
    </>
  );
}
