import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { adminCan, getAdminContext } from '@/lib/auth/context';
import { ActionForm } from '@/components/action-form';
import { Badge, Card, Field, Input, PageHeader, Select } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';
import { ROLE_LABELS, isMemberRole } from '@/lib/auth/permissions';
import { sendPasswordReset, setFeatureOverride, setOrgStatus } from '../../actions';

export const metadata: Metadata = { title: 'Customer' };

export default async function TenantPage({ params }: PageProps<'/admin/tenants/[id]'>) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const ctx = await getAdminContext();
  const { supabase } = ctx;
  const { data: org } = await supabase.from('organizations').select('*').eq('id', id).maybeSingle();
  if (!org) notFound();
  const [members, locations, sub, events, billing, overrides, grants] = await Promise.all([
    supabase.from('memberships').select('id, user_id, role, status').eq('organization_id', id),
    supabase.from('locations').select('id, name, kind, city, is_active').eq('organization_id', id),
    supabase.from('subscriptions').select('*').eq('organization_id', id).maybeSingle(),
    supabase.from('subscription_events').select('kind, from_status, to_status, created_at').eq('organization_id', id).order('created_at', { ascending: false }).limit(20),
    supabase.from('billing_accounts').select('stripe_customer_id, billing_email').eq('organization_id', id).maybeSingle(),
    supabase.from('feature_overrides').select('feature, enabled, reason, expires_at').eq('organization_id', id),
    supabase.from('support_access_grants').select('reason, expires_at, revoked_at').eq('organization_id', id).is('revoked_at', null).gt('expires_at', new Date().toISOString()),
  ]);
  const ids = (members.data ?? []).map((m) => m.user_id);
  const { data: profiles } = ids.length ? await supabase.from('profiles').select('id, email, full_name').in('id', ids) : { data: [] };
  const stripeMode = process.env.STRIPE_SECRET_KEY?.startsWith('sk_test') ? 'test/' : '';

  return (
    <>
      <PageHeader title={org.name} description={`${org.business_type} · created ${new Date(org.created_at).toLocaleDateString()} · ${org.timezone}`} />
      <div className="flex flex-wrap gap-2">
        <Badge tone={org.status === 'active' ? 'good' : 'danger'}>Account {org.status}</Badge>
        <Badge tone="info">Plan {sub.data?.status ?? 'none'}</Badge>
        {(grants.data ?? []).length > 0 ? <Badge tone="warning">Support access granted until {new Date(grants.data![0].expires_at).toLocaleString()}</Badge> : <Badge>No support access to records</Badge>}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-2 font-bold">Subscription</h2>
          {sub.data ? (
            <dl className="grid grid-cols-2 gap-2 text-[15px]">
              <dt className="text-muted">Products</dt><dd>{sub.data.products.join(', ')} (+{sub.data.extra_locations} locations)</dd>
              <dt className="text-muted">Trial ends</dt><dd>{sub.data.trial_end ? new Date(sub.data.trial_end).toLocaleDateString() : '—'}</dd>
              <dt className="text-muted">Period ends</dt><dd>{sub.data.current_period_end ? new Date(sub.data.current_period_end).toLocaleDateString() : '—'}</dd>
              <dt className="text-muted">Cancels at period end</dt><dd>{sub.data.cancel_at_period_end ? 'Yes' : 'No'}</dd>
            </dl>
          ) : <p className="text-muted">No subscription yet.</p>}
          {billing.data && (
            <p className="mt-3"><a className="font-semibold text-accent-strong underline" href={`https://dashboard.stripe.com/${stripeMode}customers/${billing.data.stripe_customer_id}`} target="_blank" rel="noopener noreferrer">Open in Stripe</a> <span className="text-muted">({billing.data.billing_email})</span></p>
          )}
          <p className="mt-3 text-sm text-muted">Plan changes, refunds and cancellations on the customer’s behalf are made in Stripe and require owner approval.</p>
          {(events.data ?? []).length > 0 && (
            <ul className="mt-3 text-sm">{(events.data ?? []).map((e, i) => <li key={i} className="border-t border-line py-1">{new Date(e.created_at).toLocaleString()} · {e.kind} {e.from_status ? `${e.from_status} → ` : ''}{e.to_status}</li>)}</ul>
          )}
        </Card>

        <Card>
          <h2 className="mb-2 font-bold">Team</h2>
          <ul className="divide-y divide-line">
            {(members.data ?? []).map((m) => {
              const p = (profiles ?? []).find((x) => x.id === m.user_id);
              return (
                <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>{p?.full_name || p?.email}<span className="block text-sm text-muted">{p?.email} · {isMemberRole(m.role) ? ROLE_LABELS[m.role] : m.role}{m.status !== 'active' ? ' · disabled' : ''}</span></span>
                  {p?.email && adminCan(ctx.role, 'leads') && (
                    <ActionForm action={sendPasswordReset}><input type="hidden" name="org" value={id} /><input type="hidden" name="email" value={p.email} /><SubmitButton size="sm" variant="ghost" pendingText="Sending…">Send password reset</SubmitButton></ActionForm>
                  )}
                </li>
              );
            })}
          </ul>
          <h3 className="mb-1 mt-4 font-bold">Locations</h3>
          <p className="text-[15px]">{(locations.data ?? []).map((l) => `${l.name} (${l.kind}${l.is_active ? '' : ', off'})`).join(' · ') || '—'}</p>
        </Card>
      </div>

      {adminCan(ctx.role, 'suspend') && (
        <Card>
          <h2 className="mb-3 font-bold">Account status</h2>
          <ActionForm action={setOrgStatus} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <input type="hidden" name="org" value={id} />
            <Field label="Set status to" htmlFor="status">
              <Select id="status" name="status" defaultValue={org.status === 'active' ? 'suspended' : 'active'}>
                <option value="active">Active (reactivate)</option><option value="suspended">Suspended</option>
                {adminCan(ctx.role, 'close') && <option value="closed">Closed</option>}
              </Select>
            </Field>
            <div className="flex-1"><Field label="Reason (recorded in the audit log)" htmlFor="reason"><Input id="reason" name="reason" required minLength={3} /></Field></div>
            <SubmitButton variant="danger" pendingText="Saving…">Apply</SubmitButton>
          </ActionForm>
          {org.status_reason && <p className="mt-2 text-sm text-muted">Last reason: {org.status_reason}</p>}
        </Card>
      )}

      {adminCan(ctx.role, 'entitlements') && (
        <Card>
          <h2 className="mb-1 font-bold">Feature entitlements</h2>
          <p className="mb-3 text-sm text-muted">Plan products grant features automatically. Overrides here add or remove a feature for this account, optionally until a date.</p>
          {(overrides.data ?? []).length > 0 && (
            <ul className="mb-3 text-[15px]">{(overrides.data ?? []).map((o) => <li key={o.feature}>{o.feature}: <strong>{o.enabled ? 'on' : 'off'}</strong> — {o.reason}{o.expires_at ? ` (until ${new Date(o.expires_at).toLocaleDateString()})` : ''}</li>)}</ul>
          )}
          <ActionForm action={setFeatureOverride} className="grid gap-3 sm:grid-cols-[1fr_auto_2fr_auto_auto] sm:items-end">
            <input type="hidden" name="org" value={id} />
            <Field label="Feature" htmlFor="feature"><Input id="feature" name="feature" placeholder="wholesale" required /></Field>
            <Field label="Set" htmlFor="value"><Select id="value" name="value"><option value="on">On</option><option value="off">Off</option><option value="clear">Remove override</option></Select></Field>
            <Field label="Reason" htmlFor="ov-reason"><Input id="ov-reason" name="reason" required minLength={3} /></Field>
            <Field label="Until (optional)" htmlFor="expires"><Input id="expires" name="expires" type="date" /></Field>
            <SubmitButton variant="secondary" pendingText="Saving…">Save</SubmitButton>
          </ActionForm>
        </Card>
      )}
    </>
  );
}
