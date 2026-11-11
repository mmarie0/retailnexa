import type { Metadata } from 'next';
import { ResetForm } from '../forms';
import { getT } from '@/lib/i18n/server';

export const metadata: Metadata = { title: 'Choose a new password' };

export default async function ResetPage() {
  const t = await getT();
  return (
    <>
      <h1 className="mb-6 text-2xl font-extrabold">{t('Choose a new password')}</h1>
      <ResetForm />
    </>
  );
}
