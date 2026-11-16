import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { needsSecondFactor, requireUser } from '@/lib/auth/context';
import { safeNext } from '@/lib/auth/redirect';
import { MfaClient } from '@/app/admin/mfa/mfa-client';
import { getT } from '@/lib/i18n/server';

export const metadata: Metadata = { title: 'Enter your code', robots: { index: false } };

/** Second sign-in step for accounts with two-factor on (#96). */
export default async function LoginVerifyPage({ searchParams }: PageProps<'/login/verify'>) {
  const t = await getT();
  const raw = (await searchParams).next;
  const next = safeNext(Array.isArray(raw) ? raw[0] : raw);
  const user = await requireUser(next, { allowPasswordOnly: true });
  if (!(await needsSecondFactor())) redirect(next);
  return (
    <>
      <h1 className="text-2xl font-extrabold">{t('Enter your code')}</h1>
      <p className="mb-4 mt-1 text-muted">{t('Two-factor authentication is on for')} {user.email}{t('. Open your authenticator app and enter the 6-digit code.')}</p>
      <MfaClient mode="verify" returnTo={next} />
    </>
  );
}
