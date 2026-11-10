import { z } from 'zod';

/**
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

function read(names: string[]) {
  const values: Record<string, string> = {};
  const missing: string[] = [];
  for (const n of names) {
    const v = process.env[n];
    if (v && v.trim()) values[n] = v.trim();
    else missing.push(n);
  }
  return { values, missing };
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
export function supabaseSecretKeyOrNull(): string | null {
  return process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || null;
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

export function supabaseServiceKey(): string {
  const key = supabaseSecretKeyOrNull();
  if (!key) throw new ConfigError(['SUPABASE_SECRET_KEY']);
  return key;
}

const stripeKeys = [
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_PRICE_RETAIL',
  'STRIPE_PRICE_RETAIL_EXTRA_LOCATION',
  'STRIPE_PRICE_WHOLESALE',
];

export function isStripeConfigured() {
  return read(stripeKeys).missing.length === 0;
}

export function stripeEnv() {
  const { values, missing } = read(stripeKeys);
  if (missing.length) throw new ConfigError(missing);
  if (!/^(sk|rk)_(test|live)_/.test(values.STRIPE_SECRET_KEY)) throw new ConfigError(['STRIPE_SECRET_KEY (must start with sk_ or rk_)']);
  return {
    secretKey: values.STRIPE_SECRET_KEY,
    webhookSecret: values.STRIPE_WEBHOOK_SECRET,
    prices: {
      retail: values.STRIPE_PRICE_RETAIL,
      retailExtraLocation: values.STRIPE_PRICE_RETAIL_EXTRA_LOCATION,
      wholesale: values.STRIPE_PRICE_WHOLESALE,
    },
  };
}

export function cronSecret(): string | null {
  return process.env.CRON_SECRET?.trim() || null;
}
