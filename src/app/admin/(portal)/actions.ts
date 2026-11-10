'use server';
import { isFeatureKey, overrideUntilError } from '@/lib/billing/feature-keys';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { adminCan, getAdminContext } from '@/lib/auth/context';
import { createAdminClient } from '@/lib/supabase/admin';
import { siteUrl } from '@/lib/env';
import { fail, failFrom, ok, type ActionState } from '@/lib/actions';

// Every admin write goes through a SECURITY DEFINER RPC that re-checks the
// platform role + MFA (aal2) in the database and writes the audit log.

export async function setOrgStatus(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await getAdminContext();
    const parsed = z.object({ org: z.string().uuid(), status: z.enum(['active', 'suspended', 'closed']), reason: z.string().trim().min(3, 'Give a reason').max(500) }).safeParse(Object.fromEntries(form));
    if (!parsed.success) return fail(parsed.error.issues[0].message);
    if (!adminCan(ctx.role, parsed.data.status === 'closed' ? 'close' : 'suspend')) return fail('Your admin role can’t do that.');
    const { error } = await ctx.supabase.rpc('admin_set_org_status', { p_org: parsed.data.org, p_status: parsed.data.status, p_reason: parsed.data.reason });
    if (error) throw error;
    revalidatePath(`/admin/tenants/${parsed.data.org}`);
    return ok(`Account is now ${parsed.data.status}.`);
  } catch (e) {
    return failFrom(e);
  }
}

export async function setFeatureOverride(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await getAdminContext();
    if (!adminCan(ctx.role, 'entitlements')) return fail('Your admin role can’t do that.');
    const parsed = z.object({
      org: z.string().uuid(),
      feature: z.string().trim().toLowerCase().refine(isFeatureKey, 'Pick a feature from the list.'),
      value: z.enum(['on', 'off', 'clear']),
      reason: z.string().trim().min(3, 'Give a reason').max(500),
      expires: z.string().optional(),
    }).safeParse(Object.fromEntries(form));
    if (!parsed.success) return fail(parsed.error.issues[0].message);
    const { org, feature, value, reason } = parsed.data;
    const expires = parsed.data.expires?.trim() || null;
    const untilError = overrideUntilError(feature, value === 'on', expires, new Date().toISOString().slice(0, 10));
    if (untilError) return fail(untilError);
    const { error } = await ctx.supabase.rpc('admin_set_feature_override', {
      p_org: org, p_feature: feature, p_enabled: value === 'clear' ? null : value === 'on', p_reason: reason,
      p_expires_at: expires ? new Date(`${expires}T23:59:59Z`).toISOString() : null,
    });
    if (error) throw error;
    revalidatePath(`/admin/tenants/${org}`);
    return ok('Entitlement updated.');
  } catch (e) {
    return failFrom(e);
  }
}

export async function sendPasswordReset(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await getAdminContext();
    if (!adminCan(ctx.role, 'leads')) return fail('Your admin role can’t do that.');
    const parsed = z.object({ org: z.string().uuid(), email: z.string().email() }).safeParse(Object.fromEntries(form));
    if (!parsed.success) return fail('Invalid request.');
    // Only for users this admin can see as members of the org (RLS-checked read).
    const { data: profile } = await ctx.supabase.from('profiles').select('id').eq('email', parsed.data.email).maybeSingle();
    if (!profile) return fail('User not found.');
    const { data: member } = await ctx.supabase.from('memberships').select('id').eq('organization_id', parsed.data.org).eq('user_id', profile.id).maybeSingle();
    if (!member) return fail('That person is not a member of this account.');
    const { error } = await ctx.supabase.auth.resetPasswordForEmail(parsed.data.email, { redirectTo: `${siteUrl()}/auth/confirm?next=/reset-password` });
    if (error) throw error;
    await createAdminClient().from('audit_logs').insert({ organization_id: parsed.data.org, actor_user_id: ctx.user.id, actor_type: 'platform_admin', action: 'support.password_reset_sent', target_type: 'user', target_id: profile.id });
    return ok(`Password reset email sent to ${parsed.data.email}.`);
  } catch (e) {
    return failFrom(e);
  }
}

export async function updateLead(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await getAdminContext();
    if (!adminCan(ctx.role, 'leads')) return fail('Your admin role can’t do that.');
    const parsed = z.object({ id: z.string().uuid(), status: z.enum(['new', 'contacted', 'qualified', 'won', 'lost', 'spam']), notes: z.string().max(8000).optional() }).safeParse(Object.fromEntries(form));
    if (!parsed.success) return fail('Invalid lead update.');
    const { error } = await ctx.supabase.rpc('admin_update_lead', { p_lead: parsed.data.id, p_status: parsed.data.status, p_notes: parsed.data.notes || null, p_assigned_to: ctx.user.id });
    if (error) throw error;
    revalidatePath('/admin/leads');
    return ok('Lead updated.');
  } catch (e) {
    return failFrom(e);
  }
}

export async function createAnnouncement(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await getAdminContext();
    if (!adminCan(ctx.role, 'announcements')) return fail('Your admin role can’t do that.');
    const parsed = z.object({
      title: z.string().trim().min(1).max(160), body: z.string().trim().min(1).max(4000),
      severity: z.enum(['info', 'warning', 'critical']), audience: z.enum(['all', 'retail', 'wholesale', 'both']),
      ends: z.string().optional(),
    }).safeParse(Object.fromEntries(form));
    if (!parsed.success) return fail('Fill in a title and message.');
    const d = parsed.data;
    const { error } = await ctx.supabase.rpc('admin_create_announcement', {
      p_title: d.title, p_body: d.body, p_severity: d.severity, p_audience: d.audience === 'all' ? null : d.audience,
      p_starts_at: new Date().toISOString(), p_ends_at: d.ends ? new Date(`${d.ends}T23:59:59Z`).toISOString() : null,
    });
    if (error) throw error;
    revalidatePath('/admin/announcements');
    return ok('Announcement published.');
  } catch (e) {
    return failFrom(e);
  }
}

export async function endAnnouncement(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await getAdminContext();
    if (!adminCan(ctx.role, 'announcements')) return fail('Your admin role can’t do that.');
    const { error } = await ctx.supabase.rpc('admin_end_announcement', { p_id: String(form.get('id')) });
    if (error) throw error;
    revalidatePath('/admin/announcements');
    return ok('Announcement ended.');
  } catch (e) {
    return failFrom(e);
  }
}
