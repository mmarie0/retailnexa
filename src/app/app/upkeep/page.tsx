import type { Metadata } from 'next';
import { can, getOrgContext } from '@/lib/auth/context';
import { Notice } from '@/components/ui';
import { ComingSoon } from '../_soon';

export const metadata: Metadata = { title: 'Upkeep' };

export default async function UpkeepPage() {
  const ctx = await getOrgContext();
  if (!(['maintenance.view', 'tasks.view'] as const).some((p) => can(ctx, p))) return <Notice tone="warning">You don’t have access to maintenance.</Notice>;
  return (
    <ComingSoon title="Upkeep" tracking="parity #115" intro="A maintenance schedule for the store, the same as in your RetailNexa app."
      items={['Suggested maintenance tasks with how often they’re due', 'Add your own tasks and mark them done']} />
  );
}
