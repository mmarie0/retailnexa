import 'server-only';

/**
 * Server-only environment access: secret keys, Stripe and cron settings, plus
 * everything from the client-safe module. Importing this from a client
 * component fails the build (#19); client code uses '@/lib/env-public'.
 */
export * from './env-public';
import { ConfigError } from './env-public';

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

export function supabaseSecretKeyOrNull(): string | null {
  return process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || null;
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
