'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { adminCan, getAdminContext } from '@/lib/auth/context';
import { getStripe } from '@/lib/billing/stripe';
import { agentCouponId, siteUrl } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase/admin';
import { fail, failFrom, ok, type ActionState } from '@/lib/actions';

const resetTo = () => `${siteUrl()}/auth/confirm?next=/reset-password`;

/**
 * Add a sales agent: creates their login (or uses the existing one for that
 * email), saves the agent record, and emails a link to set their password.
 * Creating the login is the one service-role step (Auth admin API).
 */
export async function addAgent(_p: ActionState, form: FormData): Promise<ActionState> {
  let id: string | null = null;
  try {
    const ctx = await getAdminContext();
    if (!adminCan(ctx.role, 'agents')) return fail('Only a superadmin can add sales agents.');
    const f = z.object({
      name: z.string().trim().min(1, 'Enter their name').max(120), email: z.string().trim().toLowerCase().email('Enter their email').max(200),
      phone: z.string().trim().max(40).default(''), ref_code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{4,20}$/, '4 to 20 letters or numbers'),
    }).safeParse(Object.fromEntries(form));
    if (!f.success) return fail('Check the highlighted fields.', Object.fromEntries(f.error.issues.map((i) => [String(i.path[0]), i.message])));
    const v = f.data;
    const { data: existing } = await ctx.supabase.from('profiles').select('id').eq('email', v.email).maybeSingle();
    id = existing?.id ?? null;
    if (!id) {
      const { data, error } = await createAdminClient().auth.admin.createUser({ email: v.email, email_confirm: true, user_metadata: { full_name: v.name } });
      if (error || !data.user) return fail(error?.message && /registered|exists/i.test(error.message) ? 'That email already has a login. Try again in a minute.' : 'Couldn’t create the login. Try again.');
      id = data.user.id;
    }
    const { error } = await ctx.supabase.rpc('admin_save_sales_agent', { p_user: id, p_name: v.name, p_phone: v.phone || null, p_ref_code: v.ref_code, p_active: true, p_notes: null });
    if (error) throw error;
    const { error: mailErr } = await ctx.supabase.auth.resetPasswordForEmail(v.email, { redirectTo: resetTo() });
    if (mailErr) console.error('[agents] reset email failed', mailErr.message);
    revalidatePath('/admin/agents');
  } catch (e) { return failFrom(e); }
  redirect(`/admin/agents/${id}?added=1`);
}

export async function updateAgent(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await getAdminContext();
    if (!adminCan(ctx.role, 'agents')) return fail('Only a superadmin can change sales agents.');
    const f = z.object({
      id: z.string().uuid(), name: z.string().trim().min(1).max(120), phone: z.string().trim().max(40).default(''),
      ref_code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{4,20}$/, '4 to 20 letters or numbers'), notes: z.string().max(2000).default(''),
    }).safeParse(Object.fromEntries(form));
    if (!f.success) return fail('Check the highlighted fields.', Object.fromEntries(f.error.issues.map((i) => [String(i.path[0]), i.message])));
    const v = f.data;
    const { error } = await ctx.supabase.rpc('admin_save_sales_agent', { p_user: v.id, p_name: v.name, p_phone: v.phone || null, p_ref_code: v.ref_code, p_active: form.getAll('active').includes('true'), p_notes: v.notes || null });
    if (error) throw error;
    revalidatePath(`/admin/agents/${v.id}`);
    return ok('Saved.');
  } catch (e) { return failFrom(e); }
}

export async function sendAgentReset(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await getAdminContext();
    if (!adminCan(ctx.role, 'agents')) return fail('Only a superadmin can do that.');
    const id = z.string().uuid().safeParse(form.get('id'));
    if (!id.success) return fail('Agent not found.');
    const { data: a } = await ctx.supabase.from('sales_agents').select('email').eq('user_id', id.data).maybeSingle();
    if (!a) return fail('Agent not found.');
    const { error } = await ctx.supabase.auth.resetPasswordForEmail(a.email, { redirectTo: resetTo() });
    if (error) throw error;
    await createAdminClient().from('audit_logs').insert({ actor_user_id: ctx.user.id, actor_type: 'platform_admin', action: 'sales_agent.password_reset_sent', target_type: 'user', target_id: id.data });
    return ok(`Reset link sent to ${a.email}.`);
  } catch (e) { return failFrom(e); }
}

/** Credit an account to an agent, or clear it. */
export async function assignAgent(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await getAdminContext();
    if (!adminCan(ctx.role, 'entitlements')) return fail('Your admin role can’t do that.');
    const f = z.object({ org: z.string().uuid(), agent: z.string().uuid().or(z.literal('')) }).safeParse(Object.fromEntries(form));
    if (!f.success) return fail('Pick an agent.');
    const { error } = await ctx.supabase.rpc('admin_assign_sales_agent', { p_org: f.data.org, p_agent: f.data.agent || null });
    if (error) throw error;
    revalidatePath(`/admin/tenants/${f.data.org}`);
    revalidatePath('/admin/agents', 'layout');
    return ok(f.data.agent ? 'Account credited to the agent.' : 'Agent removed from this account.');
  } catch (e) { return failFrom(e); }
}

export async function setAgentDiscount(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await getAdminContext();
    if (!adminCan(ctx.role, 'entitlements')) return fail('Your admin role can’t do that.');
    const f = z.object({ id: z.string().uuid(), org: z.string().uuid().or(z.literal('')) }).safeParse(Object.fromEntries(form));
    if (!f.success) return fail('Pick an account.');
    const { error } = await ctx.supabase.rpc('admin_set_agent_discount', { p_agent: f.data.id, p_org: f.data.org || null });
    if (error) throw error;
    revalidatePath(`/admin/agents/${f.data.id}`);
    return ok(f.data.org ? 'Discount account saved. New checkouts for it get 50% off Wholesale.' : 'Discount account cleared.');
  } catch (e) { return failFrom(e); }
}

/**
 * Add the partner coupon to the discount account's existing subscription
 * (for agents who subscribed before they picked it). Explicit admin action only.
 */
export async function applyDiscountToSubscription(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await getAdminContext();
    if (!adminCan(ctx.role, 'entitlements')) return fail('Your admin role can’t do that.');
    const id = z.string().uuid().safeParse(form.get('id'));
    if (!id.success) return fail('Agent not found.');
    const coupon = agentCouponId();
    if (!coupon) return fail('Set STRIPE_COUPON_AGENT_WHOLESALE first (the 50% coupon in Stripe).');
    const { data: a } = await ctx.supabase.from('sales_agents').select('discount_org_id, is_active').eq('user_id', id.data).maybeSingle();
    if (!a?.discount_org_id || !a.is_active) return fail('This agent has no active discount account.');
    // Stripe ids aren't readable through the API roles; read it server-side after the admin check.
    const { data: sub } = await createAdminClient().from('subscriptions').select('stripe_subscription_id, status, products').eq('organization_id', a.discount_org_id).maybeSingle();
    if (!sub || !['trialing', 'active', 'past_due'].includes(sub.status)) return fail('That account has no live subscription. The discount will apply at checkout.');
    if (!(sub.products as string[]).includes('wholesale')) return fail('That subscription doesn’t include Wholesale.');
    await getStripe().subscriptions.update(sub.stripe_subscription_id, { discounts: [{ coupon }] }, { idempotencyKey: `agent-discount:${sub.stripe_subscription_id}:${coupon}` });
    await createAdminClient().from('audit_logs').insert({ organization_id: a.discount_org_id, actor_user_id: ctx.user.id, actor_type: 'platform_admin', action: 'sales_agent.discount_applied', target_type: 'subscription', target_id: sub.stripe_subscription_id });
    return ok('Partner discount added to the subscription in Stripe. It applies from the next invoice.');
  } catch (e) { return failFrom(e); }
}
