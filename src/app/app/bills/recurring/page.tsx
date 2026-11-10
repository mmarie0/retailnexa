import type { Metadata } from 'next';
import Link from 'next/link';
import { can, getOrgContext, getSupabase } from '@/lib/auth/context';
import { ActionForm } from '@/components/action-form';
import { Badge, Card, EmptyState, Field, Input, Notice, PageHeader, Select } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';
import { formatMoney } from '@/lib/billing/plans';
import { requestNow, todayIn } from '@/lib/time';
import { QUICK_FIXED, daysInMonth, suggestRecurring, ymAdd } from '@/lib/bills/due';
import { fmtDate } from '../format';
import { ReadOnlyNotice } from '../../read-only-notice';
import { createDueRecurringBills, saveRecurringBill } from './actions';

export const metadata: Metadata = { title: 'Recurring bills' };
const FREQ: Record<string, string> = { weekly: 'Every week', monthly: 'Every month', quarterly: 'Every 3 months', yearly: 'Every year' };
type Line = { account_id: string; amount_cents: number; description: string | null };
type Tpl = { id: string; vendor_id: string; location_id: string | null; name: string; lines: Line[]; frequency: string; next_date: string; end_date: string | null; due_days: number; is_active: boolean; last_error?: string | null };
type Opt = { id: string; label: string };

type Preset = { name?: string; amount?: string; next?: string };

function Fields({ t, vendors, accounts, locations, today, preset }: { t?: Tpl; vendors: Opt[]; accounts: Opt[]; locations: Opt[]; today: string; preset?: Preset }) {
  const p = t?.id ?? 'new';
  const line = t?.lines[0];
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <input type="hidden" name="id" value={t?.id ?? ''} />
      <Field label="Name" htmlFor={`${p}-name`}><Input id={`${p}-name`} name="name" defaultValue={t?.name ?? preset?.name} placeholder="Rent" required maxLength={80} /></Field>
      <Field label="Vendor" htmlFor={`${p}-vendor`}>
        <Select id={`${p}-vendor`} name="vendor_id" defaultValue={t?.vendor_id ?? ''} required><option value="">Choose…</option>{vendors.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}</Select>
      </Field>
      <Field label="Amount" htmlFor={`${p}-amount`}><Input id={`${p}-amount`} name="amount" inputMode="decimal" className="num w-full" defaultValue={line ? (line.amount_cents / 100).toFixed(2) : preset?.amount ?? ''} required /></Field>
      <Field label="Account" htmlFor={`${p}-acct`}>
        <Select id={`${p}-acct`} name="account_id" defaultValue={line?.account_id ?? ''} required><option value="">Choose…</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</Select>
      </Field>
      <Field label="How often" htmlFor={`${p}-freq`}>
        <Select id={`${p}-freq`} name="frequency" defaultValue={t?.frequency ?? 'monthly'}>{Object.entries(FREQ).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
      </Field>
      <Field label={t ? 'Next bill date' : 'First bill date'} htmlFor={`${p}-next`}><Input id={`${p}-next`} name="next_date" type="date" defaultValue={t?.next_date ?? preset?.next ?? today} required /></Field>
      <Field label="Due after (days)" htmlFor={`${p}-due`}><Input id={`${p}-due`} name="due_days" type="number" min={0} max={365} defaultValue={t?.due_days ?? 0} /></Field>
      <Field label="Stop after (optional)" htmlFor={`${p}-end`}><Input id={`${p}-end`} name="end_date" type="date" defaultValue={t?.end_date ?? ''} /></Field>
      {locations.length > 1 && (
        <Field label="Store" htmlFor={`${p}-loc`}>
          <Select id={`${p}-loc`} name="location_id" defaultValue={t?.location_id ?? ''}><option value="">Whole business</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}</Select>
        </Field>
      )}
      <Field label="Line description (optional)" htmlFor={`${p}-desc`}><Input id={`${p}-desc`} name="description" defaultValue={line?.description ?? ''} maxLength={300} /></Field>
      {t && (
        <label className="flex items-center gap-2 self-end pb-2 text-[15px]">
          <input type="hidden" name="is_active" value="false" />
          <input type="checkbox" name="is_active" value="true" defaultChecked={t.is_active} className="size-4 accent-[#3f63de]" /> Active
        </label>
      )}
    </div>
  );
}

export default async function RecurringBillsPage({ searchParams }: PageProps<'/app/bills/recurring'>) {
  const ctx = await getOrgContext();
  if (!can(ctx, 'bills.view')) return <Notice tone="warning">You don’t have access to bills.</Notice>;
  const sp = await searchParams;
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : undefined);
  const preset: Preset = {
    name: str(sp.name, 80),
    amount: /^\d{1,9}(\.\d{1,2})?$/.test(str(sp.amount, 12) ?? '') ? str(sp.amount, 12) : undefined,
    next: /^\d{4}-\d{2}-\d{2}$/.test(str(sp.next, 10) ?? '') ? str(sp.next, 10) : undefined,
  };
  const supabase = await getSupabase();
  const since = new Date(requestNow() - 400 * 86_400_000).toISOString().slice(0, 10);
  const [{ data: bankLines }] = await Promise.all([
    can(ctx, 'bank.view')
      ? supabase.from('bank_lines').select('posted_on, description, amount_cents').eq('organization_id', ctx.org.id).lt('amount_cents', 0).gte('posted_on', since).limit(5000)
      : Promise.resolve({ data: [] as { posted_on: string; description: string; amount_cents: number }[] }),
  ]);
  const [{ data: tpls }, { data: vendors }, { data: accounts }, { data: locs }, { data: orgRow }] = await Promise.all([
    supabase.from('recurring_bills').select('id, vendor_id, location_id, name, lines, frequency, next_date, end_date, due_days, is_active, last_error').eq('organization_id', ctx.org.id).order('next_date'),
    supabase.from('vendors').select('id, name').eq('organization_id', ctx.org.id).eq('is_active', true).order('name'),
    supabase.rpc('bill_account_options', { p_org: ctx.org.id }),
    supabase.rpc('my_locations', { p_org: ctx.org.id }),
    supabase.from('organizations').select('timezone').eq('id', ctx.org.id).maybeSingle(),
  ]);
  const list = (tpls ?? []) as Tpl[];
  const vendorOpts = (vendors ?? []).map((v) => ({ id: v.id, label: v.name }));
  const vendorName = new Map(vendorOpts.map((v) => [v.id, v.label]));
  const acctOpts = ((accounts ?? []) as { id: string; code: string; name: string }[]).map((a) => ({ id: a.id, label: `${a.code} · ${a.name}` }));
  const locOpts = ((locs ?? []) as { id: string; name: string }[]).map((l) => ({ id: l.id, label: l.name }));
  const today = todayIn(orgRow?.timezone);
  const editable = can(ctx, 'bills.create') && ctx.access.canWrite;
  const due = list.filter((t) => t.is_active && t.next_date <= today).length;
  const have = (n: string) => list.some((t) => t.name.toLowerCase() === n.toLowerCase());
  const quick = QUICK_FIXED.filter((n) => !have(n));
  // Next date on the usual day of the month, from today.
  const nextOn = (day: number) => {
    const ym = today.slice(0, 7);
    const d = (m: string) => `${m}-${String(Math.min(day, daysInMonth(m))).padStart(2, '0')}`;
    return d(ym) >= today ? d(ym) : d(ymAdd(ym, 1));
  };
  const suggestions = suggestRecurring(bankLines ?? [], list.map((t) => t.name));
  const presetHref = (o: Preset) => `/app/bills/recurring?${new URLSearchParams(Object.entries(o).filter(([, v]) => v) as [string, string][])}#add`;

  return (
    <>
      <PageHeader title="Recurring bills" description="Bills that come every week, month, quarter or year — rent, utilities, card-terminal fees. Each period becomes a draft bill to approve, never a duplicate."
        actions={<Link href="/app/bills/list" className="font-semibold text-accent-strong">All bills</Link>} />
      <ReadOnlyNotice show={can(ctx, 'bills.create') && !ctx.access.canWrite} />
      {editable && list.length > 0 && (
        <Card className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[15px]">{due ? <><strong>{due}</strong> recurring bill{due === 1 ? ' is' : 's are'} due.</> : 'Nothing is due right now.'}</p>
          <ActionForm action={createDueRecurringBills} className="flex flex-col items-end gap-2"><SubmitButton pendingText="Creating…" disabled={!due}>Create due bills</SubmitButton></ActionForm>
        </Card>
      )}
      {list.length === 0 ? <EmptyState title="No recurring bills yet">{editable ? 'Add your rent or another fixed cost below.' : null}</EmptyState> : (
        <ul className="flex flex-col gap-3">
          {list.map((t) => {
            const total = t.lines.reduce((a, l) => a + Number(l.amount_cents), 0);
            return (
              <li key={t.id}>
                <Card>
                  <details>
                    <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-3">
                      <span><span className="font-bold">{t.name}</span> <span className="text-muted">· {vendorName.get(t.vendor_id) ?? 'Vendor'} · {FREQ[t.frequency]}</span></span>
                      <span className="flex items-center gap-2">
                        {t.last_error && t.is_active && <Badge tone="danger">Needs attention</Badge>}
                        {!t.is_active ? <Badge>Stopped</Badge> : t.next_date <= today ? <Badge tone="warning">Due</Badge> : <span className="text-sm text-muted">next {fmtDate(t.next_date)}</span>}
                        <span className="num font-semibold">{formatMoney(total)}</span>
                      </span>
                    </summary>
                    {t.last_error && t.is_active && (
                      <p className="mt-3 text-sm text-late">The last bill couldn’t be created: {t.last_error}. Pick an active vendor and account, then save.</p>
                    )}
                    {editable && (
                      <ActionForm action={saveRecurringBill} className="mt-4 flex flex-col gap-3">
                        <Fields t={t} vendors={vendorOpts} accounts={acctOpts} locations={locOpts} today={today} />
                        {t.lines.length > 1 && <p className="text-sm text-soon">This template has {t.lines.length} lines; saving here keeps only the first.</p>}
                        <SubmitButton className="self-start" variant="secondary" pendingText="Saving…">Save</SubmitButton>
                      </ActionForm>
                    )}
                  </details>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
      {editable && quick.length > 0 && (
        <Card className="flex flex-col gap-2">
          <h2 className="font-bold">{list.length ? 'Add another fixed cost' : 'Add the bills that never change'}</h2>
          <div className="flex flex-wrap gap-1.5">
            {quick.map((n) => <Link key={n} href={presetHref({ name: n })} className="rounded-full bg-soft px-3 py-1.5 text-sm font-semibold text-accent-strong">+ {n}</Link>)}
          </div>
        </Card>
      )}
      {editable && suggestions.length > 0 && (
        <Card className="flex flex-col gap-2">
          <h2 className="font-bold">Suggested from your bank</h2>
          <p className="text-sm text-muted">Withdrawals that show up month after month. Tap one to fill in the form below; nothing is added until you save.</p>
          <ul className="flex flex-col divide-y divide-line">
            {suggestions.map((g) => (
              <li key={g.label}>
                <Link href={presetHref({ name: g.label.slice(0, 80), amount: (g.avgCents / 100).toFixed(2), next: nextOn(g.day) })} className="flex items-baseline justify-between gap-3 py-2 text-[15px]">
                  <span className="min-w-0 truncate"><b>{g.label}</b> <span className="text-sm text-muted">· {g.months} months · around day {g.day}</span></span>
                  <span className="num shrink-0">≈ {formatMoney(g.avgCents)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {editable && (vendorOpts.length === 0 ? <Notice tone="info">Add a vendor first.</Notice> : (
        <Card id="add">
          <h2 className="mb-4 text-lg font-bold">Add a recurring bill</h2>
          <ActionForm action={saveRecurringBill} className="flex flex-col gap-4">
            <Fields vendors={vendorOpts} accounts={acctOpts} locations={locOpts} today={today} preset={preset} key={JSON.stringify(preset)} />
            <SubmitButton className="self-start" pendingText="Adding…">Add recurring bill</SubmitButton>
          </ActionForm>
        </Card>
      ))}
    </>
  );
}
