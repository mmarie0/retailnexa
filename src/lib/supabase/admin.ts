import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { supabasePublicEnv, supabaseServiceKey } from '@/lib/env';

/**
 * Service-role client: BYPASSES Row Level Security.
 * Allowed uses only (see docs/SECURITY_RULES.md): Stripe webhook + billing sync,
 * cron jobs, public lead intake, Stripe customer linking, creating a sales
 * agent's login (superadmin only). Never pass its results
 * to the client without filtering, and never use it to read tenant data on
 * behalf of a user.
 */
export function createAdminClient() {
  const { url } = supabasePublicEnv();
  return createClient(url, supabaseServiceKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
