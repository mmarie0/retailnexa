import type { Metadata } from 'next';
import { PageIntro } from '@/components/marketing/feature-grid';
import { LeadForm } from '@/components/marketing/lead-form';
import { Card } from '@/components/ui';

export const metadata: Metadata = { title: 'Request a demo' };

export default function RequestDemoPage() {
  return (
    <>
      <PageIntro title="See RetailNexa with your own workflow">
        <p>Tell us a little about your business and we’ll set up a 30-minute walkthrough. Prefer to explore alone? The live demo needs no signup.</p>
      </PageIntro>
      <div className="mx-auto max-w-3xl px-4"><Card className="p-6 sm:p-8"><LeadForm kind="demo" /></Card></div>
    </>
  );
}
