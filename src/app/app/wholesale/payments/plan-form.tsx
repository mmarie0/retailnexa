'use client';
import { useActionState, useState } from 'react';
import { Button, Field, FormMessage, Input, Select } from '@/components/ui';
import { initialActionState, type ActionState } from '@/lib/actions';
import { formatMoney } from '@/lib/billing/plans';
import { centsToInput, parseDollarsToCents } from '@/lib/money';
import { PAY_METHODS, addDays, splitPlan } from '@/lib/wholesale/ledger';

type Row = { due_date: string; amount: string; check_no: string };

/** Payment plan: split what a customer owes into dated payments (post-dated check numbers too). */
export function PlanForm({ action, customers, today, initialCustomer }: {
  action: (p: ActionState, f: FormData) => Promise<ActionState>;
  customers: { id: string; name: string; balance: number; unscheduled: number }[];
  today: string; initialCustomer?: string;
}) {
  const [state, run] = useActionState(action, initialActionState);
  const [cust, setCust] = useState(initialCustomer ?? '');
  const c = customers.find((x) => x.id === cust);
  const [total, setTotal] = useState(c ? centsToInput(c.unscheduled) : '');
  const [n, setN] = useState('3');
  const [first, setFirst] = useState(addDays(today, 7));
  const [every, setEvery] = useState('14');
  const [rows, setRows] = useState<Row[]>([]);
  const split = () => {
    const cents = parseDollarsToCents(total);
    if (!cents) return;
    setRows(splitPlan(cents, Math.min(Math.max(Number(n) || 1, 1), 60), first, Math.max(Number(every) || 1, 1)).map((r) => ({ due_date: r.due_date, amount: centsToInput(r.amount_cents), check_no: '' })));
  };
  const sum = rows.reduce((s, r) => s + (parseDollarsToCents(r.amount) ?? 0), 0);

  return (
    <form action={run} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Customer" htmlFor="pc">
          <Select id="pc" name="customer_id" value={cust} onChange={(e) => { setCust(e.target.value); const x = customers.find((y) => y.id === e.target.value); if (x) setTotal(centsToInput(x.unscheduled)); }} required>
            <option value="">Choose…</option>
            {customers.map((x) => <option key={x.id} value={x.id}>{x.name} · owes {formatMoney(x.balance)}</option>)}
          </Select>
        </Field>
        <Field label="Amount to schedule" htmlFor="pt" hint={c ? `${formatMoney(c.unscheduled)} isn’t scheduled yet.` : undefined}><Input id="pt" inputMode="decimal" className="num" value={total} onChange={(e) => setTotal(e.target.value)} /></Field>
        <Field label="Number of payments" htmlFor="pn"><Input id="pn" type="number" min={1} max={60} className="num" value={n} onChange={(e) => setN(e.target.value)} /></Field>
        <Field label="First payment" htmlFor="pf"><Input id="pf" type="date" value={first} onChange={(e) => setFirst(e.target.value)} /></Field>
        <Field label="Every (days)" htmlFor="pe"><Input id="pe" type="number" min={1} max={365} className="num" value={every} onChange={(e) => setEvery(e.target.value)} /></Field>
        <div className="flex items-end"><Button type="button" variant="secondary" size="sm" onClick={split}>Split into payments</Button></div>
      </div>
      {rows.length > 0 && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="How they’ll pay" htmlFor="pm"><Select id="pm" name="method" defaultValue="check">{PAY_METHODS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}</Select></Field>
            <Field label="Their bank (optional)" htmlFor="pb"><Input id="pb" name="bank" maxLength={60} /></Field>
            <Field label="Note (optional)" htmlFor="pnote"><Input id="pnote" name="note" maxLength={200} /></Field>
          </div>
          <ul className="flex flex-col gap-2">
            {rows.map((r, i) => (
              <li key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] items-center gap-2">
                <Input name="due_date" type="date" value={r.due_date} aria-label={`Payment ${i + 1} date`} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, due_date: e.target.value } : x)))} />
                <Input name="amount" inputMode="decimal" className="num" value={r.amount} aria-label={`Payment ${i + 1} amount`} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
                <Input name="check_no" placeholder="Check # (optional)" maxLength={30} value={r.check_no} aria-label={`Payment ${i + 1} check number`} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, check_no: e.target.value } : x)))} />
                <button type="button" onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label={`Remove payment ${i + 1}`} className="px-2 text-lg text-muted hover:text-late">×</button>
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted">Total <span className="num font-semibold text-ink">{formatMoney(sum)}</span> in {rows.length} payment{rows.length === 1 ? '' : 's'}.</p>
          <div><Button type="submit" disabled={!cust}>Save payment plan</Button></div>
        </>
      )}
      <FormMessage state={state} />
    </form>
  );
}
