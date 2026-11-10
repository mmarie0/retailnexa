import type { Metadata } from 'next';
import Link from 'next/link';
import { can, getOrgContext, getSupabase } from '@/lib/auth/context';
import { Badge, Card, EmptyState, Field, Input, Notice, PageHeader, buttonClass } from '@/components/ui';
import { formatMoney } from '@/lib/billing/plans';
import { ActionForm } from '@/components/action-form';
import { SubmitButton } from '@/components/submit-button';
import { todayIn } from '@/lib/time';
import { AccountingTabs } from '../nav';
import { reverseJournalEntry } from '../actions';

// Entries owned by another record (a sale, bill, payment or bank line) are undone from that record's page.
const REVERSIBLE_HERE = new Set(['manual', 'card_deposit', 'cash_deposit', 'sales_tax_payment', 'owner_draw', 'owner_contribution']);

export const metadata: Metadata = { title: 'Journal' };
const PAGE = 50;

export default async function JournalPage({ searchParams }: PageProps<'/app/accounting/journal'>) {
  const ctx = await getOrgContext();
  if (!can(ctx, 'accounting.view')) return <Notice tone="warning">Only owners, admins and accountants can see the books.</Notice>;
  const sp = await searchParams;
  const page = Math.max(0, Number(sp.page) || 0);
  const supabase = await getSupabase();
  const { data: entries } = await supabase.from('journal_entries')
    .select('id, entry_date, memo, source_type, reverses_entry_id, posted_by_system, created_at')
    .eq('organization_id', ctx.org.id).order('entry_date', { ascending: false }).order('created_at', { ascending: false })
    .range(page * PAGE, page * PAGE + PAGE);
  const list = entries ?? [];
  const ids = list.slice(0, PAGE).map((e) => e.id);
  const [{ data: lines }, { data: accounts }] = await Promise.all([
    ids.length ? supabase.from('journal_lines').select('entry_id, account_id, debit_cents, credit_cents, memo').in('entry_id', ids) : Promise.resolve({ data: [] }),
    supabase.from('accounts').select('id, code, name').eq('organization_id', ctx.org.id),
  ]);
  const acct = new Map((accounts ?? []).map((a) => [a.id, a]));
  const reversed = new Set(list.map((e) => e.reverses_entry_id).filter(Boolean));
  const canReverse = can(ctx, 'accounting.post') && ctx.access.canWrite;
  const { data: orgRow } = canReverse ? await supabase.from('organizations').select('timezone').eq('id', ctx.org.id).maybeSingle() : { data: null };
  const today = todayIn(orgRow?.timezone);

  return (
    <>
      <PageHeader title="Journal" description="Every posted entry, newest first. Entries can’t be edited or deleted — mistakes are fixed with a reversing entry." />
      <AccountingTabs active="/app/accounting/journal" />
      {list.length === 0 ? (
        <EmptyState title="No entries yet">Entries appear here when sales, bills and payments are recorded.</EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {list.slice(0, PAGE).map((e) => {
            const ls = (lines ?? []).filter((l) => l.entry_id === e.id);
            const total = ls.reduce((a, l) => a + Number(l.debit_cents), 0);
            return (
              <li key={e.id}>
                <Card className="p-0">
                  <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4">
                    <p className="font-bold">{e.memo}</p>
                    <span className="flex items-center gap-2 text-sm text-muted">
                      {new Date(`${e.entry_date}T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' })}
                      {e.posted_by_system && <Badge>Automatic</Badge>}
                      {e.reverses_entry_id && <Badge tone="warning">Reversal</Badge>}
                      {reversed.has(e.id) && <Badge tone="danger">Reversed</Badge>}
                      <span className="num font-semibold text-ink">{formatMoney(total)}</span>
                    </span>
                  </div>
                  <table className="mt-2 w-full text-[15px]">
                    <thead className="sr-only"><tr><th>Account</th><th>Debit</th><th>Credit</th></tr></thead>
                    <tbody>
                      {ls.map((l, i) => {
                        const a = acct.get(l.account_id);
                        return (
                          <tr key={i} className="border-t border-line">
                            <td className="px-5 py-1.5"><span className="num mr-2 text-muted">{a?.code}</span>{a?.name}{l.memo && <span className="text-muted"> · {l.memo}</span>}</td>
                            <td className="num w-32 px-3 text-right">{Number(l.debit_cents) ? formatMoney(Number(l.debit_cents)) : ''}</td>
                            <td className="num w-32 px-5 text-right">{Number(l.credit_cents) ? formatMoney(Number(l.credit_cents)) : ''}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {canReverse && !e.reverses_entry_id && !reversed.has(e.id) && REVERSIBLE_HERE.has(e.source_type ?? 'manual') && (
                    <details className="px-5 pb-3 pt-1">
                      <summary className="cursor-pointer text-sm font-semibold text-late">Reverse this entry</summary>
                      <ActionForm action={reverseJournalEntry} className="mt-2 flex flex-wrap items-end gap-2">
                        <input type="hidden" name="entry" value={e.id} />
                        <Field label="Reversal date" htmlFor={`rd-${e.id}`}><Input id={`rd-${e.id}`} name="date" type="date" defaultValue={today} className="w-auto" required /></Field>
                        <Field label="Reason" htmlFor={`rr-${e.id}`}><Input id={`rr-${e.id}`} name="reason" required minLength={3} maxLength={480} className="w-72" /></Field>
                        <SubmitButton size="sm" variant="danger" pendingText="Reversing…">Reverse</SubmitButton>
                      </ActionForm>
                    </details>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex gap-2">
        {page > 0 && <Link className={buttonClass('secondary', 'sm')} href={`/app/accounting/journal?page=${page - 1}`}>Newer</Link>}
        {list.length > PAGE && <Link className={buttonClass('secondary', 'sm')} href={`/app/accounting/journal?page=${page + 1}`}>Older</Link>}
      </div>
    </>
  );
}
