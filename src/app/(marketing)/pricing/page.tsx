import type { Metadata } from 'next';
import Link from 'next/link';
import { PageIntro } from '@/components/marketing/feature-grid';
import { PricingCalculator } from './calculator';
import { TRIAL_DAYS } from '@/lib/billing/plans';

export const metadata: Metadata = { title: 'Pricing' };

const FAQ = [
  ['Why do you need my card for a free trial?', `It lets your account keep running without interruption when the trial ends. You are not charged during the ${TRIAL_DAYS} days, and you can cancel any time before the first payment.`],
  ['What happens if I cancel?', 'You keep access until the end of the period you paid for. After that your account becomes read-only: your records are kept and you can export them or reactivate whenever you like.'],
  ['Can I run retail and wholesale on one account?', 'Yes. Choose both and they share one set of books and one team.'],
  ['Who handles my card details?', 'Stripe. Card numbers go straight to Stripe and never touch RetailNexa’s servers.'],
];

export default function PricingPage() {
  return (
    <>
      <PageIntro title="Simple monthly pricing">
        <p>Pick retail, wholesale or both. Every plan starts with a {TRIAL_DAYS}-day free trial.</p>
      </PageIntro>
      <section className="mx-auto max-w-6xl px-4"><PricingCalculator /></section>
      <section className="mx-auto max-w-3xl px-4 pt-20">
        <h2 className="text-2xl font-extrabold">Questions about billing</h2>
        <dl className="mt-6 divide-y divide-line border-y border-line">
          {FAQ.map(([q, a]) => (
            <div key={q} className="py-5"><dt className="font-bold">{q}</dt><dd className="mt-1 text-muted">{a}</dd></div>
          ))}
        </dl>
        <p className="mt-6 text-muted">Full details are in the <Link href="/legal/billing" className="font-semibold text-accent-strong underline">subscription terms</Link>.</p>
      </section>
    </>
  );
}
