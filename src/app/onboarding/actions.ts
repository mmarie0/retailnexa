'use server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { REF_COOKIE } from '@/lib/referral';
import { z } from 'zod';
import { getSupabase, requireUser } from '@/lib/auth/context';
import { setActiveOrgCookie } from '@/lib/auth/org-cookie';
import { fail, friendlyError, type ActionState } from '@/lib/actions';
import { TIMEZONE_IDS } from '@/lib/timezones';
import { getT } from '@/lib/i18n/server';

const schema = z.object({
  name: z.string().trim().min(2, 'Enter your business name').max(120),
  business_type: z.enum(['retail', 'wholesale', 'both'], { error: 'Choose what kind of business you run' }),
  location_name: z.string().trim().max(120).optional(),
  timezone: z.enum(TIMEZONE_IDS),
  plan: z.string().max(200).optional(),
});

export async function createOrganization(_p: ActionState, form: FormData): Promise<ActionState> {
  const t = await getT();
  await requireUser('/onboarding');
  const parsed = schema.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[String(i.path[0])] ??= i.message;
    return fail(t('Check the highlighted fields.'), fieldErrors);
  }
  const supabase = await getSupabase();
  const { data: orgId, error } = await supabase.rpc('create_organization', {
    p_name: parsed.data.name,
    p_business_type: parsed.data.business_type,
    p_location_name: parsed.data.location_name || null,
    p_timezone: parsed.data.timezone,
  });
  if (error) return fail(friendlyError(error));
  await setActiveOrgCookie(orgId as string);
  // Credit the business to the sales agent whose link brought them here (best effort; never blocks signup).
  const ref = (await cookies()).get(REF_COOKIE)?.value;
  if (ref) {
    const { error: refErr } = await supabase.rpc('claim_referral', { p_org: orgId as string, p_code: ref });
    if (refErr) console.error('[onboarding] referral not credited', refErr.message);
    (await cookies()).delete(REF_COOKIE);
  }

  // Pre-select the plan on the billing page from what they chose on pricing (or their business type).
  const plan = new URLSearchParams(parsed.data.plan ?? '');
  if (!plan.has('retail') && !plan.has('wholesale')) {
    plan.set('retail', String(parsed.data.business_type !== 'wholesale'));
    plan.set('wholesale', String(parsed.data.business_type !== 'retail'));
  }
  redirect(`/app/billing?${plan}`);
}
