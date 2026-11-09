import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { safeNext } from '@/lib/auth/redirect';

/** Handles email confirmation, invite and password-recovery links (token_hash or PKCE code). */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const next = safeNext(searchParams.get('next'));
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;
  const code = searchParams.get('code');
  const supabase = await createClient();

  let error: unknown = null;
  if (tokenHash && type) ({ error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash }));
  else if (code) ({ error } = await supabase.auth.exchangeCodeForSession(code));
  else error = new Error('missing token');

  if (error) return NextResponse.redirect(`${origin}/login?error=link_expired`);
  return NextResponse.redirect(`${origin}${next}`);
}
