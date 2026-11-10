import type { Metadata } from 'next';
import { can, getOrgContext, getSupabase } from '@/lib/auth/context';
import { ActionForm } from '@/components/action-form';
import { Badge, Card, EmptyState, Field, Input, Notice, PageHeader, Textarea } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';
import { createVendor, updateVendor } from '../bills/actions';

export const metadata: Metadata = { title: 'Vendors' };

type Vendor = { id: string; name: string; contact_name: string | null; email: string | null; phone: string | null; payment_terms_days: number; notes: string | null; is_active: boolean };

function VendorFields({ v }: { v?: Vendor }) {
  const p = v?.id ?? 'new';
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Name" htmlFor={`${p}-name`}><Input id={`${p}-name`} name="name" defaultValue={v?.name} required maxLength={120} /></Field>
      <Field label="Contact person" htmlFor={`${p}-contact`}><Input id={`${p}-contact`} name="contact_name" defaultValue={v?.contact_name ?? ''} maxLength={120} /></Field>
      <Field label="Email" htmlFor={`${p}-email`}><Input id={`${p}-email`} name="email" type="email" defaultValue={v?.email ?? ''} /></Field>
      <Field label="Phone" htmlFor={`${p}-phone`}><Input id={`${p}-phone`} name="phone" defaultValue={v?.phone ?? ''} maxLength={40} /></Field>
      <Field label="Payment terms (days)" htmlFor={`${p}-terms`} hint="Used to suggest a due date on new bills.">
        <Input id={`${p}-terms`} name="payment_terms_days" type="number" min={0} max={365} defaultValue={v?.payment_terms_days ?? 30} required />
      </Field>
      <div className="sm:col-span-2">
        <Field label="Notes" htmlFor={`${p}-notes`}><Textarea id={`${p}-notes`} name="notes" defaultValue={v?.notes ?? ''} maxLength={2000} className="min-h-20" /></Field>
      </div>
    </div>
  );
}

export default async function VendorsPage() {
  const ctx = await getOrgContext();
  if (!can(ctx, 'vendors.view')) return <Notice tone="warning">You don’t have access to vendors.</Notice>;
  const supabase = await getSupabase();
  const { data } = await supabase.from('vendors')
    .select('id, name, contact_name, email, phone, payment_terms_days, notes, is_active')
    .eq('organization_id', ctx.org.id).order('name');
  const vendors = (data ?? []) as Vendor[];
  const editable = can(ctx, 'vendors.manage') && ctx.access.canWrite;

  return (
    <>
      <PageHeader title="Vendors" description="The suppliers you buy from. Vendors can be turned off but not deleted, so their bill history stays intact." />
      {vendors.length === 0 ? (
        <EmptyState title="No vendors yet">{editable ? 'Add your first supplier below.' : 'An owner or admin can add vendors.'}</EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {vendors.map((v) => (
            <li key={v.id}>
              <Card>
                <details>
                  <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-3">
                    <span className="font-bold">{v.name} <span className="font-normal text-muted">· net {v.payment_terms_days}{v.contact_name ? ` · ${v.contact_name}` : ''}</span></span>
                    {v.is_active ? <Badge tone="good">Active</Badge> : <Badge>Turned off</Badge>}
                  </summary>
                  {editable ? (
                    <ActionForm action={updateVendor} className="mt-4 flex flex-col gap-3">
                      <input type="hidden" name="id" value={v.id} />
                      <VendorFields v={v} />
                      <label className="flex items-center gap-2 text-[15px]">
                        <input type="hidden" name="is_active" value="false" />
                        <input type="checkbox" name="is_active" value="true" defaultChecked={v.is_active} className="size-4 accent-[#3f63de]" /> Active
                      </label>
                      <SubmitButton className="self-start" variant="secondary" pendingText="Saving…">Save vendor</SubmitButton>
                    </ActionForm>
                  ) : (
                    <p className="mt-3 text-muted">{[v.email, v.phone].filter(Boolean).join(' · ') || 'No contact details on file.'}</p>
                  )}
                </details>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {editable && (
        <Card>
          <h2 className="mb-4 text-lg font-bold">Add a vendor</h2>
          <ActionForm action={createVendor} className="flex flex-col gap-4">
            <VendorFields />
            <SubmitButton className="self-start" pendingText="Adding…">Add vendor</SubmitButton>
          </ActionForm>
        </Card>
      )}
    </>
  );
}
