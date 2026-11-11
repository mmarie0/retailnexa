import type { Metadata } from 'next';
import Link from 'next/link';
import { can, getOrgContext, getSupabase } from '@/lib/auth/context';
import { Badge, Card, Notice, PageHeader } from '@/components/ui';
import { formatMoney, PLANS, type ProductKey } from '@/lib/billing/plans';
import { isStripeConfigured } from '@/lib/env';
import { getStripe } from '@/lib/billing/stripe';
import { CancelControls, PlanPicker, PortalButton } from './billing-forms';

export const metadata: Metadata = { title: 'Billing' };

const STATUS: Record<string, { label: string; tone: 'good' | 'info' | 'warning' | 'danger' | 'neutral' }> = {
  trialing: { label: 'Free trial', tone: 'info' },
  active: { label: 'Active', tone: 'good' },
  past_due: { label: 'Payment failed', tone: 'warning' },
  unpaid: { label: 'Unpaid', tone: 'danger' },
  canceled: { label: 'Canceled', tone: 'neutral' },
  incomplete: { label: 'Incomplete', tone: 'warning' },
  incomplete_expired: { label: 'Expired', tone: 'neutral' },
  paused: { label: 'Paused', tone: 'warning' },
};
const fmtDate = (d: Date | null) => (d ? d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '—');
const CHECKOUT_MSG: Record<string, { tone: 'info' | 'warning'; text: string }> = {
  success: { tone: 'info', text: 'Your card is saved and your plan is set up.' },
  pending: { tone: 'info', text: 'Stripe is finishing up. Refresh this page in a few seconds.' },
  canceled: { tone: 'warning', text: 'Checkout was closed before finishing. Nothing was charged.' },
};

async function invoices(orgId: string) {
  if (!isStripeConfigured()) return null;
  const supabase = await getSupabase();
  const { data } = await supabase.from('billing_accounts').select('stripe_customer_id').eq('organization_id', orgId).maybeSingle();
  if (!data) return [];
  try {
    const list = await getStripe().invoices.list({ customer: data.stripe_customer_id, limit: 24 });
    return list.data.map((i) => ({ id: i.id, number: i.number, created: new Date(i.created * 1000), total: i.total, currency: i.currency, status: i.status, url: i.hosted_invoice_url, pdf: i.invoice_pdf }));
  } catch (e) {
    console.error('[billing] invoice list failed', e);
    return null;
  }
}

export default async function BillingPage({ searchParams }: PageProps<'/app/billing'>) {
  const ctx = await getOrgContext();
  const sp = await searchParams;
  if (!can(ctx, 'billing.view')) {
    return <Notice tone="warning">Only owners and accountants can see billing. Ask an owner if your account needs attention.</Notice>;
  }
  const manage = can(ctx, 'billing.manage');
  const sub = ctx.subscription;
  const live = sub && ['trialing', 'active', 'past_due', 'unpaid', 'paused', 'incomplete'].includes(sub.status);
  const supabase = await getSupabase();
  const ownedIds = [...new Set([ctx.org.id, ...ctx.orgs.filter((o) => o.role === 'owner').map((o) => o.id)])];
  const [{ data: org }, { data: used }, { data: partner }] = await Promise.all([
    supabase.from('organizations').select('canceled_at').eq('id', ctx.org.id).single(),
    supabase.from('organizations').select('id').in('id', ownedIds).not('trial_consumed_at', 'is', null).limit(1),
    supabase.rpc('org_agent_discount', { p_org: ctx.org.id }),
  ]);
  const trialEligible = (used ?? []).length === 0 && !sub;
  const inv = can(ctx, 'billing.view') ? await invoices(ctx.org.id) : null;
  const msg = typeof sp.checkout === 'string' ? CHECKOUT_MSG[sp.checkout] : undefined;

  const defaults = {
    retail: sp.retail ? sp.retail === 'true' : ctx.org.businessType !== 'wholesale',
    wholesale: sp.wholesale ? sp.wholesale === 'true' : ctx.org.businessType !== 'retail',
    locations: Math.max(1, Number(sp.locations) || 1),
  };

  return (
    <>
      <PageHeader title="Billing" description="Your plan, payment method and invoices." />
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      {partner === true && !live && <Notice tone="good">Partner discount: 50% off the Wholesale plan is applied at checkout. Prices below are before the discount.</Notice>}
      {!isStripeConfigured() && <Notice tone="warning">Payments aren’t connected yet. An administrator needs to add the Stripe keys before plans can be started.</Notice>}

      {sub && (
        <Card className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-bold">{(sub.products as ProductKey[]).map((p) => PLANS[p]?.name ?? p).join(' + ') || 'Subscription'}</h2>
            <Badge tone={STATUS[sub.status]?.tone}>{STATUS[sub.status]?.label ?? sub.status}</Badge>
          </div>
          <dl className="grid gap-3 sm:grid-cols-3">
            {sub.status === 'trialing' && <div><dt className="text-sm text-muted">Trial ends</dt><dd className="font-semibold">{fmtDate(sub.trialEnd)}</dd></div>}
            <div>
              <dt className="text-sm text-muted">{sub.cancelAtPeriodEnd || sub.status === 'canceled' ? 'Access ends' : 'Next payment'}</dt>
              <dd className="font-semibold">{fmtDate(sub.status === 'canceled' ? (org?.canceled_at ? new Date(org.canceled_at) : null) : sub.currentPeriodEnd)}</dd>
            </div>
            {sub.products.includes('retail') && <div><dt className="text-sm text-muted">Store locations</dt><dd className="font-semibold">{1 + sub.extraLocations}</dd></div>}
          </dl>
          {manage && live && (
            <div className="flex flex-wrap items-start gap-3">
              <PortalButton />
              {['trialing', 'active', 'past_due'].includes(sub.status) && <CancelControls cancelScheduled={sub.cancelAtPeriodEnd} endsLabel={fmtDate(sub.status === 'trialing' ? sub.trialEnd : sub.currentPeriodEnd)} />}
            </div>
          )}
        </Card>
      )}

      {manage && !live && (
        <Card>
          <h2 className="mb-4 text-xl font-bold">{sub ? 'Reactivate your account' : 'Choose your plan'}</h2>
          <PlanPicker defaults={defaults} trialEligible={trialEligible} paymentsReady={isStripeConfigured()} />
        </Card>
      )}
      {!manage && !live && <Notice tone="info">An owner needs to choose a plan before the team can use RetailNexa.</Notice>}

      {sub?.status === 'canceled' && can(ctx, 'data.export') && (
        <Card><p>Your records are kept. <Link href="/app/settings/export" className="font-semibold text-accent-strong underline">Export your data</Link> at any time.</p></Card>
      )}

      {inv && inv.length > 0 && (
        <Card>
          <h2 className="mb-3 text-xl font-bold">Invoices</h2>
          <ul className="divide-y divide-line">
            {inv.map((i) => (
              <li key={i.id} className="num flex flex-wrap items-center justify-between gap-3 py-2.5">
                <span>{fmtDate(i.created)} · {i.number ?? 'Draft'}</span>
                <span className="flex items-center gap-3">
                  {formatMoney(i.total, i.currency.toUpperCase())}
                  <Badge tone={i.status === 'paid' ? 'good' : i.status === 'open' ? 'warning' : 'neutral'}>{i.status ?? '—'}</Badge>
                  {i.url && <a href={i.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-accent-strong">View</a>}
                  {i.pdf && <a href={i.pdf} className="font-semibold text-accent-strong">PDF</a>}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
