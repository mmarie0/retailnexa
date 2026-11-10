import type { Metadata } from 'next';
import { randomUUID } from 'node:crypto';
import { can, getOrgContext, getSupabase } from '@/lib/auth/context';
import { Badge, Card, EmptyState, Notice, PageHeader } from '@/components/ui';
import { formatMoney } from '@/lib/billing/plans';
import { todayIn } from '@/lib/time';
import { fmtDate } from '../bills/format';
import { KIND_LABEL, MovementForm, type Kind } from './movement-form';

export const metadata: Metadata = { title: 'Deposits & payments' };

export default async function DepositsPage() {
  const ctx = await getOrgContext();
  const full = can(ctx, 'accounting.post');
  if (!full && !can(ctx, 'cash.create') && !can(ctx, 'accounting.view')) return <Notice tone="warning">You don’t have access to deposits.</Notice>;
  const supabase = await getSupabase();
  const [{ data: rows }, { data: orgRow }] = await Promise.all([
    supabase.rpc('recent_money_movements', { p_org: ctx.org.id, p_limit: 40 }),
    supabase.from('organizations').select('timezone').eq('id', ctx.org.id).maybeSingle(),
  ]);
  const list = (rows ?? []) as { id: string; entry_date: string; kind: Kind; memo: string; amount_cents: number; reversed: boolean }[];
  const kinds: Kind[] = full ? ['card_deposit', 'cash_deposit', 'sales_tax_payment', 'owner_draw', 'owner_contribution'] : ['cash_deposit'];
  const canRecord = (full || can(ctx, 'cash.create')) && ctx.access.canWrite;

  return (
    <>
      <PageHeader title="Deposits & payments" description="Money moving between the store, the bank, the state and the owner. Each entry posts to the books with the right rule." />
      {canRecord && (
        <Card><MovementForm kinds={kinds} today={todayIn(orgRow?.timezone)} formKey={randomUUID()} /></Card>
      )}
      {list.length === 0 ? <EmptyState title="Nothing recorded yet" /> : (
        <Card className="p-0">
          <ul className="divide-y divide-line">
            {list.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                <span>
                  <span className="font-semibold">{KIND_LABEL[r.kind] ?? r.kind}</span>
                  <span className="text-muted"> · {fmtDate(r.entry_date)}{r.memo && r.memo !== KIND_LABEL[r.kind] ? ` · ${r.memo}` : ''}</span>
                </span>
                <span className="flex items-center gap-2">{r.reversed && <Badge tone="warning">Reversed</Badge>}<span className="num font-semibold">{formatMoney(Number(r.amount_cents))}</span></span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {full && <p className="text-sm text-muted">To undo an entry, reverse it from Accounting → Journal.</p>}
    </>
  );
}
