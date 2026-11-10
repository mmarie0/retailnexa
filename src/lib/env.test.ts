import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigError, isSupabaseConfigured, supabasePublicEnv, supabaseServiceKey } from './env';

afterEach(() => vi.unstubAllEnvs());
const clear = () => {
  for (const k of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) vi.stubEnv(k, '');
};

describe('Supabase env names', () => {
  it('accepts the integration’s publishable/secret names', () => {
    clear();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://x.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_abc');
    vi.stubEnv('SUPABASE_SECRET_KEY', 'sb_secret_xyz');
    expect(isSupabaseConfigured()).toBe(true);
    expect(supabasePublicEnv().anonKey).toBe('sb_publishable_abc');
    expect(supabaseServiceKey()).toBe('sb_secret_xyz');
  });
  it('falls back to the legacy anon/service_role names', () => {
    clear();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://x.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'legacy-anon');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'legacy-service');
    expect(supabasePublicEnv().anonKey).toBe('legacy-anon');
    expect(supabaseServiceKey()).toBe('legacy-service');
  });
  it('names the missing variable when nothing is set', () => {
    clear();
    expect(isSupabaseConfigured()).toBe(false);
    expect(() => supabasePublicEnv()).toThrow(ConfigError);
    expect(() => supabaseServiceKey()).toThrow(/SUPABASE_SECRET_KEY/);
  });
});
