import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getMyOrganizations, requireUser } from '@/lib/auth/context';
import { Card, Logo } from '@/components/ui';
import { OnboardingForm } from './form';
import { getT } from '@/lib/i18n/server';

export const metadata: Metadata = { title: 'Set up your business' };

export default async function OnboardingPage({ searchParams }: PageProps<'/onboarding'>) {
  const t = await getT();
  await requireUser('/onboarding');
  const sp = await searchParams;
  const orgs = await getMyOrganizations();
  if (orgs.length > 0 && sp.new !== '1') redirect('/app');

  const retail = sp.retail !== 'false';
  const wholesale = sp.wholesale === 'true';
  const defaultType = retail && wholesale ? 'both' : wholesale ? 'wholesale' : 'retail';
  const plan = new URLSearchParams();
  for (const k of ['retail', 'wholesale', 'locations']) if (typeof sp[k] === 'string') plan.set(k, sp[k] as string);

  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-xl flex-col px-4 py-10">
      <Logo className="mb-8" />
      <h1 className="text-[30px] font-extrabold leading-tight">{t('Set up your business')}</h1>
      <p className="mb-6 mt-1 text-muted">{t('Step 1 of 2. Next you’ll choose a plan and add a card. Nothing is charged for 7 days.')}</p>
      <Card className="p-6"><OnboardingForm defaultType={defaultType} plan={plan.toString()} /></Card>
    </main>
  );
}
