import type { Metadata } from 'next';
import Link from 'next/link';
import { FeatureGrid, PageIntro } from '@/components/marketing/feature-grid';
import { RETAIL_FEATURES } from '@/content/features';
import { buttonClass } from '@/components/ui';

export const metadata: Metadata = { title: 'Retail solutions' };

export default function Page() {
  return (
    <>
      <PageIntro title="Run your store from the register to the bank deposit"><p>Daily sales compared with the same weekday last year, every vendor bill in one place, and books that balance. Inventory is coming soon.</p></PageIntro>
      <section className="mx-auto max-w-6xl px-4 py-6"><FeatureGrid features={RETAIL_FEATURES} /></section>
      <div className="mx-auto flex max-w-6xl flex-wrap gap-3 px-4 pt-10">
        <Link href="/demo" className={buttonClass('primary', 'lg')}>Try the live demo</Link>
        <Link href="/request-demo" className={buttonClass('secondary', 'lg')}>Request a walkthrough</Link>
      </div>
    </>
  );
}
