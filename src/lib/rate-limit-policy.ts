/**
 * What rateLimit() does when it has no limiter credential (#19):
 *  - production (VERCEL_ENV=production): fail closed and log an error, so a
 *    misconfigured deploy can't silently switch off sign-in rate limits;
 *  - previews and local development: allow, so the app runs without the key.
 * A limiter that is configured but temporarily unreachable still fails open
 * (Supabase Auth's own limits are the backstop), with an error log.
 */
export function allowWithoutLimiterKey(vercelEnv: string | undefined): boolean {
  return vercelEnv !== 'production';
}
