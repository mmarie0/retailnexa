import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getAdminContext } from '@/lib/auth/context';
import { Card, Logo } from '@/components/ui';
import { MfaClient } from './mfa-client';

export const metadata: Metadata = { title: 'Two-factor verification', robots: { index: false } };

export default async function MfaPage() {
  const ctx = await getAdminContext({ allowWithoutMfa: true });
  if (ctx.mfaOk) redirect('/admin');
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-md flex-col items-center px-4 py-10">
      <Logo className="mb-8" />
      <Card className="w-full p-6">
        <h1 className="mb-4 text-2xl font-extrabold">Verify it’s you</h1>
        <MfaClient />
      </Card>
    </main>
  );
}
