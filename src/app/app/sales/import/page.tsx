import type { Metadata } from 'next';
import Link from 'next/link';
import { can, getOrgContext, getSupabase } from '@/lib/auth/context';
import { ActionForm } from '@/components/action-form';
import { Card, Field, Input, Notice, PageHeader, Select } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';
import { todayIn } from '@/lib/time';
import { recordSalesDayManually } from '../actions';
import { SalesImporter } from './importer';

export const metadata: Metadata = { title: 'Add sales' };

export default async function ImportSalesPage() {
  const ctx = await getOrgContext();
  if (!can(ctx, 'sales.import')) return <Notice tone="warning">You don’t have permission to add sales.</Notice>;
  if (!ctx.access.canWrite) return <Notice tone="warning">Your account is read-only right now. Check the billing page.</Notice>;
  const supabase = await getSupabase();
  const [{ data: locs }, { data: orgRow }] = await Promise.all([
    supabase.from('locations').select('id, name, kind').eq('organization_id', ctx.org.id).eq('is_active', true).order('name'),
    supabase.from('organizations').select('timezone').eq('id', ctx.org.id).maybeSingle(),
  ]);
  const locations = (locs ?? []).filter((l) => l.kind === 'store').map((l) => ({ id: l.id, label: l.name }));
  if (!locations.length) return <Notice tone="info">Add a store under Locations first.</Notice>;
  const money = (name: string, label: string) => (
    <Field label={label} htmlFor={`m-${name}`}><Input id={`m-${name}`} name={name} inputMode="decimal" placeholder="0.00" className="num w-full" /></Field>
  );

  return (
    <>
      <PageHeader title="Add sales" description="Bring in each register’s end-of-day totals. Every day posts to the books: sales excluding tax, tax owed to the state, and cash and card collected."
        actions={<Link href="/app/sales" className="font-semibold text-accent-strong">All sales days</Link>} />
      <Card>
        <h2 className="mb-1 text-lg font-bold">Import a CSV</h2>
        <p className="mb-4 text-muted">From Vela POS, export the Sales Summary for each day (the .xls file works as-is; pick several days at once). Other systems: a CSV with one row per day. You’ll see everything before it’s saved.</p>
        <SalesImporter locations={locations} timeZone={orgRow?.timezone ?? undefined} />
      </Card>
      <Card>
        <h2 className="mb-4 text-lg font-bold">Enter one day by hand</h2>
        <ActionForm action={recordSalesDayManually} className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Store" htmlFor="m-loc"><Select id="m-loc" name="location_id">{locations.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}</Select></Field>
            <Field label="Date" htmlFor="m-date"><Input id="m-date" name="business_date" type="date" defaultValue={todayIn(orgRow?.timezone)} required /></Field>
            <Field label="Register" htmlFor="m-reg"><Input id="m-reg" name="register" placeholder="Register 1" maxLength={60} /></Field>
            {money('gross', 'Gross sales (excl. tax)')}{money('discounts', 'Discounts / returns')}{money('tax', 'Sales tax')}
            {money('cash', 'Cash')}{money('card', 'Card')}{money('credit', 'Store credit / gift card')}
          </div>
          <p className="text-sm text-muted">Cash + card + store credit must equal gross − discounts + tax.</p>
          <SubmitButton className="self-start" pendingText="Recording…">Record day</SubmitButton>
        </ActionForm>
      </Card>
    </>
  );
}
