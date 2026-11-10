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

  if (tokenHash && type) {
    // Works from any browser or device (preferred email template form).
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (error) return NextResponse.redirect(`${origin}/login?error=link_expired`);
    return NextResponse.redirect(`${origin}${next}`);
  }
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
    // A PKCE code only completes in the browser that started sign-up. Supabase has
    // already confirmed the email by the time it redirects here, so opening the link
    // elsewhere (the usual mail-app case) still confirmed the account: say so (#25).
    return NextResponse.redirect(`${origin}/login?error=confirmed_elsewhere&next=${encodeURIComponent(next)}`);
  }
  return NextResponse.redirect(`${origin}/login?error=link_expired`);
}
