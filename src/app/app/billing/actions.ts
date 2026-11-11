'use server';
import { redirect } from 'next/navigation';
import { can, getOrgContext, getSupabase } from '@/lib/auth/context';
import { getStripe } from '@/lib/billing/stripe';
import { liveWebhookDeps } from '@/lib/billing/deps';
import { syncFromStripe } from '@/lib/billing/webhook';
import { checkoutLineItems, formatMoney, monthlyTotalCents, normalizeSelection, TRIAL_DAYS } from '@/lib/billing/plans';
import { agentCouponId, siteUrl, stripeEnv } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase/admin';
import { fail, failFrom, ok, type ActionState } from '@/lib/actions';
import { CheckoutBlockedError, guardedCheckout, type CheckoutGuardDeps } from '@/lib/billing/checkout-guard';

function checkoutGuardDeps(): CheckoutGuardDeps {
  const stripe = getStripe();
  const admin = createAdminClient();
  return {
    listSubscriptionStatuses: async (customer) =>
      (await stripe.subscriptions.list({ customer, status: 'all', limit: 20 })).data.map((s) => s.status),
    beginCheckout: async (org) => {
      const { data, error } = await admin.rpc('begin_checkout', { p_org: org });
      if (error) throw error;
      return (data as string | null) ?? null;
    },
    finishCheckout: async (org, session) => {
      const { error } = await admin.rpc('finish_checkout', { p_org: org, p_session: session });
      if (error) console.error('[checkout] finish failed', error.message);
    },
    expireSessionIfOpen: async (id) => {
      const s = await stripe.checkout.sessions.retrieve(id);
      if (s.status === 'open') await stripe.checkout.sessions.expire(id);
    },
  };
}

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

    // One free trial per owner, not per business: no trial if any business this user owns has had one.
    const ownedIds = ctx.orgs.filter((o) => o.role === 'owner').map((o) => o.id);
    const supabase = await getSupabase();
    const { data: used, error: orgErr } = await supabase.from('organizations').select('id').in('id', [...new Set([ctx.org.id, ...ownedIds])]).not('trial_consumed_at', 'is', null).limit(1);
    if (orgErr) throw orgErr;
    let trial = (used ?? []).length === 0 && !ctx.subscription;
    let claimedTrial = false;
    if (trial) {
      // Claim the owner's one trial now, so a second business's Checkout started at the same time gets none (#17).
      const { data: holder, error: claimErr } = await createAdminClient().rpc('claim_trial', { p_user: ctx.user.id, p_org: ctx.org.id });
      if (claimErr) throw claimErr;
      claimedTrial = holder === ctx.org.id;
      if (!claimedTrial && form.get('skip_trial') !== 'on') {
        // Don't silently charge on day one: say why there's no trial and let the owner choose (#73).
        const other = ctx.orgs.find((o) => o.id === holder)?.name ?? 'another business';
        return { ...fail(`Your free trial is reserved by a checkout started for ${other} in the last day. Finish that checkout, or pay now without the trial.`), data: { trialReserved: '1' } };
      }
      trial = claimedTrial;
    }

    const releaseClaim = async () => {
      if (!claimedTrial) return;
      const { error } = await createAdminClient().rpc('release_trial_claim', { p_user: ctx.user.id, p_org: ctx.org.id });
      if (error) console.error('[checkout] could not release trial claim', error.message);
    };
    // A sales agent's one wholesale account gets 50% off through the owner's Stripe coupon.
    const { data: partner, error: partnerErr } = await supabase.rpc('org_agent_discount', { p_org: ctx.org.id });
    if (partnerErr) throw partnerErr;
    const coupon = partner && sel.wholesale ? agentCouponId() : null;
    if (partner && sel.wholesale && !coupon) {
      await releaseClaim();
      return fail('Your partner discount isn’t set up yet. Contact RetailNexa support before you subscribe so you aren’t charged full price.');
    }
    let session: { url: string | null };
    try {
      const customer = await ensureCustomer(ctx.org.id, ctx.org.name, ctx.user.email);
      const firstCharge = new Date(Date.now() + TRIAL_DAYS * 86_400_000).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
      session = await guardedCheckout(checkoutGuardDeps(), ctx.org.id, customer, () => getStripe().checkout.sessions.create({
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
        // Stripe allows either a fixed discount or customer-entered promotion codes, not both.
        ...(coupon ? { discounts: [{ coupon }] } : { allow_promotion_codes: true }),
        ...(trial ? { custom_text: { submit: { message: coupon
          ? `You won’t be charged today. Your first payment, with your partner discount, plus any applicable tax is on ${firstCharge} unless you cancel before then.`
          : `You won’t be charged today. Your first payment of ${formatMoney(monthlyTotalCents(sel))} plus any applicable tax is on ${firstCharge} unless you cancel before then.` } } } : {}),
        success_url: `${siteUrl()}/app/billing/return?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${siteUrl()}/app/billing?checkout=canceled`,
      }));
    } catch (e) {
      // This attempt never opened a Checkout, so its trial isn't spoken for (#73). A blocked
      // attempt (another checkout in progress, or already subscribed) must not release a
      // claim that may back a still-open session (#80); the database also refuses then.
      if (!(e instanceof CheckoutBlockedError)) await releaseClaim();
      throw e;
    }
    await auditUser(ctx.org.id, ctx.user.id, trial ? 'billing.checkout_started_trial' : 'billing.checkout_started', { products: [sel.retail && 'retail', sel.wholesale && 'wholesale'].filter(Boolean), extra_locations: sel.extraLocations, partner_discount: !!coupon });
    url = session.url;
  } catch (e) {
    if (e instanceof CheckoutBlockedError) return fail(e.message);
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
    // Stripe ids are not readable by members (column grants); read them server-side after the permission check.
    const { data: sub } = await createAdminClient().from('subscriptions').select('stripe_subscription_id, status, cancel_at_period_end').eq('organization_id', ctx.org.id).maybeSingle();
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
