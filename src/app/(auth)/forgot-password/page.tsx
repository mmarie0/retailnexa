import type { Metadata } from 'next';
import Link from 'next/link';
import { ForgotForm } from '../forms';
import { getT } from '@/lib/i18n/server';

export const metadata: Metadata = { title: 'Reset your password' };

export default async function ForgotPage() {
  const t = await getT();
  return (
    <>
      <h1 className="text-2xl font-extrabold">{t('Reset your password')}</h1>
      <p className="mb-6 mt-1 text-muted">{t('We’ll email you a link.')} <Link href="/login" className="font-semibold text-accent-strong">{t('Back to log in')}</Link></p>
      <ForgotForm />
    </>
  );
}
