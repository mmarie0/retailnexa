import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { supabasePublishableKey, supabaseUrl } from '@/lib/env-public';

/**
 * Refreshes the Supabase session cookie on every matched request and performs
 * an *optimistic* redirect for signed-out visitors. Real authorization happens
 * in the data access layer (src/lib/auth/context.ts) and in Postgres RLS.
 */
const PROTECTED = ['/app', '/admin', '/onboarding', '/account'];

export async function proxy(request: NextRequest) {
  const url = supabaseUrl();
  const key = supabasePublishableKey();
  const isProtected = PROTECTED.some((p) => request.nextUrl.pathname === p || request.nextUrl.pathname.startsWith(`${p}/`));

  if (!url || !key) {
    if (isProtected) return NextResponse.redirect(new URL('/login?error=not_configured', request.url));
    return NextResponse.next();
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        for (const { name, value } of toSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
      },
    },
  });

  // Do not run code between createServerClient and getUser (session refresh relies on it).
  const { data } = await supabase.auth.getUser();

  if (isProtected && !data.user) {
    const login = new URL('/login', request.url);
    login.searchParams.set('next', request.nextUrl.pathname + request.nextUrl.search);
    return NextResponse.redirect(login);
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/webhooks|api/cron|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml)$).*)'],
};
