import type { Metadata } from 'next';
import { getAdminContext } from '@/lib/auth/context';
import { ActionForm } from '@/components/action-form';
import { Badge, Card, PageHeader } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';
import { switchOrganization } from '@/app/app/org-actions';
import { createDemoAccounts } from './actions';

export const metadata: Metadata = { title: 'Demo accounts' };
// Filling a demo makes a few hundred database calls.
export const maxDuration = 300;

/** Demo Retail and Demo Wholesale businesses with made-up data, for showing prospects. */
export default async function DemoPage() {
  const ctx = await getAdminContext();
  const { data: demos } = await ctx.supabase.from('organizations').select('id, name, business_type, created_at, feature_overrides(feature, enabled, expires_at)').eq('is_demo', true).order('business_type');
  const { data: mine } = await ctx.supabase.from('memberships').select('organization_id').eq('user_id', ctx.user.id).eq('status', 'active');
  const member = new Set((mine ?? []).map((m) => m.organization_id));
  return (
    <>
      <PageHeader title="Demo accounts" description="A Retail and a Wholesale business filled with made-up records, for showing RetailNexa to prospects. You own them; billing is waived. They don’t count as customers." />
      {(demos ?? []).length ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {(demos ?? []).map((d) => {
            const waiver = (d.feature_overrides as { feature: string; enabled: boolean; expires_at: string | null }[] | null)?.find((f) => f.feature === 'billing.exempt' && f.enabled);
            return (
              <Card key={d.id} className="flex flex-col gap-2">
                <p className="font-bold">{d.name}</p>
                <p className="flex flex-wrap gap-2"><Badge tone="info">{d.business_type}</Badge><Badge tone={waiver ? 'good' : 'danger'}>{waiver?.expires_at ? `Billing waived until ${new Date(waiver.expires_at).toLocaleDateString()}` : 'Billing waiver ended'}</Badge></p>
                {member.has(d.id) && <form action={switchOrganization}><input type="hidden" name="org" value={d.id} /><button className="font-semibold text-accent-strong">Open this demo ›</button></form>}
              </Card>
            );
          })}
        </div>
      ) : <p className="text-muted">No demo accounts yet.</p>}
      {ctx.role === 'superadmin' && (
        <Card>
          <ActionForm action={createDemoAccounts} className="flex flex-col gap-2">
            <SubmitButton pendingText="Creating… (up to a minute)">{(demos ?? []).length >= 2 ? 'Extend the demos’ billing waiver' : 'Create demo accounts'}</SubmitButton>
          </ActionForm>
          <p className="mt-2 text-sm text-muted">To let sales agents show a demo, open it and invite them on its Team page as <strong>Viewer</strong> (they can look but not change anything). Waivers last up to {89} days; come back here to extend them.</p>
        </Card>
      )}
    </>
  );
}
