import type { Metadata } from 'next';
import Link from 'next/link';
import { can, getOrgContext, getSupabase } from '@/lib/auth/context';
import { Badge, Card, EmptyState, LinkButton, Notice, PageHeader, cx } from '@/components/ui';
import { formatMoney } from '@/lib/billing/plans';
import { todayIn } from '@/lib/time';
import { ReadOnlyNotice } from '../read-only-notice';
import { STATUS_LABEL, STATUS_TONE, daysOverdue, fmtDate, type BillStatus } from './format';

export const metadata: Metadata = { title: 'Bills' };

const FILTERS = [
  { key: 'open', label: 'To pay', statuses: ['draft', 'approved'] },
  { key: 'paid', label: 'Paid', statuses: ['paid'] },
  { key: 'void', label: 'Void', statuses: ['void'] },
  { key: 'all', label: 'All', statuses: ['draft', 'approved', 'paid', 'void'] },
] as const;

export default async function BillsPage({ searchParams }: PageProps<'/app/bills'>) {
  const ctx = await getOrgContext();
  if (!can(ctx, 'bills.view')) return <Notice tone="warning">You don’t have access to bills.</Notice>;
  const sp = await searchParams;
  const filter = FILTERS.find((f) => f.key === sp.status) ?? FILTERS[0];
  const supabase = await getSupabase();
  const [{ data }, { data: vendors }, { data: orgRow }] = await Promise.all([
    supabase.from('bills').select('id, vendor_id, bill_number, bill_date, due_date, status, total_cents, paid_cents')
      .eq('organization_id', ctx.org.id).in('status', [...filter.statuses])
      .order('due_date', { ascending: true }).limit(200),
    supabase.from('vendors').select('id, name').eq('organization_id', ctx.org.id),
    supabase.from('organizations').select('timezone').eq('id', ctx.org.id).maybeSingle(),
  ]);
  const bills = data ?? [];
  const vendorName = new Map((vendors ?? []).map((v) => [v.id, v.name]));
  const today = todayIn(orgRow?.timezone);
  const open = bills.filter((b) => b.status === 'approved');
  const openTotal = open.reduce((a, b) => a + Number(b.total_cents) - Number(b.paid_cents), 0);
  const overdueTotal = open.filter((b) => daysOverdue(b.due_date, today) > 0)
    .reduce((a, b) => a + Number(b.total_cents) - Number(b.paid_cents), 0);
  const canCreate = can(ctx, 'bills.create') && ctx.access.canWrite;

  return (
    <>
      <PageHeader title="Bills" description="Supplier bills: enter them as drafts, approve to post them to the books, then record payments."
        actions={<><LinkButton href="/app/bills/aging" variant="secondary">Aging</LinkButton><LinkButton href="/app/bills/recurring" variant="secondary">Recurring</LinkButton>{canCreate && <LinkButton href="/app/bills/new">Enter a bill</LinkButton>}</>} />
      <ReadOnlyNotice show={can(ctx, 'bills.create') && !ctx.access.canWrite} />
      {filter.key === 'open' && open.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Card><p className="text-sm text-muted">Unpaid</p><p className="num text-2xl font-bold">{formatMoney(openTotal)}</p></Card>
          <Card><p className="text-sm text-muted">Overdue</p><p className={cx('num text-2xl font-bold', overdueTotal > 0 && 'text-late')}>{formatMoney(overdueTotal)}</p></Card>
        </div>
      )}
      <nav aria-label="Bill status" className="flex flex-wrap gap-1 self-start rounded-full bg-soft p-1">
        {FILTERS.map((f) => (
          <Link key={f.key} href={`/app/bills?status=${f.key}`} aria-current={f.key === filter.key ? 'page' : undefined}
            className={cx('rounded-full px-3.5 py-1.5 text-sm font-semibold', f.key === filter.key ? 'bg-card text-ink shadow-[var(--shadow-card)]' : 'text-muted hover:text-ink')}>
            {f.label}
          </Link>
        ))}
      </nav>
      {bills.length === 0 ? (
        <EmptyState title={filter.key === 'open' ? 'Nothing to pay' : 'No bills here'}>
          {filter.key === 'open' && canCreate ? 'Enter a supplier bill to start tracking what you owe.' : null}
        </EmptyState>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[640px] text-[15px]">
            <thead className="text-left text-sm text-muted">
              <tr><th className="px-5 py-3 font-semibold">Vendor</th><th className="px-3 font-semibold">Bill #</th><th className="px-3 font-semibold">Due</th><th className="px-3 font-semibold">Status</th><th className="px-5 text-right font-semibold">Open</th></tr>
            </thead>
            <tbody>
              {bills.map((b) => {
                const late = b.status === 'approved' ? daysOverdue(b.due_date, today) : 0;
                const openCents = b.status === 'void' ? 0 : Number(b.total_cents) - Number(b.paid_cents);
                return (
                  <tr key={b.id} className="border-t border-line hover:bg-soft/60">
                    <td className="px-5 py-2.5"><Link href={`/app/bills/${b.id}`} className="font-semibold text-accent-strong">{vendorName.get(b.vendor_id) ?? 'Vendor'}</Link></td>
                    <td className="px-3">{b.bill_number}</td>
                    <td className="px-3">{fmtDate(b.due_date)}{late > 0 && <span className="ml-2 text-sm font-semibold text-late">{late}d late</span>}</td>
                    <td className="px-3"><Badge tone={STATUS_TONE[b.status as BillStatus]}>{STATUS_LABEL[b.status as BillStatus]}</Badge></td>
                    <td className="num px-5 text-right">{formatMoney(openCents)}<span className="block text-sm text-muted">of {formatMoney(Number(b.total_cents))}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
