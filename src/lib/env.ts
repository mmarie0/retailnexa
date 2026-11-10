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

const supabasePublicKeys = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'];

export function isSupabaseConfigured() {
  return read(supabasePublicKeys).missing.length === 0;
}

export function supabasePublicEnv() {
  const { values, missing } = read(supabasePublicKeys);
  if (missing.length) throw new ConfigError(missing);
  z.string().url().parse(values.NEXT_PUBLIC_SUPABASE_URL);
  return { url: values.NEXT_PUBLIC_SUPABASE_URL, anonKey: values.NEXT_PUBLIC_SUPABASE_ANON_KEY };
}

export function supabaseServiceKey(): string {
  const { values, missing } = read(['SUPABASE_SERVICE_ROLE_KEY']);
  if (missing.length) throw new ConfigError(missing);
  return values.SUPABASE_SERVICE_ROLE_KEY;
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
