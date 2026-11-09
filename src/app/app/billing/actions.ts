'use server';
import { redirect } from 'next/navigation';
import { can, getOrgContext, getSupabase } from '@/lib/auth/context';
import { getStripe } from '@/lib/billing/stripe';
import { liveWebhookDeps } from '@/lib/billing/deps';
import { syncFromStripe } from '@/lib/billing/webhook';
import { checkoutLineItems, formatMoney, monthlyTotalCents, normalizeSelection, TRIAL_DAYS } from '@/lib/billing/plans';
import { siteUrl, stripeEnv } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase/admin';
import { fail, failFrom, ok, type ActionState } from '@/lib/actions';

const LIVE = ['trialing', 'active', 'past_due', 'unpaid', 'paused', 'incomplete'];

async function billingContext() {
  const ctx = await getOrgContext();
  if (!can(ctx, 'billing.manage')) throw Object.assign(new Error('permission denied'), { code: '42501' });
  return ctx;
}

async function auditUser(orgId: string, userId: string, action: string, metadata: Record<string, unknown>) {
  const { error } = await createAdminClient().from('audit_logs').insert({ organization_id: orgId, actor_user_id: userId, actor_type: 'user', action, metadata });
  if (error) console.error('[audit] failed', action, error);
}

async function ensureCustomer(orgId: string, orgName: string, email: string) {
  const supabase = await getSupabase();
  const { data: existing } = await supabase.from('billing_accounts').select('stripe_customer_id').eq('organization_id', orgId).maybeSingle();
  if (existing) return existing.stripe_customer_id as string;
  const customer = await getStripe().customers.create(
    { email, name: orgName, metadata: { organization_id: orgId } },
    { idempotencyKey: `customer-create:${orgId}` },
  );
  const { data: stored, error } = await createAdminClient().rpc('link_billing_customer', { p_org: orgId, p_customer: customer.id, p_email: email });
  if (error) throw error;
  return stored as string;
}

export async function startCheckout(_p: ActionState, form: FormData): Promise<ActionState> {
  let url: string | null = null;
  try {
    const ctx = await billingContext();
    if (ctx.subscription && LIVE.includes(ctx.subscription.status)) {
      return fail('You already have a subscription. Use “Manage payment method and invoices” to change it.');
    }
    const sel = normalizeSelection({
      retail: form.get('retail') === 'on',
      wholesale: form.get('wholesale') === 'on',
      extraLocations: Number(form.get('locations') ?? 1) - 1,
    });
    if (!sel.retail && !sel.wholesale) return fail('Choose Retail, Wholesale or both.');

    const supabase = await getSupabase();
    const { data: org, error: orgErr } = await supabase.from('organizations').select('trial_consumed_at').eq('id', ctx.org.id).single();
    if (orgErr) throw orgErr;
    const trial = !org.trial_consumed_at && !ctx.subscription;

    const customer = await ensureCustomer(ctx.org.id, ctx.org.name, ctx.user.email);
    const firstCharge = new Date(Date.now() + TRIAL_DAYS * 86_400_000).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    const session = await getStripe().checkout.sessions.create({
      mode: 'subscription',
      customer,
      client_reference_id: ctx.org.id,
      line_items: checkoutLineItems(sel, stripeEnv().prices),
      payment_method_collection: 'always',
      subscription_data: {
        metadata: { organization_id: ctx.org.id },
        ...(trial ? { trial_period_days: TRIAL_DAYS, trial_settings: { end_behavior: { missing_payment_method: 'cancel' } } } : {}),
      },
      metadata: { organization_id: ctx.org.id },
      customer_update: { address: 'auto', name: 'auto' },
      billing_address_collection: 'auto',
      allow_promotion_codes: true,
      ...(trial ? { custom_text: { submit: { message: `You won’t be charged today. Your first payment of ${formatMoney(monthlyTotalCents(sel))} plus any applicable tax is on ${firstCharge} unless you cancel before then.` } } } : {}),
      success_url: `${siteUrl()}/app/billing/return?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl()}/app/billing?checkout=canceled`,
    });
    await auditUser(ctx.org.id, ctx.user.id, trial ? 'billing.checkout_started_trial' : 'billing.checkout_started', { products: [sel.retail && 'retail', sel.wholesale && 'wholesale'].filter(Boolean), extra_locations: sel.extraLocations });
    url = session.url;
  } catch (e) {
    return failFrom(e);
  }
  if (!url) return fail('Stripe did not return a checkout page. Try again.');
  redirect(url);
}

export async function openPortal(): Promise<ActionState> {
  let url: string;
  try {
    const ctx = await billingContext();
    const supabase = await getSupabase();
    const { data } = await supabase.from('billing_accounts').select('stripe_customer_id').eq('organization_id', ctx.org.id).maybeSingle();
    if (!data) return fail('No billing account yet. Start a plan first.');
    const s = await getStripe().billingPortal.sessions.create({ customer: data.stripe_customer_id, return_url: `${siteUrl()}/app/billing` });
    url = s.url;
  } catch (e) {
    return failFrom(e);
  }
  redirect(url);
}

async function setCancelAtPeriodEnd(cancel: boolean): Promise<ActionState> {
  try {
    const ctx = await billingContext();
    const supabase = await getSupabase();
    const { data: sub } = await supabase.from('subscriptions').select('stripe_subscription_id, status, cancel_at_period_end').eq('organization_id', ctx.org.id).maybeSingle();
    if (!sub || !['trialing', 'active', 'past_due'].includes(sub.status)) return fail('There is no active subscription to change.');
    if (sub.cancel_at_period_end === cancel) return ok(cancel ? 'Your subscription is already set to end.' : 'Your subscription is already active.');
    await getStripe().subscriptions.update(
      sub.stripe_subscription_id,
      { cancel_at_period_end: cancel },
      { idempotencyKey: `cancel-${cancel}:${sub.stripe_subscription_id}:${Math.floor(Date.now() / 60_000)}` },
    );
    await syncFromStripe(liveWebhookDeps(), sub.stripe_subscription_id, null);
    await auditUser(ctx.org.id, ctx.user.id, cancel ? 'billing.cancel_requested' : 'billing.cancel_reverted', { subscription: sub.stripe_subscription_id });
    return ok(cancel
      ? 'Your subscription will end at the close of the current period. Your records are kept.'
      : 'Your subscription will continue as normal.');
  } catch (e) {
    return failFrom(e);
  }
}

export async function cancelSubscription(_p: ActionState): Promise<ActionState> {
  return setCancelAtPeriodEnd(true);
}

export async function resumeSubscription(_p: ActionState): Promise<ActionState> {
  return setCancelAtPeriodEnd(false);
}
