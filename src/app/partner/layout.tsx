import type { Metadata } from 'next';
import Link from 'next/link';
import { getAgentContext } from '@/lib/auth/context';
import { Logo } from '@/components/ui';
import { LanguageSwitch } from '@/components/language-switch';
import { getT } from '@/lib/i18n/server';

export const metadata: Metadata = { title: { default: 'Partner', template: '%s · RetailNexa Partner' }, robots: { index: false } };

/** Partner portal for sales agents: their own accounts, MRR and prospects only. */
export default async function PartnerLayout({ children }: { children: React.ReactNode }) {
  const t = await getT();
  const { agent, orgs } = await getAgentContext();
  return (
    <div className="mx-auto min-h-dvh max-w-[920px] px-4 pb-16">
      <header className="flex flex-wrap items-center justify-between gap-3 py-4">
        <Link href="/partner" className="flex items-center gap-2"><Logo /><span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-bold text-accent-strong">{t('Partner')}</span></Link>
        <nav className="flex items-center gap-3 text-sm font-semibold">
          <LanguageSwitch />
          {orgs.length > 0 && <Link href="/app" className="text-accent-strong">{t('My business')}</Link>}
          <Link href="/account/security" className="text-muted hover:text-ink">{t('Security')}</Link>
          <form action="/auth/signout" method="post"><button className="text-muted hover:text-ink">{t('Log out (')}{agent.name})</button></form>
        </nav>
      </header>
      <main id="main" className="flex min-w-0 flex-col gap-[18px]">{children}</main>
    </div>
  );
}
