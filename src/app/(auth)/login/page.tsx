import type { Metadata } from 'next';
import Link from 'next/link';
import { LoginForm } from '../forms';
import { safeNext } from '@/lib/auth/redirect';
import { Notice } from '@/components/ui';

export const metadata: Metadata = { title: 'Log in' };

const ERRORS: Record<string, string> = {
  link_expired: 'That link has expired or was already used. Log in, or request a new link.',
  confirmed_elsewhere: 'Your email is confirmed. Log in with your password to continue.',
  not_configured: 'Sign-in isn’t available yet: the authentication service has not been connected.',
};

export default async function LoginPage({ searchParams }: PageProps<'/login'>) {
  const sp = await searchParams;
  const error = typeof sp.error === 'string' ? ERRORS[sp.error] : undefined;
  return (
    <>
      <h1 className="text-2xl font-extrabold">Log in</h1>
      <p className="mb-6 mt-1 text-muted">New here? <Link href="/signup" className="font-semibold text-accent-strong">Start a free trial</Link></p>
      {error && <div className="mb-4"><Notice tone={sp.error === 'confirmed_elsewhere' ? 'good' : 'warning'}>{error}</Notice></div>}
      <LoginForm next={safeNext(sp.next)} />
    </>
  );
}
