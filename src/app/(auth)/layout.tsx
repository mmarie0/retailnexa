import Link from 'next/link';
import { Logo } from '@/components/ui';
import { getT } from '@/lib/i18n/server';

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const t = await getT();
  return (
    <main id="main" className="flex min-h-dvh flex-col items-center px-4 py-10">
      <Link href="/" aria-label={t('RetailNexa home')} className="mb-8"><Logo /></Link>
      <div className="w-full max-w-md rounded-[22px] border border-line bg-card p-6 shadow-[var(--shadow-card)] sm:p-8">{children}</div>
    </main>
  );
}
