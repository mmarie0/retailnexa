import type { Metadata } from 'next';
import Link from 'next/link';
import { can, getOrgContext } from '@/lib/auth/context';
import { ActionForm } from '@/components/action-form';
import { Badge, Card, EmptyState, Eyebrow, Field, Input, LinkButton, Notice, PageHeader, Select, Textarea, cx } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';
import { formatMoney } from '@/lib/billing/plans';
import { DIRECTION_LABEL, METHODS, filterBalances, monthCheck, type Balance, type Filters } from '@/lib/bills/balances';
import { fmtDate } from '../format';
import { ReadOnlyNotice } from '../../read-only-notice';
import { Stat } from '../../_dashboard/tiles';
import { loadBalances } from './_load';
import { payBalance, removeBalanceItem, saveBalance } from './actions';

export const metadata: Metadata = { title: 'Location balances' };
const ymAdd = (ym: string, n: number) => new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 1 + n, 1)).toISOString().slice(0, 7);
const monthLabel = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' });
const STATUS = { settled: ['good', 'Settled'], late: ['danger', 'Past due'], soon: ['warning', 'Due soon'], open: ['neutral', 'Open'] } as const;

function BalanceFields({ b, stores, today }: { b?: Balance; stores: { id: string; name: string }[]; today: string }) {
  const p = b?.id ?? 'new';
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <input type="hidden" name="id" value={b?.id ?? ''} />
      <Field label="Who owes whom" htmlFor={`${p}-dir`}>
        <Select id={`${p}-dir`} name="direction" defaultValue={b?.direction ?? 'owed_to_me'}>
          <option value="owed_to_me">They owe me</option><option value="i_owe">I owe them</option>
        </Select>
      </Field>
      <Field label="Other store or location" htmlFor={`${p}-party`}><Input id={`${p}-party`} name="other_party" defaultValue={b?.other_party} required maxLength={100} placeholder="Brandon store" /></Field>
      {stores.length > 1 ? (
        <Field label="Your store" htmlFor={`${p}-loc`}>
          <Select id={`${p}-loc`} name="location_id" defaultValue={b?.location_id ?? ''} required><option value="">Choose…</option>{stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
        </Field>
      ) : <input type="hidden" name="location_id" value={stores[0]?.id ?? ''} />}
      <Field label="Date" htmlFor={`${p}-date`}><Input id={`${p}-date`} name="entry_date" type="date" defaultValue={b?.entry_date ?? today} required /></Field>
      <Field label="Paid by (optional)" htmlFor={`${p}-due`}><Input id={`${p}-due`} name="due_date" type="date" defaultValue={b?.due_date ?? ''} /></Field>
      <Field label="Counts in month" htmlFor={`${p}-month`} hint="For profit; blank = the date’s month"><Input id={`${p}-month`} name="count_month" type="month" defaultValue={b?.count_month.slice(0, 7) ?? ''} /></Field>
      <Field label="Amount" htmlFor={`${p}-amt`} hint="Blank = the lines’ total"><Input id={`${p}-amt`} name="amount" inputMode="decimal" className="num" defaultValue={b ? (b.amount_cents / 100).toFixed(2) : ''} /></Field>
      <Field label="Reference (optional)" htmlFor={`${p}-ref`}><Input id={`${p}-ref`} name="reference" defaultValue={b?.reference ?? ''} maxLength={100} /></Field>
      <Field label="Note (optional)" htmlFor={`${p}-note`}><Input id={`${p}-note`} name="note" defaultValue={b?.note ?? ''} maxLength={500} /></Field>
      <div className="sm:col-span-3">
        <Field label="Line items (optional)" htmlFor={`${p}-lines`} hint="One per line, amount last: Wigs 120.00">
          <Textarea id={`${p}-lines`} name="lines" rows={3} defaultValue={b?.lines.map((l) => `${l.description} ${(l.amount_cents / 100).toFixed(2)}`).join('\n') ?? ''} />
        </Field>
      </div>
    </div>
  );
}

/** #106 Location balances: what other stores owe you and what you owe them, with a month-end check. */
export default async function BalancesPage({ searchParams }: PageProps<'/app/bills/balances'>) {
  const ctx = await getOrgContext();
  if (!can(ctx, 'bills.view')) return <Notice tone="warning">You don’t have access to bills.</Notice>;
  const sp = await searchParams;
  const { today, balances, stores } = await loadBalances(ctx);
  const ym = typeof sp.m === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.m) ? sp.m : today.slice(0, 7);
  const f: Filters = {
    dir: sp.dir === 'owed_to_me' || sp.dir === 'i_owe' ? sp.dir : 'all',
    show: sp.show === 'all' || sp.show === 'settled' ? sp.show : 'open',
    party: typeof sp.q === 'string' ? sp.q.slice(0, 100) : '',
  };
  const list = filterBalances(balances, f);
  const check = monthCheck(balances, ym);
  const canAdd = can(ctx, 'bills.create') && ctx.access.canWrite, canPay = can(ctx, 'bills.pay') && ctx.access.canWrite;
  const storeName = new Map(stores.map((s) => [s.id, s.name]));
  const qs = (o: Record<string, string>) => `/app/bills/balances?${new URLSearchParams({ m: ym, dir: f.dir, show: f.show, q: f.party, ...o })}`;

  return (
    <>
      <PageHeader title="Location balances" description="What your other stores owe you and what you owe them. Records only: nothing posts to your books."
        actions={<LinkButton href="/app/bills/balances/export" variant="secondary">Export CSV</LinkButton>} />
      <ReadOnlyNotice show={can(ctx, 'bills.create') && !ctx.access.canWrite} />

      <nav aria-label="Month" className="flex items-center justify-between gap-2">
        <Link href={qs({ m: ymAdd(ym, -1) })} aria-label="Previous month" className="grid size-10 place-items-center rounded-full bg-card text-lg shadow-[var(--shadow-card)]">‹</Link>
        <h2 className="text-[20px] font-bold tracking-tight">Month-end check · {monthLabel(ym)}</h2>
        <Link href={qs({ m: ymAdd(ym, 1) })} aria-label="Next month" className="grid size-10 place-items-center rounded-full bg-card text-lg shadow-[var(--shadow-card)]">›</Link>
      </nav>
      <div className="grid grid-cols-2 gap-3">
        <Stat block="blue" label="They owe me" value={formatMoney(check.owedToMe.left)} sub={<>Due {formatMoney(check.owedToMe.due)} · Done {formatMoney(check.owedToMe.done)}</>} />
        <Stat block="coral" label="I owe them" value={formatMoney(check.iOwe.left)} sub={<>Due {formatMoney(check.iOwe.due)} · Done {formatMoney(check.iOwe.done)}</>} />
      </div>
      <p className="text-sm text-muted">Left to settle for {monthLabel(ym)}: <b className="num text-ink">{formatMoney(Math.abs(check.net))}</b> {check.net > 0 ? 'owed to you, net' : check.net < 0 ? 'you owe, net' : '(even)'}. A balance counts in the month you pick for it (for profit).</p>

      <form action="/app/bills/balances" className="flex flex-wrap items-end gap-2" role="search" aria-label="Filter balances">
        <input type="hidden" name="m" value={ym} />
        <Field label="Who owes whom" htmlFor="f-dir"><Select id="f-dir" name="dir" defaultValue={f.dir}><option value="all">Both</option><option value="owed_to_me">They owe me</option><option value="i_owe">I owe them</option></Select></Field>
        <Field label="Show" htmlFor="f-show"><Select id="f-show" name="show" defaultValue={f.show}><option value="open">Open</option><option value="settled">Settled</option><option value="all">All</option></Select></Field>
        <Field label="Store or location" htmlFor="f-q"><Input id="f-q" name="q" defaultValue={f.party} placeholder="Search" /></Field>
        <SubmitButton variant="secondary">Filter</SubmitButton>
      </form>

      {list.length === 0 ? (
        <EmptyState title={balances.length ? 'Nothing matches' : 'No location balances yet'}>{canAdd ? 'Add one below when a store borrows stock or covers a bill.' : null}</EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {list.map((b) => (
            <li key={b.id}>
              <Card className="flex flex-col gap-2.5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-bold">{b.other_party} <span className="font-normal text-muted">· {DIRECTION_LABEL[b.direction]}</span></p>
                    <p className="text-sm text-muted">{fmtDate(b.entry_date)}{b.due_date ? ` · paid by ${fmtDate(b.due_date)}` : ''} · counts in {monthLabel(b.count_month.slice(0, 7))}{stores.length > 1 ? ` · ${storeName.get(b.location_id) ?? 'Store'}` : ''}{b.reference ? ` · #${b.reference}` : ''}</p>
                  </div>
                  <div className="text-end">
                    <p className={cx('num text-[20px] font-medium', b.direction === 'i_owe' && b.left > 0 && 'text-late')}>{formatMoney(b.left)}</p>
                    <p className="text-xs text-muted">left of {formatMoney(b.amount_cents)}</p>
                    <Badge tone={STATUS[b.status][0]}>{STATUS[b.status][1]}</Badge>
                  </div>
                </div>
                {b.lines.length > 0 && (
                  <ul className="rounded-xl bg-soft px-3 py-2 text-sm">{b.lines.map((l, i) => <li key={i} className="flex justify-between gap-2"><span>{l.description}</span><span className="num">{formatMoney(Number(l.amount_cents))}</span></li>)}</ul>
                )}
                {b.note && <p className="text-sm text-muted">{b.note}</p>}
                {b.payments.length > 0 && (
                  <div className="text-sm">
                    <Eyebrow>Payments</Eyebrow>
                    <ul className="mt-1 flex flex-col gap-1">
                      {b.payments.map((p) => (
                        <li key={p.id} className="flex flex-wrap items-center justify-between gap-2">
                          <span>{fmtDate(p.paid_on)} · {METHODS[p.method as keyof typeof METHODS] ?? p.method}{p.reference ? ` · ${p.reference}` : ''}</span>
                          <span className="flex items-center gap-2"><b className="num font-medium">{formatMoney(p.amount_cents)}</b>
                            {canPay && <ActionForm action={removeBalanceItem} className="contents"><input type="hidden" name="kind" value="payment" /><input type="hidden" name="id" value={p.id} /><SubmitButton variant="ghost" size="sm" aria-label={`Remove the ${formatMoney(p.amount_cents)} payment`}>Remove</SubmitButton></ActionForm>}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  {canPay && b.left > 0 && (
                    <details className="w-full">
                      <summary className="cursor-pointer font-semibold text-accent-strong">{b.direction === 'owed_to_me' ? 'Mark collected' : 'Record a payment'}</summary>
                      <ActionForm action={payBalance} className="mt-2 grid gap-3 sm:grid-cols-4">
                        <input type="hidden" name="balance_id" value={b.id} />
                        <Field label="Amount" htmlFor={`pay-${b.id}-amt`}><Input id={`pay-${b.id}-amt`} name="amount" inputMode="decimal" className="num" defaultValue={(b.left / 100).toFixed(2)} required /></Field>
                        <Field label="Date" htmlFor={`pay-${b.id}-date`}><Input id={`pay-${b.id}-date`} name="paid_on" type="date" defaultValue={today} max={today} required /></Field>
                        <Field label="How" htmlFor={`pay-${b.id}-m`}><Select id={`pay-${b.id}-m`} name="method" defaultValue="zelle">{Object.entries(METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
                        <Field label="Reference (optional)" htmlFor={`pay-${b.id}-ref`}><Input id={`pay-${b.id}-ref`} name="reference" maxLength={100} /></Field>
                        <div className="sm:col-span-4"><SubmitButton>Save payment</SubmitButton></div>
                      </ActionForm>
                    </details>
                  )}
                  {canAdd && (
                    <details className="w-full">
                      <summary className="cursor-pointer text-sm font-semibold text-muted">Edit</summary>
                      <ActionForm action={saveBalance} className="mt-2 flex flex-col gap-3"><BalanceFields b={b} stores={stores} today={today} /><div><SubmitButton>Save changes</SubmitButton></div></ActionForm>
                      {b.payments.length === 0 && (
                        <ActionForm action={removeBalanceItem} className="mt-2"><input type="hidden" name="kind" value="balance" /><input type="hidden" name="id" value={b.id} /><SubmitButton variant="danger" size="sm">Remove this balance</SubmitButton></ActionForm>
                      )}
                    </details>
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {canAdd && (
        <Card id="add">
          <h2 className="text-lg font-bold">Add a balance</h2>
          <ActionForm action={saveBalance} className="mt-3 flex flex-col gap-3"><BalanceFields stores={stores} today={today} /><div><SubmitButton>Add balance</SubmitButton></div></ActionForm>
        </Card>
      )}
    </>
  );
}
