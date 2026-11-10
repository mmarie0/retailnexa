import type { Metadata } from 'next';
import { getOrgContext } from '@/lib/auth/context';
import { ComingSoon } from '../_soon';

export const metadata: Metadata = { title: 'Upkeep' };

export default async function UpkeepPage() {
  await getOrgContext();
  return (
    <ComingSoon title="Upkeep" tracking="parity #115" intro="A maintenance schedule for the store, the same as in your RetailNexa app."
      items={['Suggested maintenance tasks with how often they’re due', 'Add your own tasks and mark them done']} />
  );
}
