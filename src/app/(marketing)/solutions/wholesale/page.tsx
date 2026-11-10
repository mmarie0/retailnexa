import type { Metadata } from 'next';
import Link from 'next/link';
import { FeatureGrid, PageIntro } from '@/components/marketing/feature-grid';
import { WHOLESALE_FEATURES } from '@/content/features';
import { buttonClass } from '@/components/ui';

export const metadata: Metadata = { title: 'Wholesale solutions' };

export default function Page() {
  return (
    <>
      <PageIntro title="Take orders the way your customers actually buy"><p>Case packs and minimums, customer-specific prices, credit limits, and a portal your sales reps and customers can order from.</p></PageIntro>
      <section className="mx-auto max-w-6xl px-4 py-6"><FeatureGrid features={WHOLESALE_FEATURES} /></section>
      <div className="mx-auto flex max-w-6xl flex-wrap gap-3 px-4 pt-10">
        <Link href="/demo" className={buttonClass('primary', 'lg')}>Try the live demo</Link>
        <Link href="/request-demo" className={buttonClass('secondary', 'lg')}>Request a walkthrough</Link>
      </div>
    </>
  );
}
