import type { Metadata } from 'next';
import Link from 'next/link';
import { can, getOrgContext, getSupabase } from '@/lib/auth/context';
import { Card, Eyebrow, Notice, PageHeader } from '@/components/ui';
import { Stat } from '../../_dashboard/tiles';

export const metadata: Metadata = { title: 'Storage' };
const GROUPS: { title: string; rows: [string, string][] }[] = [
  { title: 'Bills', rows: [['bills', 'Bills'], ['bill_payments', 'Bill payments'], ['vendors', 'Vendors'], ['recurring_bills', 'Fixed costs'], ['invoice_files', 'Invoice files'], ['vendor_statements', 'Vendor statements'], ['location_balances', 'Location balances']] },
  { title: 'Sales', rows: [['sales_days', 'Daily sales entries'], ['sales_months', 'Monthly reports'], ['category_sales', 'Category lines']] },
  { title: 'Books & bank', rows: [['journal_entries', 'Journal entries'], ['bank_lines', 'Bank statement lines'], ['distributions', 'Partner distributions']] },
  { title: 'Staff & upkeep', rows: [['employees', 'Employees'], ['shifts', 'Schedule shifts'], ['pay_runs', 'Pay runs'], ['maintenance_tasks', 'Maintenance tasks']] },
  { title: 'History', rows: [['audit_logs', 'Change history entries']] },
];
const mb = (b: number) => (b < 1024 * 1024 ? `${Math.max(0, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);

/** #116 Storage overview: what this business keeps in RetailNexa. */
export default async function StoragePage() {
  const ctx = await getOrgContext();
  if (!can(ctx, 'org.manage')) return <Notice tone="warning">Only owners and admins can see storage.</Notice>;
  const { data, error } = await (await getSupabase()).rpc('storage_overview', { p_org: ctx.org.id });
  if (error) throw error;
  const n = (k: string) => Number((data as Record<string, number> | null)?.[k] ?? 0);
  const records = GROUPS.flatMap((g) => g.rows).reduce((a, [k]) => a + n(k), 0);
  return (
    <>
      <PageHeader title="Storage" description="What your business keeps in RetailNexa. There’s no storage limit to manage; this is here so you can see it." />
      <div className="grid grid-cols-2 gap-3">
        <Stat block="blue" label="Records" value={records.toLocaleString('en-US')} sub="Across everything below" />
        <Stat label="Invoice files" value={mb(n('invoice_bytes'))} sub={`${n('invoice_files').toLocaleString('en-US')} files`} />
      </div>
      {GROUPS.map((g) => (
        <Card key={g.title}>
          <Eyebrow>{g.title}</Eyebrow>
          <dl className="mt-2 grid grid-cols-[1fr_auto] gap-y-1.5 text-[15px]">
            {g.rows.map(([k, label]) => <div key={k} className="contents"><dt className="text-muted">{label}</dt><dd className="num text-right font-medium">{n(k).toLocaleString('en-US')}</dd></div>)}
          </dl>
        </Card>
      ))}
      {can(ctx, 'data.export') && <p className="text-sm text-muted">Want a copy? <Link href="/app/settings/export" className="font-semibold text-accent-strong">Export your data</Link>.</p>}
    </>
  );
}
