import type { Metadata } from 'next';
import Link from 'next/link';
import { FeatureGrid, PageIntro } from '@/components/marketing/feature-grid';
import { ACCOUNTING_FEATURES, PLATFORM_FEATURES, RETAIL_FEATURES, WHOLESALE_FEATURES } from '@/content/features';
import { buttonClass } from '@/components/ui';

export const metadata: Metadata = { title: 'Features' };

export default function FeaturesPage() {
  const sections = [
    { title: 'Retail', items: RETAIL_FEATURES },
    { title: 'Wholesale', items: WHOLESALE_FEATURES },
    { title: 'Accounting', items: ACCOUNTING_FEATURES },
    { title: 'Account and security', items: PLATFORM_FEATURES },
  ];
  return (
    <>
      <PageIntro title="Everything a store or warehouse runs on, in one place">
        <p>RetailNexa is being built module by module. Items marked “In development” are on the way and are not part of your plan yet.</p>
      </PageIntro>
      {sections.map((s) => (
        <section key={s.title} className="mx-auto max-w-6xl px-4 py-10">
          <h2 className="mb-6 text-2xl font-extrabold">{s.title}</h2>
          <FeatureGrid features={s.items} />
        </section>
      ))}
      <div className="mx-auto max-w-6xl px-4 pt-6"><Link href="/demo" className={buttonClass('primary', 'lg')}>Try the live demo</Link></div>
    </>
  );
}
