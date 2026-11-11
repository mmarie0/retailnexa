import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { adminCan, getAdminContext } from '@/lib/auth/context';
import { ActionForm } from '@/components/action-form';
import { Badge, Card, Field, Input, Notice, PageHeader, Select, Textarea } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';
import { KpiTile } from '@/components/data/kpi-tile';
import { formatMoney } from '@/lib/billing/plans';
import { agentCouponId, siteUrl } from '@/lib/env';
import { STAGE, bookSummary, planCents, stageOf } from '@/lib/partners';
import { applyDiscountToSubscription, sendAgentReset, setAgentDiscount, updateAgent } from '../actions';
import { agentBooks } from '../_data';

export const metadata: Metadata = { title: 'Sales agent' };

export default async function AgentPage({ params, searchParams }: PageProps<'/admin/agents/[id]'>) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const sp = await searchParams;
  const ctx = await getAdminContext();
  const { data: a } = await ctx.supabase.from('sales_agents').select('user_id, name, email, phone, ref_code, is_active, discount_org_id, notes, created_at').eq('user_id', id).maybeSingle();
  if (!a) notFound();
  const [books, { data: owned }] = await Promise.all([
    agentBooks(ctx.supabase, id),
    ctx.supabase.from('memberships').select('organization_id, organizations!inner(id, name, business_type)').eq('user_id', id).eq('role', 'owner').eq('status', 'active'),
  ]);
  const clients = books.get(id) ?? [];
  const s = bookSummary(clients);
  const wsOwned = (owned ?? []).map((m) => m.organizations as unknown as { id: string; name: string; business_type: string }).filter((o) => o.business_type !== 'retail');
  const discountOrg = wsOwned.find((o) => o.id === a.discount_org_id);
  const manage = adminCan(ctx.role, 'agents'), billing = adminCan(ctx.role, 'entitlements');
  let link = `/?ref=${a.ref_code}`;
  try { link = `${siteUrl()}/?ref=${a.ref_code}`; } catch { /* site URL not configured */ }

  return (
    <>
      <PageHeader title={a.name} description={`${a.email}${a.phone ? ` · ${a.phone}` : ''} · agent since ${new Date(a.created_at).toLocaleDateString()}`} />
      {sp.added && <Notice tone="good">Agent added. A link to set their password was emailed to {a.email}.</Notice>}
      <div className="flex flex-wrap gap-2">
        <Badge tone={a.is_active ? 'good' : 'neutral'}>{a.is_active ? 'Active' : 'Inactive'}</Badge>
        <Badge tone="info">Referral link: {link}</Badge>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <KpiTile tone="indigo" label="MRR" value={formatMoney(s.mrrCents)} footnote={`${s.paying} paying`} />
        <KpiTile label="Free trials" value={String(s.trialing)} footnote={`${formatMoney(s.trialPipelineCents)}/mo if all convert`} />
        <KpiTile label="Accounts" value={String(s.accounts)} footnote={`${s.newThisMonth} new this month`} />
        <KpiTile label="Payment failed" value={String(s.pastDue)} footnote={`${formatMoney(s.churningCents)}/mo set to cancel`} />
      </div>

      <Card>
        <h2 className="mb-2 font-bold">Their accounts</h2>
        {clients.length ? (
          <ul className="divide-y divide-line">
            {clients.map((c) => {
              const st = stageOf(c);
              return (
                <li key={c.organization_id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span><Link href={`/admin/tenants/${c.organization_id}`} className="font-semibold text-accent-strong">{c.name}</Link>
                    <span className="block text-sm text-muted">{c.business_type} · {c.source === 'referral' ? 'referral link' : 'added by admin'} · {new Date(c.since ?? c.created_at).toLocaleDateString()}</span></span>
                  <span className="flex items-center gap-2"><Badge tone={STAGE[st].tone}>{STAGE[st].label}</Badge><span className="num">{c.products.length ? `${formatMoney(planCents(c))}/mo` : '—'}</span></span>
                </li>
              );
            })}
          </ul>
        ) : <p className="text-muted">No accounts yet. Credit one from the customer’s page, or they come in through the referral link.</p>}
      </Card>

      <Card>
        <h2 className="font-bold">50% off their own Wholesale account (one account)</h2>
        <p className="mt-1 text-sm text-muted">
          {discountOrg ? <>Discount account: <Link href={`/admin/tenants/${discountOrg.id}`} className="font-semibold text-accent-strong">{discountOrg.name}</Link>.</> : 'No discount account chosen yet. The agent can pick it on their partner page, or you can set it here.'}
          {' '}The coupon is applied at checkout.{agentCouponId() ? '' : ' STRIPE_COUPON_AGENT_WHOLESALE isn’t set yet, so checkout for that account is paused until it is.'}
        </p>
        {billing && (
          <ActionForm action={setAgentDiscount} className="mt-3 flex flex-wrap items-end gap-2">
            <input type="hidden" name="id" value={a.user_id} />
            <Field label="Account" htmlFor="dorg">
              <Select id="dorg" name="org" defaultValue={a.discount_org_id ?? ''}>
                <option value="">None</option>
                {wsOwned.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </Select>
            </Field>
            <SubmitButton size="sm" variant="secondary">Save</SubmitButton>
          </ActionForm>
        )}
        {billing && a.discount_org_id && (
          <ActionForm action={applyDiscountToSubscription} className="mt-2">
            <input type="hidden" name="id" value={a.user_id} />
            <SubmitButton size="sm" variant="ghost">Add the discount to their current subscription in Stripe</SubmitButton>
            <p className="text-sm text-muted">Only needed if they subscribed before the account was chosen.</p>
          </ActionForm>
        )}
        {!wsOwned.length && <p className="mt-2 text-sm text-muted">They don’t own a Wholesale or Both account yet. They can create one from their partner page.</p>}
      </Card>

      {manage && (
        <Card>
          <h2 className="font-bold">Agent details</h2>
          <ActionForm action={updateAgent} className="mt-3 grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="id" value={a.user_id} />
            <Field label="Name" htmlFor="n"><Input id="n" name="name" defaultValue={a.name} required maxLength={120} /></Field>
            <Field label="Phone" htmlFor="p"><Input id="p" name="phone" defaultValue={a.phone ?? ''} maxLength={40} /></Field>
            <Field label="Referral code" htmlFor="c" hint="Changing it stops the old link from working."><Input id="c" name="ref_code" defaultValue={a.ref_code} required maxLength={20} className="uppercase" /></Field>
            <label className="flex items-center gap-2 self-end text-[15px]"><input type="hidden" name="active" value="false" /><input type="checkbox" name="active" value="true" defaultChecked={a.is_active} className="size-4 accent-[#3f63de]" />Active (untick to turn off their partner page and discount)</label>
            <div className="sm:col-span-2"><Field label="Private notes" htmlFor="no"><Textarea id="no" name="notes" rows={2} maxLength={2000} defaultValue={a.notes ?? ''} /></Field></div>
            <div><SubmitButton size="sm">Save</SubmitButton></div>
          </ActionForm>
          <ActionForm action={sendAgentReset} className="mt-3"><input type="hidden" name="id" value={a.user_id} /><SubmitButton size="sm" variant="secondary">Email a new password link</SubmitButton></ActionForm>
        </Card>
      )}
    </>
  );
}
