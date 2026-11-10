import type { Metadata } from 'next';
import Link from 'next/link';
import { can, getOrgContext, getSupabase } from '@/lib/auth/context';
import { Badge, Card, EmptyState, Notice, PageHeader } from '@/components/ui';

export const metadata: Metadata = { title: 'Paystubs' };
const dl = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });

/** #102 Paystubs: every pay run, newest first; each opens printable stubs. */
export default async function StubsPage() {
  const ctx = await getOrgContext();
  if (!can(ctx, 'payroll.view')) return <Notice tone="warning">You don’t have access to payroll.</Notice>;
  const supabase = await getSupabase();
  const { data } = await supabase.from('pay_runs').select('id, pay_date, period_start, period_end, voided_at').eq('organization_id', ctx.org.id)
    .order('pay_date', { ascending: false }).limit(104);
  const runs = data ?? [];
  return (
    <>
      <PageHeader title="Paystubs" description="Print or save paystubs for any pay run, with your business name on top. Filter by cash or check, with or without employer taxes." />
      {runs.length === 0 ? <EmptyState title="No pay runs yet">Create one in <Link href="/app/staff/payroll#new" className="font-semibold text-accent-strong">Payroll</Link>.</EmptyState> : (
        <ul className="flex flex-col gap-2">
          {runs.map((r) => (
            <li key={r.id}>
              <Link href={`/app/staff/stubs/${r.id}`}>
                <Card className="flex items-center justify-between gap-3 py-3 hover:opacity-90">
                  <span className="flex flex-col"><span className="font-semibold">Paid {dl(r.pay_date)}</span><span className="text-[13px] text-muted">{dl(r.period_start)} – {dl(r.period_end)}</span></span>
                  {r.voided_at ? <Badge tone="warning">Voided</Badge> : <span className="text-sm font-semibold text-accent-strong">Open ›</span>}
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
