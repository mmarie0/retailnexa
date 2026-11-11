import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { computeAccess, entitlements, type Access, type OrgStatus, type SubscriptionStatus } from '@/lib/billing/access';
import { isMemberRole, isPermission, type MemberRole, type Permission } from './permissions';

/**
 * Data Access Layer. Every page, Server Action and Route Handler that touches
 * tenant data starts here. It verifies the session with Supabase Auth (not just
 * the cookie), resolves the active organization from the caller's own
 * memberships, and loads effective permissions from the database.
 */

export const ACTIVE_ORG_COOKIE = 'rn_org';

export const getSupabase = cache(createClient);

export const getCurrentUser = cache(async () => {
  const supabase = await getSupabase();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return data.user;
});

/** True when the user has a verified authenticator but this session hasn't entered a code yet (#96). */
export const needsSecondFactor = cache(async (): Promise<boolean> => {
  const supabase = await getSupabase();
  const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  return data?.nextLevel === 'aal2' && data.currentLevel !== 'aal2';
});

/**
 * Signed-in user, or a redirect to sign in. A user with two-factor on who has
 * only entered their password is sent to the code step first (#96); the
 * database refuses their business data until then as well.
 */
export async function requireUser(next = '/app', opts: { allowPasswordOnly?: boolean } = {}) {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);
  if (!opts.allowPasswordOnly && (await needsSecondFactor())) redirect(`/login/verify?next=${encodeURIComponent(next)}`);
  return user;
}

export interface OrgSummary {
  id: string;
  name: string;
  businessType: 'retail' | 'wholesale' | 'both';
  status: OrgStatus;
  role: MemberRole;
}

export const getMyOrganizations = cache(async (): Promise<OrgSummary[]> => {
  const user = await getCurrentUser();
  if (!user) return [];
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from('memberships')
    .select('role, organizations!inner(id, name, business_type, status)')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .order('created_at');
  if (error) throw error;
  return (data ?? []).flatMap((m) => {
    const o = m.organizations as unknown as { id: string; name: string; business_type: OrgSummary['businessType']; status: OrgStatus };
    if (!o || !isMemberRole(m.role) || o.status === 'closed') return [];
    return [{ id: o.id, name: o.name, businessType: o.business_type, status: o.status, role: m.role }];
  });
});

export interface SubscriptionInfo {
  status: SubscriptionStatus;
  products: string[];
  extraLocations: number;
  trialEnd: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  pastDueSince: Date | null;
}

export interface OrgContext {
  user: { id: string; email: string };
  org: OrgSummary;
  orgs: OrgSummary[];
  permissions: Set<Permission>;
  subscription: SubscriptionInfo | null;
  access: Access;
  entitlements: Set<string>;
}

const toDate = (v: string | null) => (v ? new Date(v) : null);

export const getOrgContext = cache(async (): Promise<OrgContext> => {
  const user = await requireUser();
  const orgs = await getMyOrganizations();
  if (orgs.length === 0) redirect((await getAgent()) ? '/partner' : '/onboarding');

  const selected = (await cookies()).get(ACTIVE_ORG_COOKIE)?.value;
  const org = orgs.find((o) => o.id === selected) ?? orgs[0];
  const supabase = await getSupabase();

  const [perms, sub, overrides] = await Promise.all([
    supabase.rpc('my_permissions', { p_org: org.id }),
    supabase
      .from('subscriptions')
      .select('status, products, extra_locations, trial_end, current_period_end, cancel_at_period_end, past_due_since')
      .eq('organization_id', org.id)
      .maybeSingle(),
    supabase.from('feature_overrides').select('feature, enabled, expires_at').eq('organization_id', org.id),
  ]);
  if (perms.error) throw perms.error;
  if (sub.error) throw sub.error;
  if (overrides.error) throw overrides.error;

  const subscription: SubscriptionInfo | null = sub.data
    ? {
        status: sub.data.status as SubscriptionStatus,
        products: sub.data.products ?? [],
        extraLocations: sub.data.extra_locations ?? 0,
        trialEnd: toDate(sub.data.trial_end),
        currentPeriodEnd: toDate(sub.data.current_period_end),
        cancelAtPeriodEnd: !!sub.data.cancel_at_period_end,
        pastDueSince: toDate(sub.data.past_due_since),
      }
    : null;

  const now = new Date();
  const waiver = (overrides.data ?? []).find((o) => o.feature === 'billing.exempt' && o.enabled);
  return {
    user: { id: user.id, email: user.email ?? '' },
    org,
    orgs,
    permissions: new Set(((perms.data as string[] | null) ?? []).filter(isPermission)),
    subscription,
    access: computeAccess({ orgStatus: org.status, subscription, now, billingWaivedUntil: toDate(waiver?.expires_at ?? null) }),
    entitlements: entitlements(
      subscription && ['trialing', 'active', 'past_due'].includes(subscription.status) ? subscription.products : [],
      (overrides.data ?? []).map((o) => ({ feature: o.feature, enabled: o.enabled, expiresAt: toDate(o.expires_at) })),
      now,
    ),
  };
});

export function can(ctx: OrgContext, permission: Permission) {
  return ctx.permissions.has(permission);
}

/** For pages inside the tenant app: sends users without usable access to billing. */
export async function requireAppAccess() {
  const ctx = await getOrgContext();
  if (!ctx.access.canUseApp) redirect('/app/billing');
  return ctx;
}

// ---------------------------------------------------------------------------
// Platform admin
// ---------------------------------------------------------------------------
export type PlatformRole = 'superadmin' | 'support' | 'billing' | 'readonly';

export const getAdminContext = cache(async (opts: { allowWithoutMfa?: boolean } = {}) => {
  const user = await requireUser('/admin', { allowPasswordOnly: opts.allowWithoutMfa });
  const supabase = await getSupabase();
  const { data: row } = await supabase
    .from('platform_admins')
    .select('role, mfa_required, is_active')
    .eq('user_id', user.id)
    .maybeSingle();
  // Do not reveal that the admin portal exists to non-admins.
  if (!row || !row.is_active) notFound();

  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const mfaOk = !row.mfa_required || aal?.currentLevel === 'aal2';
  if (!mfaOk && !opts.allowWithoutMfa) redirect('/admin/mfa');
  return { user: { id: user.id, email: user.email ?? '' }, role: row.role as PlatformRole, mfaOk, supabase };
});

export function adminCan(role: PlatformRole, action: 'suspend' | 'close' | 'entitlements' | 'leads' | 'announcements' | 'agents') {
  switch (action) {
    case 'agents':
    case 'close':
      return role === 'superadmin';
    case 'suspend':
    case 'entitlements':
      return role === 'superadmin' || role === 'billing';
    case 'leads':
      return role !== 'readonly';
    case 'announcements':
      return role === 'superadmin' || role === 'support';
  }
}

// ---------------------------------------------------------------------------
// Sales agents (partners who sell RetailNexa)
// ---------------------------------------------------------------------------
export interface Agent { userId: string; name: string; email: string; refCode: string; isActive: boolean; discountOrgId: string | null }

/** The signed-in user's sales-agent record, if any (RLS: own row only). */
export const getAgent = cache(async (): Promise<Agent | null> => {
  const user = await getCurrentUser();
  if (!user) return null;
  const { data } = await (await getSupabase()).from('sales_agents').select('user_id, name, email, ref_code, is_active, discount_org_id').eq('user_id', user.id).maybeSingle();
  return data ? { userId: data.user_id, name: data.name, email: data.email, refCode: data.ref_code, isActive: data.is_active, discountOrgId: data.discount_org_id } : null;
});

/** Partner portal guard: an active agent, or a 404 (the portal isn't advertised). */
export async function getAgentContext() {
  await requireUser('/partner');
  const agent = await getAgent();
  if (!agent || !agent.isActive) notFound();
  return { agent, orgs: await getMyOrganizations(), supabase: await getSupabase() };
}
