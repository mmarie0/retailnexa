import type { Metadata } from 'next';
import Link from 'next/link';
import { SignupForm } from '../forms';
import { TRIAL_DAYS } from '@/lib/billing/plans';

export const metadata: Metadata = { title: 'Start your free trial' };

export default async function SignupPage({ searchParams }: PageProps<'/signup'>) {
  const sp = await searchParams;
  // Carry a plan chosen on the pricing page through to onboarding/billing.
  const plan = new URLSearchParams();
  for (const k of ['retail', 'wholesale', 'locations']) if (typeof sp[k] === 'string') plan.set(k, sp[k] as string);
  const next = `/onboarding${plan.size ? `?${plan}` : ''}`;
  return (
    <>
      <h1 className="text-2xl font-extrabold">Start your {TRIAL_DAYS}-day free trial</h1>
      <p className="mb-6 mt-1 text-muted">Already have an account? <Link href="/login" className="font-semibold text-accent-strong">Log in</Link></p>
      <SignupForm next={next} />
    </>
  );
}
