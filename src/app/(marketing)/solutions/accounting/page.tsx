import type { Metadata } from 'next';
import Link from 'next/link';
import { FeatureGrid, PageIntro } from '@/components/marketing/feature-grid';
import { ACCOUNTING_FEATURES } from '@/content/features';
import { buttonClass } from '@/components/ui';

export const metadata: Metadata = { title: 'Accounting solutions' };

export default function Page() {
  return (
    <>
      <PageIntro title="Books that balance, without a second system"><p>Every sale, bill and payment posts to a double-entry ledger, so gross profit, operating profit and net income each mean what they say.</p></PageIntro>
      <section className="mx-auto max-w-6xl px-4 py-6"><FeatureGrid features={ACCOUNTING_FEATURES} /></section>
      <div className="mx-auto flex max-w-6xl flex-wrap gap-3 px-4 pt-10">
        <Link href="/demo" className={buttonClass('primary', 'lg')}>Try the live demo</Link>
        <Link href="/request-demo" className={buttonClass('secondary', 'lg')}>Request a walkthrough</Link>
      </div>
    </>
  );
}
