import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentUser, getSupabase } from '@/lib/auth/context';
import { setActiveOrgCookie } from '@/lib/auth/org-cookie';
import { friendlyError } from '@/lib/actions';
import { Card, Logo, Notice } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';

export const metadata: Metadata = { title: 'Join your team', robots: { index: false } };

export default async function InvitePage({ params, searchParams }: PageProps<'/invite/[token]'>) {
  const { token } = await params;
  const sp = await searchParams;
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);

  async function accept() {
    'use server';
    const supabase = await getSupabase();
    const { data, error } = await supabase.rpc('accept_invitation', { p_token: token });
    if (error) redirect(`/invite/${token}?error=${encodeURIComponent(friendlyError(error))}`);
    await setActiveOrgCookie(data as string);
    redirect('/app');
  }

  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-md flex-col items-center px-4 py-10">
      <Logo className="mb-8" />
      <Card className="w-full p-6">
        <h1 className="text-2xl font-extrabold">Join your team on RetailNexa</h1>
        <p className="mt-2 text-muted">You’re signed in as <strong className="text-ink">{user.email}</strong>. The invitation only works for the email address it was sent to.</p>
        {typeof sp.error === 'string' && <div className="mt-4"><Notice tone="danger">{sp.error}</Notice></div>}
        <form action={accept} className="mt-6"><SubmitButton pendingText="Joining…" className="w-full">Accept invitation</SubmitButton></form>
      </Card>
    </main>
  );
}
