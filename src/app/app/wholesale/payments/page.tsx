import type { Metadata } from 'next';
import Link from 'next/link';
import { can } from '@/lib/auth/context';
import { ActionForm } from '@/components/action-form';
import { Card, Eyebrow, Field, Input, Notice, PageHeader, Select } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';
import { centsToInput } from '@/lib/money';
import { DEPOSITABLE, PAY_METHODS, addDays, methodLabel, scheduleGroups, standing, withBalances } from '@/lib/wholesale/ledger';
import { fmtDate } from '../../bills/format';
import { Stat } from '../../_dashboard/tiles';
import { loadCustomers, loadExpected, loadReceivables, wsContext, type ExpectedPayment } from '../_data';
import { Pills, money, money0 } from '../_ui';
import { addPlan, cancelExpected, markDeposited, receiveExpected } from '../actions';
import { PlanForm } from './plan-form';

export const metadata: Metadata = { title: 'Payments' };
const TABS: [string, string][] = [['', 'Schedule'], ['deposit', 'To deposit'], ['deposits', 'Deposits'], ['balances', 'Balances']];

/** The Ledger's Payments page: expected payments and plans, checks to deposit, deposits, and balances by customer. */
export default async function PaymentsPage({ searchParams }: PageProps<'/app/wholesale/payments'>) {
  const ctx = await wsContext();
  if (!can(ctx, 'wholesale.receivables.view')) return <Notice tone="warning">You don’t have access to payments.</Notice>;
  const sp = await searchParams;
  const tab = String(sp.tab ?? ''), only = typeof sp.customer === 'string' ? sp.customer : '';
  const [rec, customers, expected] = await Promise.all([loadReceivables(ctx.org.id), loadCustomers(ctx.org.id), loadExpected(ctx.org.id)]);
  const name = new Map(customers.map((c) => [c.id, c.name]));
  const inv = withBalances(rec.invoices, rec.payments, ctx.today);
  const invNo = new Map(inv.map((i) => [i.id, i]));
  const manage = can(ctx, 'wholesale.receivables.manage') && ctx.access.canWrite;
  const exp = expected.filter((e) => !only || e.customer_id === only);
  const g = scheduleGroups(exp, ctx.today);
  const outstanding = inv.reduce((s, i) => s + i.balance, 0);
  const next30 = exp.filter((e) => e.status === 'expected' && e.due_date >= ctx.today && e.due_date <= addDays(ctx.today, 30)).reduce((s, e) => s + e.amount_cents, 0);
  const toDeposit = rec.payments.filter((p) => DEPOSITABLE.includes(p.method) && !p.deposit_date && (!only || invNo.get(p.invoice_id)?.customer_id === only));
  const ym = ctx.today.slice(0, 7);
  const deposited = rec.payments.filter((p) => p.deposit_date?.startsWith(ym)).reduce((s, p) => s + p.amount_cents, 0);
  const scheduledBy = new Map<string, number>();
  for (const e of expected) if (e.status === 'expected') scheduledBy.set(e.customer_id, (scheduledBy.get(e.customer_id) ?? 0) + e.amount_cents);
  const balances = customers.map((c) => {
    const s = standing(c, inv, ctx.today);
    const sched = scheduledBy.get(c.id) ?? 0;
    const mine = expected.filter((e) => e.customer_id === c.id && e.status === 'expected');
    const last = rec.payments.filter((p) => invNo.get(p.invoice_id)?.customer_id === c.id).sort((a, b) => b.paid_on.localeCompare(a.paid_on))[0];
    return { c, s, sched, unscheduled: Math.max(s.balance - sched, 0), next: mine[0], last };
  }).filter((b) => b.s.balance > 0 || b.sched > 0).sort((a, b) => b.s.balance - a.s.balance);

  const expRow = (e: ExpectedPayment) => (
    <li key={e.id}>
      <Card className="flex flex-col gap-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <span className="min-w-0"><span className="block font-bold">{name.get(e.customer_id) ?? 'Customer'}</span>
            <span className="text-sm text-muted">{fmtDate(e.due_date)} · {methodLabel(e.method)}{e.check_no ? ` #${e.check_no}` : ''}{e.note ? ` · ${e.note}` : ''}</span></span>
          <span className={e.due_date < ctx.today ? 'num font-semibold text-late' : 'num font-semibold'}>{money(e.amount_cents)}</span>
        </div>
        {manage && (
          <details>
            <summary className="cursor-pointer font-semibold text-accent-strong">Received</summary>
            <ActionForm action={receiveExpected} className="mt-2 grid gap-2 sm:grid-cols-4">
              <input type="hidden" name="id" value={e.id} />
              <Field label="Amount" htmlFor={`a-${e.id}`}><Input id={`a-${e.id}`} name="amount" inputMode="decimal" className="num" defaultValue={centsToInput(e.amount_cents)} /></Field>
              <Field label="Received on" htmlFor={`r-${e.id}`}><Input id={`r-${e.id}`} name="received_on" type="date" defaultValue={ctx.today} max={ctx.today} required /></Field>
              <Field label="Method" htmlFor={`m-${e.id}`}><Select id={`m-${e.id}`} name="method" defaultValue={e.method}>{PAY_METHODS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}</Select></Field>
              <Field label="Check #" htmlFor={`c-${e.id}`}><Input id={`c-${e.id}`} name="check_no" defaultValue={e.check_no ?? ''} maxLength={30} /></Field>
              <div className="sm:col-span-4"><SubmitButton size="sm">Apply to oldest invoices</SubmitButton></div>
            </ActionForm>
            <ActionForm action={cancelExpected} className="mt-2" quiet><input type="hidden" name="id" value={e.id} /><SubmitButton variant="ghost" size="sm">Remove from schedule</SubmitButton></ActionForm>
          </details>
        )}
      </Card>
    </li>
  );
  const group = (title: string, list: ExpectedPayment[]) => list.length ? <section className="flex flex-col gap-2"><Eyebrow>{title} · {money(list.reduce((s, e) => s + e.amount_cents, 0))}</Eyebrow><ul className="flex flex-col gap-2">{list.map(expRow)}</ul></section> : null;
  const depositsByDate = [...rec.payments.filter((p) => p.deposit_date && DEPOSITABLE.includes(p.method)).reduce((m, p) => m.set(p.deposit_date!, [...(m.get(p.deposit_date!) ?? []), p]), new Map<string, typeof rec.payments>())]
    .sort(([a], [b]) => b.localeCompare(a)).slice(0, 40);

  return (
    <>
      <PageHeader title="Payments" description="Payments customers promised, checks and cash to take to the bank, and who owes what." />
      {only && <Notice action={<Link href="/app/wholesale/payments" className="font-semibold underline">Show everyone</Link>}>Showing {name.get(only) ?? 'one customer'} only.</Notice>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat block="blue" label="Outstanding" value={money0(outstanding)} />
        <Stat label="Scheduled, next 30 days" value={money0(next30)} />
        <Stat block={g.late.length ? 'coral' : undefined} label="Late promised payments" value={String(g.late.length)} sub={money0(g.late.reduce((s, e) => s + e.amount_cents, 0))} />
        <Stat label="To deposit" value={money0(toDeposit.reduce((s, p) => s + p.amount_cents, 0))} sub={`${money0(deposited)} deposited this month`} />
      </div>
      <Pills base="/app/wholesale/payments" current={tab} items={TABS} param="tab" />
      {rec.truncated && <p className="text-sm text-muted">Showing the first 20,000 invoices or payments; totals may be low.</p>}

      {tab === '' && (
        <>
          {group('Late', g.late)}
          {group('Next 7 days', g.soon)}
          {group('Later', g.later)}
          {!g.late.length && !g.soon.length && !g.later.length && <p className="text-muted">No payments scheduled. Set up a payment plan below when a customer promises to pay over time.</p>}
          {manage && (
            <Card>
              <h2 className="text-lg font-bold">New payment plan</h2>
              <p className="mt-1 text-sm text-muted">When a payment comes in, it’s applied to the customer’s oldest open invoices first.</p>
              <div className="mt-3"><PlanForm action={addPlan} today={ctx.today} initialCustomer={only || undefined} customers={balances.map((b) => ({ id: b.c.id, name: b.c.name, balance: b.s.balance, unscheduled: b.unscheduled }))} /></div>
            </Card>
          )}
        </>
      )}

      {tab === 'deposit' && (toDeposit.length ? (
        <Card>
          <ActionForm action={markDeposited} className="flex flex-col gap-3">
            <ul className="flex flex-col divide-y divide-soft">
              {toDeposit.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                  <label className="flex min-w-0 items-center gap-2.5">
                    {manage && <input type="checkbox" name="payment_id" value={p.id} defaultChecked className="size-4 accent-[#3f63de]" />}
                    <span className="min-w-0"><span className="block truncate font-semibold">{name.get(invNo.get(p.invoice_id)?.customer_id ?? '') ?? 'Customer'}</span>
                      <span className="text-sm text-muted">{fmtDate(p.paid_on)} · {methodLabel(p.method)}{p.check_no ? ` #${p.check_no}` : ''} · {invNo.get(p.invoice_id)?.number}</span></span>
                  </label>
                  <span className="num font-semibold">{money(p.amount_cents)}</span>
                </li>
              ))}
            </ul>
            {manage && (
              <div className="flex flex-wrap items-end gap-2">
                <Field label="Deposited on" htmlFor="dd"><Input id="dd" name="deposit_date" type="date" defaultValue={ctx.today} max={ctx.today} required /></Field>
                <SubmitButton>Mark ticked as deposited</SubmitButton>
              </div>
            )}
          </ActionForm>
        </Card>
      ) : <p className="text-muted">No checks or cash waiting to be deposited.</p>)}

      {tab === 'deposits' && (depositsByDate.length ? (
        <ul className="flex flex-col gap-2">
          {depositsByDate.map(([d, list]) => (
            <li key={d}>
              <Card>
                <div className="flex justify-between gap-2"><span className="font-bold">{fmtDate(d)}</span><span className="num font-bold">{money(list.reduce((s, p) => s + p.amount_cents, 0))}</span></div>
                <ul className="mt-1 text-sm text-muted">{list.map((p) => <li key={p.id} className="flex justify-between gap-2"><span>{name.get(invNo.get(p.invoice_id)?.customer_id ?? '') ?? 'Customer'} · {methodLabel(p.method)}{p.check_no ? ` #${p.check_no}` : ''}</span><span className="num">{money(p.amount_cents)}</span></li>)}</ul>
              </Card>
            </li>
          ))}
        </ul>
      ) : <p className="text-muted">No deposits yet.</p>)}

      {tab === 'balances' && (balances.length ? (
        <ul className="flex flex-col gap-2">
          {balances.map(({ c, s, sched, unscheduled, next, last }) => (
            <li key={c.id}>
              <Link href={`/app/wholesale/customers/${c.id}`} className="block rounded-[16px] bg-card px-4 py-3 shadow-[var(--shadow-card)] hover:bg-soft">
                <div className="flex justify-between gap-2"><span className="font-bold">{c.name}</span><span className="num font-bold">{money(s.balance)}</span></div>
                <p className="text-sm text-muted">
                  {[s.overdue && `${money(s.overdue)} overdue`, sched && `${money(sched)} scheduled`, unscheduled && `${money(unscheduled)} not scheduled`,
                    next && `next ${fmtDate(next.due_date)}`, last ? `last paid ${fmtDate(last.paid_on)}` : 'no payments yet'].filter(Boolean).join(' · ')}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      ) : <p className="text-muted">Nobody owes you anything.</p>)}
    </>
  );
}
