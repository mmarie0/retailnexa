import type { Metadata } from 'next';
import Link from 'next/link';
import { PageIntro } from '@/components/marketing/feature-grid';
import { LeadForm } from '@/components/marketing/lead-form';
import { Card } from '@/components/ui';

export const metadata: Metadata = { title: 'Contact' };

export default function ContactPage() {
  return (
    <>
      <PageIntro title="Contact us">
        <p>Questions about plans, billing or getting set up. Existing customers can also find answers in the <Link className="font-semibold text-accent-strong underline" href="/help">help center</Link>.</p>
      </PageIntro>
      <div className="mx-auto max-w-3xl px-4"><Card className="p-6 sm:p-8"><LeadForm kind="contact" /></Card></div>
    </>
  );
}
