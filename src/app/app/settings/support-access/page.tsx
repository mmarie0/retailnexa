import { requestNow } from '@/lib/time';
import type { Metadata } from 'next';
import { can, getOrgContext, getSupabase } from '@/lib/auth/context';
import { ActionForm } from '@/components/action-form';
import { Badge, Card, Field, Input, PageHeader, Select } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';
import { grantSupportAccess, revokeSupportAccess } from '../actions';

export const metadata: Metadata = { title: 'Support access' };

export default async function SupportAccessPage() {
  const ctx = await getOrgContext();
  if (!can(ctx, 'org.manage')) return <p>Only owners and admins can manage support access.</p>;
  const supabase = await getSupabase();
  const { data: grants } = await supabase.from('support_access_grants').select('id, reason, created_at, expires_at, revoked_at').eq('organization_id', ctx.org.id).order('created_at', { ascending: false }).limit(20);
  const now = requestNow();
  return (
    <>
      <PageHeader title="Support access" description="RetailNexa staff can see your business name, plan and team list to help with billing and logins. They can’t see your business records unless you allow it here." />
      <Card className="max-w-2xl">
        <h2 className="mb-4 text-lg font-bold">Allow support to view your records</h2>
        <ActionForm action={grantSupportAccess} className="flex flex-col gap-4">
          <Field label="What do you need help with?" htmlFor="reason"><Input id="reason" name="reason" required minLength={3} maxLength={500} placeholder="e.g. Help importing last year’s invoices" /></Field>
          <Field label="For how long?" htmlFor="hours">
            <Select id="hours" name="hours" defaultValue="24"><option value="2">2 hours</option><option value="24">24 hours</option><option value="72">3 days</option></Select>
          </Field>
          <SubmitButton className="self-start" pendingText="Granting…">Allow access</SubmitButton>
        </ActionForm>
      </Card>
      {(grants ?? []).length > 0 && (
        <Card>
          <h2 className="mb-3 text-lg font-bold">History</h2>
          <ul className="divide-y divide-line">
            {(grants ?? []).map((g) => {
              const live = !g.revoked_at && new Date(g.expires_at).getTime() > now;
              return (
                <li key={g.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                  <span>{g.reason}<span className="block text-sm text-muted">Granted {new Date(g.created_at).toLocaleString()} · {live ? `until ${new Date(g.expires_at).toLocaleString()}` : g.revoked_at ? 'revoked' : 'expired'}</span></span>
                  {live ? (
                    <ActionForm action={revokeSupportAccess}><input type="hidden" name="grant_id" value={g.id} /><SubmitButton size="sm" variant="danger" pendingText="…">Revoke now</SubmitButton></ActionForm>
                  ) : <Badge>Ended</Badge>}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </>
  );
}
