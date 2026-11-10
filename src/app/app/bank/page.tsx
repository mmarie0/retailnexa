import type { Metadata } from 'next';
import Link from 'next/link';
import { can, getOrgContext, getSupabase } from '@/lib/auth/context';
import { ActionForm } from '@/components/action-form';
import { Badge, Card, EmptyState, Input, Notice, PageHeader, Select, cx } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';
import { formatMoney } from '@/lib/billing/plans';
import { fmtDate } from '../bills/format';
import { categorizeBankLine, ignoreBankLine, matchBankLine, unmatchBankLine } from './actions';
import { StatementImporter } from './statement-importer';

export const metadata: Metadata = { title: 'Bank' };
type Line = { id: string; posted_on: string; description: string; amount_cents: number; status: string; journal_entry_id: string | null; note: string | null };
type Cand = { line_id: string; entry_id: string; entry_date: string; memo: string; source_type: string | null; day_diff: number };
const STATUS: Record<string, { label: string; tone: 'good' | 'info' | 'neutral' }> = {
  matched: { label: 'Matched', tone: 'good' }, categorized: { label: 'Categorized', tone: 'info' }, ignored: { label: 'Ignored', tone: 'neutral' },
};

export default async function BankPage({ searchParams }: PageProps<'/app/bank'>) {
  const ctx = await getOrgContext();
  if (!can(ctx, 'bank.view')) return <Notice tone="warning">Only owners, admins and accountants can see bank statements.</Notice>;
  const sp = await searchParams;
  const showDone = sp.show === 'done';
  const canAct = can(ctx, 'accounting.post') && ctx.access.canWrite;
  const supabase = await getSupabase();
  const [{ data: open }, { data: resolved }, { data: cands }, { data: accounts }] = await Promise.all([
    supabase.from('bank_lines').select('id, posted_on, description, amount_cents, status, journal_entry_id, note')
      .eq('organization_id', ctx.org.id).eq('status', 'unmatched').order('posted_on').limit(300),
    showDone ? supabase.from('bank_lines').select('id, posted_on, description, amount_cents, status, journal_entry_id, note')
      .eq('organization_id', ctx.org.id).neq('status', 'unmatched').order('posted_on', { ascending: false }).limit(200) : Promise.resolve({ data: [] }),
    supabase.rpc('bank_match_candidates', { p_org: ctx.org.id, p_days: 7 }),
    can(ctx, 'accounting.view') ? supabase.from('accounts').select('id, code, name, role').eq('organization_id', ctx.org.id).eq('is_active', true).order('code') : Promise.resolve({ data: [] }),
  ]);
  const lines = (open ?? []) as Line[];
  const byLine = new Map<string, Cand[]>();
  for (const c of (cands ?? []) as Cand[]) byLine.set(c.line_id, [...(byLine.get(c.line_id) ?? []), c]);
  const acctOptions = (accounts ?? []).filter((a) => a.role !== 'bank');
  const outstanding = lines.reduce((a, l) => a + Number(l.amount_cents), 0);

  return (
    <>
      <PageHeader title="Bank" description="Import your bank statement and tick off each line against the books. Anything the books don’t have yet can be posted from here." />
      {canAct && <Card><StatementImporter /></Card>}
      <nav aria-label="Bank lines" className="flex gap-1 self-start rounded-full bg-soft p-1">
        {[['', `To do (${lines.length})`], ['done', 'Done']].map(([k, label]) => (
          <Link key={k} href={k ? `/app/bank?show=${k}` : '/app/bank'} aria-current={(k === 'done') === showDone ? 'page' : undefined}
            className={cx('rounded-full px-3.5 py-1.5 text-sm font-semibold', (k === 'done') === showDone ? 'bg-card text-ink shadow-[var(--shadow-card)]' : 'text-muted hover:text-ink')}>{label}</Link>
        ))}
      </nav>

      {!showDone && (lines.length === 0 ? <EmptyState title="Nothing to reconcile">Import a statement to start.</EmptyState> : (
        <>
          <p className="text-[15px] text-muted">Unreconciled lines net to <strong className="num text-ink">{formatMoney(outstanding)}</strong>.</p>
          <ul className="flex flex-col gap-3">
            {lines.map((l) => {
              const c = byLine.get(l.id) ?? [];
              const amt = Number(l.amount_cents);
              return (
                <li key={l.id}>
                  <Card>
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p><span className="font-semibold">{l.description}</span> <span className="text-muted">· {fmtDate(l.posted_on)}</span></p>
                      <p className={cx('num font-bold', amt > 0 ? 'text-paid' : 'text-ink')}>{amt > 0 ? '+' : '−'}{formatMoney(Math.abs(amt))}</p>
                    </div>
                    {canAct && (
                      <div className="mt-3 flex flex-col gap-3">
                        {c.slice(0, 3).map((m) => (
                          <ActionForm key={m.entry_id} action={matchBankLine} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-paid-soft/60 px-3 py-2">
                            <input type="hidden" name="line" value={l.id} /><input type="hidden" name="entry" value={m.entry_id} />
                            <span className="text-[15px]">Matches <strong>{m.memo}</strong> on {fmtDate(m.entry_date)}{m.day_diff ? ` (${m.day_diff} day${m.day_diff === 1 ? '' : 's'} apart)` : ''}</span>
                            <SubmitButton size="sm" pendingText="Matching…">Match</SubmitButton>
                          </ActionForm>
                        ))}
                        <details>
                          <summary className="cursor-pointer text-sm font-semibold text-accent-strong">{c.length ? 'Not this — post or ignore instead' : 'Post to the books or ignore'}</summary>
                          <div className="mt-2 grid gap-3 md:grid-cols-2">
                            <ActionForm action={categorizeBankLine} className="flex flex-col gap-2">
                              <input type="hidden" name="line" value={l.id} />
                              <Select name="account" aria-label="Account" defaultValue="">
                                <option value="">{amt > 0 ? 'Money in from…' : 'Money out for…'}</option>
                                {acctOptions.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
                              </Select>
                              <Input name="memo" placeholder="Note (optional)" maxLength={300} aria-label="Note" />
                              <SubmitButton size="sm" variant="secondary" className="self-start" pendingText="Posting…">Post</SubmitButton>
                            </ActionForm>
                            <ActionForm action={ignoreBankLine} className="flex flex-col gap-2">
                              <input type="hidden" name="line" value={l.id} />
                              <Input name="reason" placeholder="Why ignore? e.g. transfer between own accounts" minLength={3} maxLength={300} required aria-label="Reason" />
                              <SubmitButton size="sm" variant="ghost" className="self-start" pendingText="Saving…">Ignore</SubmitButton>
                            </ActionForm>
                          </div>
                        </details>
                      </div>
                    )}
                  </Card>
                </li>
              );
            })}
          </ul>
        </>
      ))}

      {showDone && ((resolved ?? []).length === 0 ? <EmptyState title="Nothing reconciled yet" /> : (
        <Card className="p-0">
          <ul className="divide-y divide-line">
            {((resolved ?? []) as Line[]).map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                <span><span className="font-semibold">{l.description}</span> <span className="text-muted">· {fmtDate(l.posted_on)}{l.note ? ` · ${l.note}` : ''}</span></span>
                <span className="flex items-center gap-3">
                  <Badge tone={STATUS[l.status]?.tone ?? 'neutral'}>{STATUS[l.status]?.label ?? l.status}</Badge>
                  <span className="num font-semibold">{formatMoney(Number(l.amount_cents))}</span>
                  {canAct && (
                    <ActionForm action={unmatchBankLine}><input type="hidden" name="line" value={l.id} />
                      <SubmitButton size="sm" variant="ghost" pendingText="Undoing…">Undo</SubmitButton></ActionForm>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </>
  );
}
