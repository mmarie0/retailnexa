'use server';
import { revalidatePath } from 'next/cache';
import { getAdminContext } from '@/lib/auth/context';
import { WAIVER_MAX_DAYS, addDays } from '@/lib/billing/feature-keys';
import { seedRetail, seedWholesale, supabaseDemoDb } from '@/lib/demo/seed';
import { fail, failFrom, ok, type ActionState } from '@/lib/actions';

const DEMOS = [
  { type: 'retail', name: 'Demo Retail · Bella Beauty Supply', location: 'Main St. store', seed: seedRetail },
  { type: 'wholesale', name: 'Demo Wholesale · Bayline Beauty Distributors', location: 'Warehouse', seed: seedWholesale },
] as const;

/**
 * Create the two demo businesses (owned by this superadmin, filled with made-up
 * data, billing waived) or, if they exist, extend their billing waiver.
 */
export async function createDemoAccounts(_p: ActionState): Promise<ActionState> {
  try {
    const ctx = await getAdminContext();
    if (ctx.role !== 'superadmin') return fail('Only a superadmin can create demo accounts.');
    const sb = ctx.supabase;
    const today = new Date().toISOString().slice(0, 10);
    const until = new Date(`${addDays(today, WAIVER_MAX_DAYS)}T23:59:59Z`).toISOString();
    const { data: mine } = await sb.from('memberships').select('organization_id, organizations!inner(id, business_type, is_demo)').eq('user_id', ctx.user.id).eq('role', 'owner');
    const made: string[] = [];
    for (const d of DEMOS) {
      const have = (mine ?? []).map((m) => m.organizations as unknown as { id: string; business_type: string; is_demo: boolean }).find((o) => o.is_demo && o.business_type === d.type);
      let org = have?.id;
      if (!org) {
        const { data, error } = await sb.rpc('create_organization', { p_name: d.name, p_business_type: d.type, p_location_name: d.location, p_timezone: 'America/New_York' });
        if (error) throw error;
        org = data as string;
        const { error: markErr } = await sb.rpc('admin_mark_demo', { p_org: org });
        if (markErr) throw markErr;
      }
      // Billing waiver first: a business without a plan is read-only, so the seed needs it.
      const { error: wErr } = await sb.rpc('admin_set_feature_override', { p_org: org, p_feature: 'billing.exempt', p_enabled: true, p_reason: 'Demo account (made-up data)', p_expires_at: until });
      if (wErr) throw wErr;
      if (!have) { await d.seed(supabaseDemoDb(sb), org, today); made.push(d.type); }
    }
    revalidatePath('/admin/demo');
    return ok(made.length ? `Created the ${made.join(' and ')} demo${made.length > 1 ? 's' : ''}. Billing is waived until ${addDays(today, WAIVER_MAX_DAYS)}.` : `Both demos exist. Billing waiver extended to ${addDays(today, WAIVER_MAX_DAYS)}.`);
  } catch (e) {
    console.error('[demo] create failed', e);
    return failFrom(e);
  }
}
