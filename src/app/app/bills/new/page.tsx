import type { Metadata } from 'next';
import { can, getOrgContext, getSupabase } from '@/lib/auth/context';
import { Card, LinkButton, Notice, PageHeader } from '@/components/ui';
import { todayIn } from '@/lib/time';
import { BillForm } from './bill-form';

export const metadata: Metadata = { title: 'Enter a bill' };

export default async function NewBillPage() {
  const ctx = await getOrgContext();
  if (!can(ctx, 'bills.create')) return <Notice tone="warning">You don’t have permission to enter bills.</Notice>;
  if (!ctx.access.canWrite) return <Notice tone="warning">Your account is read-only right now. Check the billing page.</Notice>;
  const supabase = await getSupabase();
  const [{ data: vendors }, { data: accounts }, { data: locations }, { data: orgRow }] = await Promise.all([
    supabase.from('vendors').select('id, name, payment_terms_days').eq('organization_id', ctx.org.id).eq('is_active', true).order('name'),
    supabase.rpc('bill_account_options', { p_org: ctx.org.id }),
    supabase.rpc('my_locations', { p_org: ctx.org.id }),
    supabase.from('organizations').select('timezone').eq('id', ctx.org.id).maybeSingle(),
  ]);
  const vendorList = (vendors ?? []).map((v) => ({ id: v.id, label: v.name, terms: v.payment_terms_days }));

  return (
    <>
      <PageHeader title="Enter a bill" description="Saved as a draft. Nothing reaches the books until someone with approval rights approves it." />
      {vendorList.length === 0 ? (
        <Notice tone="info" action={can(ctx, 'vendors.manage') ? <LinkButton href="/app/vendors" size="sm" variant="secondary">Add a vendor</LinkButton> : undefined}>
          Add a vendor before entering bills.
        </Notice>
      ) : (
        <Card>
          <BillForm
            vendors={vendorList}
            accounts={((accounts ?? []) as { id: string; code: string; name: string }[]).map((a) => ({ id: a.id, label: `${a.code} · ${a.name}` }))}
            locations={((locations ?? []) as { id: string; name: string }[]).map((l) => ({ id: l.id, label: l.name }))}
            today={todayIn(orgRow?.timezone)}
          />
        </Card>
      )}
    </>
  );
}
