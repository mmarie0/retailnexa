import type { Metadata } from 'next';
import { can, getOrgContext } from '@/lib/auth/context';
import { Card, Notice, PageHeader, buttonClass } from '@/components/ui';

export const metadata: Metadata = { title: 'Export data' };

export default async function ExportPage() {
  const ctx = await getOrgContext();
  if (!can(ctx, 'data.export')) return <Notice tone="warning">Only owners, admins and accountants can export data.</Notice>;
  return (
    <>
      <PageHeader title="Export data" description="Download your business records. Exports stay available even after a subscription ends." />
      <Card className="max-w-2xl">
        <p>The export is a JSON file containing your business profile, locations, team members and roles, subscription history and audit log. As more modules ship (sales, bills, inventory, accounting), their records are added to this export.</p>
        <a href="/app/export" className={`${buttonClass('primary')} mt-4`} download>Download export</a>
      </Card>
    </>
  );
}
