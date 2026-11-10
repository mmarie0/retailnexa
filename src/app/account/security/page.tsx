import type { Metadata } from 'next';
import Link from 'next/link';
import { requireUser } from '@/lib/auth/context';
import { Card, Logo } from '@/components/ui';
import { MfaClient } from '@/app/admin/mfa/mfa-client';

export const metadata: Metadata = { title: 'Account security', robots: { index: false } };

export default async function AccountSecurityPage() {
  const user = await requireUser('/account/security');
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-md flex-col items-center px-4 py-10">
      <Link href="/app" className="mb-8"><Logo /></Link>
      <Card className="w-full p-6">
        <h1 className="text-2xl font-extrabold">Two-factor authentication</h1>
        <p className="mb-4 mt-1 text-muted">Signed in as {user.email}. Add an authenticator app so a password alone can’t open your account.</p>
        <MfaClient mode="enroll" returnTo="/account/security" />
      </Card>
    </main>
  );
}
