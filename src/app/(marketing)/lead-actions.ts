'use server';
import { leadSchema } from '@/lib/leads/schema';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSupabaseConfigured } from '@/lib/env';
import { fail, failFrom, ok, type ActionState } from '@/lib/actions';
import { clientIpHash } from '@/lib/request';

export async function submitLead(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = leadSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[String(i.path[0])] ??= i.message;
    return fail('Check the highlighted fields.', fieldErrors);
  }
  const { website, ...lead } = parsed.data;
  const thanks = lead.kind === 'demo' ? 'Thanks — we’ll email you within one business day to set up your walkthrough.' : 'Thanks — your message is in. We reply within one business day.';
  if (website === 'BOT') return ok(thanks); // silently drop spam

  if (!isSupabaseConfigured()) return fail('Our form is temporarily unavailable. Please email us instead.');
  try {
    const bucket = `lead:${await clientIpHash()}`;
    const admin = createAdminClient();
    const { data: allowed, error: rlError } = await admin.rpc('check_rate_limit', { p_bucket: bucket, p_max: 5, p_window_seconds: 3600 });
    if (rlError) throw rlError;
    if (!allowed) return fail('Too many submissions from your network. Please try again in an hour.');
    const { error } = await admin.from('leads').insert(lead);
    if (error) throw error;
    return ok(thanks);
  } catch (e) {
    return failFrom(e);
  }
}
