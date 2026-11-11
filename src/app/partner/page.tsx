import type { Metadata } from 'next';
import Link from 'next/link';
import { getAgentContext } from '@/lib/auth/context';
import { ActionForm } from '@/components/action-form';
import { Badge, Card, Eyebrow, Field, Input, LinkButton, Notice, Select, Textarea } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';
import { formatMoney } from '@/lib/billing/plans';
import { siteUrl } from '@/lib/env';
import { STAGE, bookSummary, planCents, stageOf, type AgentClient } from '@/lib/partners';
import { Stat } from '../app/_dashboard/tiles';
import { CopyLink } from './copy-link';
import { chooseDiscountAccount, deleteProspect, saveProspect } from './actions';

export const metadata: Metadata = { title: 'Partner' };

const STATUS: [string, string][] = [['new', 'New'], ['contacted', 'Contacted'], ['demo', 'Demo'], ['trial', 'On trial'], ['won', 'Won'], ['lost', 'Lost']];
const TYPES: [string, string][] = [['', '—'], ['retail', 'Retail'], ['wholesale', 'Wholesale'], ['both', 'Both']];
const day = (d: string) => new Date(d.length === 10 ? `${d}T12:00:00Z` : d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

interface Prospect { id: string; business_name: string; contact: string | null; email: string | null; phone: string | null; business_type: string | null; status: string; follow_up: string | null; notes: string | null }

function ProspectFields({ p }: { p?: Prospect }) {
  const k = p?.id ?? 'new';
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <input type="hidden" name="id" value={p?.id ?? ''} />
      <Field label="Business" htmlFor={`${k}-b`}><Input id={`${k}-b`} name="business_name" defaultValue={p?.business_name} required maxLength={120} /></Field>
      <Field label="Contact (optional)" htmlFor={`${k}-c`}><Input id={`${k}-c`} name="contact" defaultValue={p?.contact ?? ''} maxLength={80} /></Field>
      <Field label="Phone (optional)" htmlFor={`${k}-p`}><Input id={`${k}-p`} name="phone" type="tel" defaultValue={p?.phone ?? ''} maxLength={40} /></Field>
      <Field label="Email (optional)" htmlFor={`${k}-e`}><Input id={`${k}-e`} name="email" type="email" defaultValue={p?.email ?? ''} maxLength={200} /></Field>
      <Field label="Type" htmlFor={`${k}-t`}><Select id={`${k}-t`} name="business_type" defaultValue={p?.business_type ?? ''}>{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
      <Field label="Stage" htmlFor={`${k}-s`}><Select id={`${k}-s`} name="status" defaultValue={p?.status ?? 'new'}>{STATUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
      <Field label="Follow up on (optional)" htmlFor={`${k}-f`}><Input id={`${k}-f`} name="follow_up" type="date" defaultValue={p?.follow_up ?? ''} /></Field>
      <div className="sm:col-span-2"><Field label="Notes (optional)" htmlFor={`${k}-n`}><Textarea id={`${k}-n`} name="notes" rows={2} defaultValue={p?.notes ?? ''} maxLength={2000} /></Field></div>
    </div>
  );
}

/** A sales agent's page: their MRR, accounts, referral link, prospects and their own 50%-off Wholesale account. */
export default async function PartnerPage() {
  const { agent, orgs, supabase } = await getAgentContext();
  const [{ data: rows, error }, { data: prospectRows }] = await Promise.all([
    supabase.rpc('agent_clients'),
    supabase.from('agent_prospects').select('id, business_name, contact, email, phone, business_type, status, follow_up, notes').eq('agent_id', agent.userId).order('follow_up', { ascending: true, nullsFirst: false }).limit(2000),
  ]);
  if (error) throw error;
  const clients = (rows ?? []) as AgentClient[];
  const prospects = (prospectRows ?? []) as Prospect[];
  const s = bookSummary(clients);
  let link = `/?ref=${agent.refCode}`;
  try { link = `${siteUrl()}/?ref=${agent.refCode}`; } catch { /* site URL not configured */ }
  const today = new Date().toISOString().slice(0, 10);
  const ownedWs = orgs.filter((o) => o.role === 'owner' && o.businessType !== 'retail');
  const discount = orgs.find((o) => o.id === agent.discountOrgId);
  const open = prospects.filter((p) => !['won', 'lost'].includes(p.status));
  const due = open.filter((p) => p.follow_up && p.follow_up <= today);

  return (
    <>
      <div>
        <h1 className="text-[26px] font-extrabold tracking-[-.02em]">Hi, {agent.name.split(' ')[0]}</h1>
        <p className="text-muted">Your accounts and what they bring in each month. Amounts are at list price, before discounts and tax.</p>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat block="blue" hero label="Your MRR" value={formatMoney(s.mrrCents)} sub={`${s.paying} paying`} />
        <Stat label="Free trials" value={String(s.trialing)} sub={`${formatMoney(s.trialPipelineCents)}/mo if they stay`} />
        <Stat label="Accounts" value={String(s.accounts)} sub={`${s.newThisMonth} new this month`} />
        <Stat block={s.pastDue || s.noPlan ? 'coral' : undefined} label="Need a nudge" value={String(s.pastDue + s.noPlan)} sub={`${s.pastDue} payment failed · ${s.noPlan} no plan yet`} />
      </div>

      <Card className="flex flex-col gap-2">
        <h2 className="font-bold">Your referral link</h2>
        <p className="text-sm text-muted">Send this to businesses. When they sign up through it, the account is credited to you.</p>
        <CopyLink url={link} />
        <p className="text-xs text-muted">Code {agent.refCode}. If someone signed up without your link, ask RetailNexa support to credit the account to you.</p>
      </Card>

      <section className="flex flex-col gap-2">
        <Eyebrow>Your accounts</Eyebrow>
        {clients.length ? (
          <ul className="flex flex-col gap-2">
            {clients.map((c) => {
              const st = stageOf(c);
              return (
                <li key={c.organization_id} className="flex flex-wrap items-start justify-between gap-2 rounded-[16px] bg-card px-4 py-3 shadow-[var(--shadow-card)]">
                  <span className="min-w-0">
                    <span className="block font-bold">{c.name}</span>
                    <span className="text-sm text-muted">
                      {[c.business_type === 'both' ? 'Retail + Wholesale' : c.business_type === 'wholesale' ? 'Wholesale' : 'Retail', `since ${day(c.since ?? c.created_at)}`,
                        st === 'trial' && c.trial_end ? `trial ends ${day(c.trial_end)}` : null, c.cancel_at_period_end && c.current_period_end ? `cancels ${day(c.current_period_end)}` : null].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <span className="flex flex-col items-end gap-1"><span className="num font-semibold">{c.products.length ? `${formatMoney(planCents(c))}/mo` : '—'}</span><Badge tone={STAGE[st].tone}>{STAGE[st].label}</Badge></span>
                </li>
              );
            })}
          </ul>
        ) : <p className="text-muted">No accounts yet. Share your link to get started.</p>}
      </section>

      <section className="flex flex-col gap-2">
        <Eyebrow>Prospects · {open.length} open{due.length ? ` · ${due.length} to follow up` : ''}</Eyebrow>
        {prospects.length > 0 && (
          <ul className="flex flex-col gap-2">
            {prospects.map((p) => (
              <li key={p.id}>
                <Card className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <span className="min-w-0"><span className="block font-bold">{p.business_name}</span>
                      <span className="text-sm text-muted">{[p.contact, p.phone, p.email].filter(Boolean).join(' · ') || 'No contact details'}</span></span>
                    <span className="flex flex-col items-end gap-1">
                      <Badge tone={p.status === 'won' ? 'good' : p.status === 'lost' ? 'neutral' : 'info'}>{STATUS.find(([v]) => v === p.status)?.[1]}</Badge>
                      {p.follow_up && !['won', 'lost'].includes(p.status) && <span className={p.follow_up <= today ? 'text-xs font-semibold text-late' : 'text-xs text-muted'}>Follow up {day(p.follow_up)}</span>}
                    </span>
                  </div>
                  {p.notes && <p className="whitespace-pre-line text-sm text-muted">{p.notes}</p>}
                  <details>
                    <summary className="cursor-pointer text-sm font-semibold text-muted">Edit</summary>
                    <ActionForm action={saveProspect} className="mt-2 flex flex-col gap-3"><ProspectFields p={p} /><div><SubmitButton size="sm">Save</SubmitButton></div></ActionForm>
                    <ActionForm action={deleteProspect} className="mt-2" quiet><input type="hidden" name="id" value={p.id} /><SubmitButton size="sm" variant="ghost">Remove</SubmitButton></ActionForm>
                  </details>
                </Card>
              </li>
            ))}
          </ul>
        )}
        <Card>
          <h2 className="font-bold">Add a prospect</h2>
          <ActionForm action={saveProspect} className="mt-3 flex flex-col gap-3"><ProspectFields /><div><SubmitButton>Add prospect</SubmitButton></div></ActionForm>
        </Card>
      </section>

      <Card className="flex flex-col gap-2">
        <h2 className="font-bold">Your own Wholesale account: 50% off</h2>
        {discount ? (
          <>
            <p className="text-[15px]"><strong>{discount.name}</strong> gets 50% off the Wholesale plan. It’s applied when you start the plan on its Billing page.</p>
            <div><LinkButton href="/app/billing" size="sm" variant="secondary">Open billing</LinkButton></div>
            <p className="text-xs text-muted">One account per partner. To move the discount, contact RetailNexa support.</p>
          </>
        ) : ownedWs.length ? (
          <ActionForm action={chooseDiscountAccount} className="flex flex-wrap items-end gap-2">
            <Field label="Which account?" htmlFor="dorg"><Select id="dorg" name="org" required>{ownedWs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</Select></Field>
            <SubmitButton size="sm">Use my discount here</SubmitButton>
            <p className="w-full text-xs text-muted">You can pick one account, once. Pick it before you start the Wholesale plan so checkout includes the discount.</p>
          </ActionForm>
        ) : (
          <>
            <p className="text-[15px]">You don’t have a Wholesale account yet. Create one, come back here to pick it, then start the plan.</p>
            <div><LinkButton href="/onboarding?new=1&retail=false&wholesale=true" size="sm">Create my Wholesale account</LinkButton></div>
          </>
        )}
        {orgs.length > 0 && !discount && ownedWs.length === 0 && <Notice>Your current business is Retail only. The discount is for a Wholesale (or Retail + Wholesale) account.</Notice>}
      </Card>
      <p className="text-center text-xs text-muted">Questions about your accounts? <Link href="/help" className="underline">Contact RetailNexa</Link>.</p>
    </>
  );
}
