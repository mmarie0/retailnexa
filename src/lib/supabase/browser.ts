'use client';
import { createBrowserClient } from '@supabase/ssr';
import { supabasePublishableKey, supabaseUrl } from '@/lib/env';

export function createBrowserSupabase() {
  return createBrowserClient(supabaseUrl()!, supabasePublishableKey()!);
}
