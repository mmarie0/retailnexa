import 'server-only';
import { createHash } from 'node:crypto';
import { headers } from 'next/headers';
import { createAdminClient } from '@/lib/supabase/admin';
import { supabaseSecretKeyOrNull } from '@/lib/env';

/**
 * Hashed client IP for rate limiting. Only platform-set headers are trusted:
 * on Vercel, x-vercel-forwarded-for / x-real-ip are written by the edge and
 * cannot be forged by the client; a raw X-Forwarded-For is only used on Vercel.
 */
export async function clientIpHash(): Promise<string> {
  const h = await headers();
  const ip =
    h.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() ||
    h.get('x-real-ip')?.trim() ||
    (process.env.VERCEL ? h.get('x-forwarded-for')?.split(',')[0]?.trim() : null) ||
    'unknown';
  return createHash('sha256').update(ip).digest('hex').slice(0, 32);
}

export function emailKey(email: string) {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 32);
}

/**
 * Fixed-window limiter backed by Postgres (public.check_rate_limit). Returns
 * true when allowed. Fails open (with a log) if the limiter itself is
 * unavailable, because Supabase Auth applies its own limits as a backstop.
 */
export async function rateLimit(bucket: string, max: number, windowSeconds: number): Promise<boolean> {
  if (!supabaseSecretKeyOrNull()) return true;
  try {
    const { data, error } = await createAdminClient().rpc('check_rate_limit', { p_bucket: bucket, p_max: max, p_window_seconds: windowSeconds });
    if (error) throw error;
    return data === true;
  } catch (e) {
    console.error('[rate limit] unavailable', bucket.split(':')[0], e);
    return true;
  }
}
