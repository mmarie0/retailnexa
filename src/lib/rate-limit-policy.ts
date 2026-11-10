/**
 * What rateLimit() does when it has no limiter credential (#19).
 *
 * It never silently allows in production: it logs an error on every call (and
 * /admin/system shows the service key as Missing). It still allows the request,
 * because refusing would lock every user out of sign-in on a misconfigured
 * deploy; Supabase Auth's own rate limits remain the backstop.
 * Previews and local development allow quietly.
 */
export function missingLimiterKey(vercelEnv: string | undefined): { allow: true; reportError: boolean } {
  return { allow: true, reportError: vercelEnv === 'production' };
}
