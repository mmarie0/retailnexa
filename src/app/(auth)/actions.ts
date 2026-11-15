'use server';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { isSupabaseConfigured, siteUrl } from '@/lib/env';
import { safeNext } from '@/lib/auth/redirect';
import { fail, ok, type ActionState } from '@/lib/actions';
import { clientIpHash, emailKey, rateLimit } from '@/lib/request';
import { getT } from '@/lib/i18n/server';

const SLOW_DOWN = 'Too many attempts. Wait a few minutes and try again.';

/** Per-IP and per-email limits (Supabase Auth only sees our server's IP). */
async function allowed(action: string, email: string | null, ipMax: number, emailMax: number, windowSeconds: number) {
  const ip = await clientIpHash();
  if (!(await rateLimit(`auth:${action}:ip:${ip}`, ipMax, windowSeconds))) return false;
  if (email && !(await rateLimit(`auth:${action}:email:${emailKey(email)}`, emailMax, windowSeconds))) return false;
  return true;
}

const email = z.string().trim().toLowerCase().email('Enter a valid email address');
const password = z.string().min(10, 'Use at least 10 characters').max(128);
const NOT_CONFIGURED = 'Sign-in isn’t available yet: the authentication service has not been connected.';

export async function signIn(_p: ActionState, form: FormData): Promise<ActionState> {
  const t = await getT();
  if (!isSupabaseConfigured()) return fail(NOT_CONFIGURED);
  const parsed = z.object({ email, password: z.string().min(1, t('Enter your password')) }).safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    const fe: Record<string, string> = {};
    for (const i of parsed.error.issues) fe[String(i.path[0])] ??= i.path[0] === 'email' ? 'Enter a valid email address' : i.message;
    return fail(t('Check the highlighted fields.'), fe);
  }
  if (!(await allowed('signin', parsed.data.email, 30, 10, 600))) return fail(SLOW_DOWN);
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    if (/confirm/i.test(error.message)) return fail(t('Confirm your email first — check your inbox for the link we sent.'));
    if (error.status === 429) return fail(t('Too many attempts. Wait a few minutes and try again.'));
    return fail(t('That email and password don’t match.'));
  }
  redirect(safeNext(form.get('next')));
}

export async function signUp(_p: ActionState, form: FormData): Promise<ActionState> {
  const t = await getT();
  if (!isSupabaseConfigured()) return fail(NOT_CONFIGURED);
  const parsed = z
    .object({
      full_name: z.string().trim().min(1, t('Enter your name')).max(120),
      email,
      password,
      terms: z.literal('on', { error: 'Accept the terms to continue' }),
    })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[String(i.path[0])] ??= i.message;
    return fail(t('Check the highlighted fields.'), fieldErrors);
  }
  if (!(await allowed('signup', parsed.data.email, 5, 3, 3600))) return fail(SLOW_DOWN);
  const next = safeNext(form.get('next'), '/onboarding');
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.full_name },
      emailRedirectTo: `${siteUrl()}/auth/confirm?next=${encodeURIComponent(next)}`,
    },
  });
  if (error) {
    if (error.status === 429) return fail(t('Too many attempts. Wait a few minutes and try again.'));
    if (/password/i.test(error.message)) return fail(error.message);
    return fail(t('We couldn’t create that account. If you already have one, log in instead.'));
  }
  if (data.session) redirect(next);
  return ok(`Check ${parsed.data.email} for a link to confirm your email. The link opens your account setup.`);
}

export async function requestPasswordReset(_p: ActionState, form: FormData): Promise<ActionState> {
  const t = await getT();
  if (!isSupabaseConfigured()) return fail(NOT_CONFIGURED);
  const parsed = email.safeParse(form.get('email'));
  if (!parsed.success) return fail(t('Enter a valid email address.'));
  const done = ok(t('If an account exists for that email, we’ve sent a link to reset the password.'));
  // Silently drop over-limit requests: protects the email quota and stops inbox flooding.
  if (!(await allowed('reset', parsed.data, 5, 3, 3600))) return done;
  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(parsed.data, { redirectTo: `${siteUrl()}/auth/confirm?next=/reset-password` });
  // Same answer whether or not the account exists (no account enumeration).
  return done;
}

export async function updatePassword(_p: ActionState, form: FormData): Promise<ActionState> {
  const t = await getT();
  if (!isSupabaseConfigured()) return fail(NOT_CONFIGURED);
  const parsed = z
    .object({ password, confirm: z.string() })
    .refine((v) => v.password === v.confirm, { message: 'The passwords don’t match', path: ['confirm'] })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return fail(t('Your reset link has expired. Request a new one.'));
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return fail(/same/i.test(error.message) ? 'Choose a password you haven’t used before.' : 'We couldn’t update your password. Try again.');
  redirect('/app');
}
