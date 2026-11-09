'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { can, getOrgContext, getSupabase, type OrgContext } from '@/lib/auth/context';
import { isMemberRole, isPermission, type Permission } from '@/lib/auth/permissions';
import { fail, failFrom, ok, type ActionState } from '@/lib/actions';
import { siteUrl } from '@/lib/env';
import { TIMEZONE_IDS } from '@/lib/timezones';

const READ_ONLY = 'Your account is read-only right now, so changes can’t be saved. Check the billing page.';

async function guard(permission: Permission): Promise<OrgContext | ActionState> {
  const ctx = await getOrgContext();
  if (!can(ctx, permission)) return fail('You don’t have permission to do that.');
  if (!ctx.access.canWrite) return fail(READ_ONLY);
  return ctx;
}
const isState = (v: unknown): v is ActionState => typeof v === 'object' && v !== null && 'ok' in v;

function fieldErrors(issues: z.core.$ZodIssue[]) {
  const out: Record<string, string> = {};
  for (const i of issues) out[String(i.path[0])] ??= i.message;
  return out;
}

const opt = (max: number) => z.string().trim().max(max).transform((v) => v || null);

// ---------------------------------------------------------------------------
export async function updateOrganization(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await guard('org.manage');
    if (isState(ctx)) return ctx;
    const parsed = z.object({
      name: z.string().trim().min(2, 'Enter a business name').max(120),
      legal_name: opt(200),
      phone: opt(40),
      website: opt(200),
      timezone: z.enum(TIMEZONE_IDS),
    }).safeParse(Object.fromEntries(form));
    if (!parsed.success) return fail('Check the highlighted fields.', fieldErrors(parsed.error.issues));
    const supabase = await getSupabase();
    const { error, count } = await supabase.from('organizations').update(parsed.data, { count: 'exact' }).eq('id', ctx.org.id);
    if (error) throw error;
    if (!count) return fail('You don’t have permission to do that.');
    revalidatePath('/app', 'layout');
    return ok('Saved.');
  } catch (e) {
    return failFrom(e);
  }
}

// ---------------------------------------------------------------------------
const locationSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name').max(120),
  kind: z.enum(['store', 'warehouse', 'office']),
  address_line1: opt(200),
  city: opt(100),
  region: opt(100),
  postal_code: opt(20),
  timezone: z.enum(TIMEZONE_IDS).or(z.literal('').transform(() => null)),
});

export async function createLocation(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await guard('locations.manage');
    if (isState(ctx)) return ctx;
    const parsed = locationSchema.safeParse(Object.fromEntries(form));
    if (!parsed.success) return fail('Check the highlighted fields.', fieldErrors(parsed.error.issues));
    const supabase = await getSupabase();
    const { error } = await supabase.from('locations').insert({ ...parsed.data, organization_id: ctx.org.id });
    if (error) throw error;
    revalidatePath('/app/settings/locations');
    return ok(`Added ${parsed.data.name}.`);
  } catch (e) {
    return failFrom(e);
  }
}

export async function updateLocation(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await guard('locations.manage');
    if (isState(ctx)) return ctx;
    const id = z.string().uuid().safeParse(form.get('id'));
    const parsed = locationSchema.extend({ is_active: z.enum(['true', 'false']).transform((v) => v === 'true') }).safeParse(Object.fromEntries(form));
    if (!id.success || !parsed.success) return fail('Check the highlighted fields.', parsed.success ? {} : fieldErrors(parsed.error.issues));
    const supabase = await getSupabase();
    const { error, count } = await supabase.from('locations').update(parsed.data, { count: 'exact' }).eq('id', id.data).eq('organization_id', ctx.org.id);
    if (error) throw error;
    if (!count) return fail('Location not found.');
    revalidatePath('/app/settings/locations');
    return ok('Saved.');
  } catch (e) {
    return failFrom(e);
  }
}

// ---------------------------------------------------------------------------
export async function inviteMember(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await guard('members.manage');
    if (isState(ctx)) return ctx;
    const parsed = z.object({ email: z.string().trim().toLowerCase().email('Enter a valid email address'), role: z.string().refine(isMemberRole, 'Choose a role') })
      .safeParse(Object.fromEntries(form));
    if (!parsed.success) return fail('Check the highlighted fields.', fieldErrors(parsed.error.issues));
    const supabase = await getSupabase();
    const { data, error } = await supabase.rpc('invite_member', { p_org: ctx.org.id, p_email: parsed.data.email, p_role: parsed.data.role });
    if (error) throw error;
    const token = (data as { token: string }[])[0]?.token;
    revalidatePath('/app/settings/team');
    return { ok: true, message: `Invitation created for ${parsed.data.email}. Send them this link — it works once, for that email, for 7 days.`, data: { link: `${siteUrl()}/invite/${token}` } };
  } catch (e) {
    return failFrom(e);
  }
}

async function memberRpc(fn: string, args: Record<string, unknown>, success: string): Promise<ActionState> {
  try {
    const ctx = await getOrgContext();
    if (!ctx.access.canWrite) return fail(READ_ONLY);
    const supabase = await getSupabase();
    const { error } = await supabase.rpc(fn, args);
    if (error) throw error;
    revalidatePath('/app/settings/team');
    return ok(success);
  } catch (e) {
    return failFrom(e);
  }
}

export async function changeMemberRole(_p: ActionState, form: FormData): Promise<ActionState> {
  const role = form.get('role');
  if (!isMemberRole(role)) return fail('Choose a role.');
  return memberRpc('update_member_role', { p_membership_id: String(form.get('membership_id')), p_role: role }, 'Role updated.');
}

export async function setMemberStatus(_p: ActionState, form: FormData): Promise<ActionState> {
  const status = form.get('status');
  if (status !== 'active' && status !== 'disabled') return fail('Invalid status.');
  return memberRpc('set_member_status', { p_membership_id: String(form.get('membership_id')), p_status: status }, status === 'disabled' ? 'Access removed.' : 'Access restored.');
}

export async function setMemberPermission(_p: ActionState, form: FormData): Promise<ActionState> {
  const permission = form.get('permission');
  const value = form.get('value');
  if (!isPermission(permission) || !['grant', 'revoke', 'default'].includes(String(value))) return fail('Invalid permission.');
  return memberRpc('set_member_permission', {
    p_membership_id: String(form.get('membership_id')),
    p_permission: permission,
    p_granted: value === 'default' ? null : value === 'grant',
  }, 'Permission updated.');
}

export async function revokeInvitation(_p: ActionState, form: FormData): Promise<ActionState> {
  return memberRpc('revoke_invitation', { p_invitation_id: String(form.get('invitation_id')) }, 'Invitation revoked.');
}

// ---------------------------------------------------------------------------
export async function grantSupportAccess(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await guard('org.manage');
    if (isState(ctx)) return ctx;
    const parsed = z.object({ hours: z.coerce.number().int().min(1).max(72), reason: z.string().trim().min(3, 'Say briefly what support should help with').max(500) })
      .safeParse(Object.fromEntries(form));
    if (!parsed.success) return fail('Check the highlighted fields.', fieldErrors(parsed.error.issues));
    const supabase = await getSupabase();
    const { error } = await supabase.rpc('grant_support_access', { p_org: ctx.org.id, p_hours: parsed.data.hours, p_reason: parsed.data.reason });
    if (error) throw error;
    revalidatePath('/app/settings/support-access');
    return ok(`Support can access your records for ${parsed.data.hours} hours.`);
  } catch (e) {
    return failFrom(e);
  }
}

export async function revokeSupportAccess(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const supabase = await getSupabase();
    const { error } = await supabase.rpc('revoke_support_access', { p_grant_id: String(form.get('grant_id')) });
    if (error) throw error;
    revalidatePath('/app/settings/support-access');
    return ok('Support access revoked.');
  } catch (e) {
    return failFrom(e);
  }
}
