import { z } from 'zod';

/**
 * Client-safe environment access: only NEXT_PUBLIC_* values (and the site URL).
 * Import this from client components; server code may use '@/lib/env'.
 *
 * Environment access. Values are read lazily so that public marketing pages
 * build and render without any credentials. Each integration exposes an
 * `isXConfigured()` check; calling a getter for an unconfigured integration
 * throws a ConfigError naming the exact variable that is missing.
 */
export class ConfigError extends Error {
  constructor(public readonly missing: string[]) {
    super(`Missing configuration: ${missing.join(', ')}. See docs/SETUP.md.`);
    this.name = 'ConfigError';
  }
}

export function siteUrl(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
  return raw.replace(/\/$/, '');
}

/**
 * Supabase keys. Accepts the current names set by the Supabase ↔ Vercel
 * integration (publishable / secret keys) and the legacy names (anon /
 * service_role). NEXT_PUBLIC_* must be referenced literally so Next.js can
 * inline them into browser code.
 */
export function supabaseUrl(): string | undefined {
  return process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || undefined;
}
export function supabasePublishableKey(): string | undefined {
  return process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || undefined;
}
export function isSupabaseConfigured() {
  return !!supabaseUrl() && !!supabasePublishableKey();
}

export function supabasePublicEnv() {
  const url = supabaseUrl();
  const anonKey = supabasePublishableKey();
  const missing = [...(url ? [] : ['NEXT_PUBLIC_SUPABASE_URL']), ...(anonKey ? [] : ['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'])];
  if (missing.length) throw new ConfigError(missing);
  z.string().url().parse(url);
  return { url: url!, anonKey: anonKey! };
}
