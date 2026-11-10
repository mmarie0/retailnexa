import type { Metadata } from 'next';
import Link from 'next/link';
import { can, getOrgContext, getSupabase } from '@/lib/auth/context';
import { ActionForm } from '@/components/action-form';
import { Badge, Card, EmptyState, Field, Input, Notice, PageHeader, Select, Textarea, cx } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';
import { formatMoney } from '@/lib/billing/plans';
import { repSchedule } from '@/lib/bills/due';
import { todayIn } from '@/lib/time';
import { createVendor, updateVendor } from '../bills/actions';
import { fmtDate } from '../bills/format';
import { Stat } from '../_dashboard/tiles';
import { ReadOnlyNotice } from '../read-only-notice';

export const metadata: Metadata = { title: 'Vendors' };

type Vendor = { id: string; name: string; contact_name: string | null; email: string | null; phone: string | null; payment_terms_days: number; pay_method: string | null; kind: string | null; notes: string | null; is_active: boolean };
type Bill = { vendor_id: string; bill_date: string; due_date: string; status: 'draft' | 'approved' | 'paid' | 'void'; total_cents: number; paid_cents: number; recurring_bill_id: string | null };
const PAY_METHODS: Record<string, string> = { check: 'Check', ach: 'ACH / bank transfer', card: 'Credit card', cash: 'Cash', other: 'Other' };
const SORTS = [['owed', 'Amount owed'], ['late', 'Overdue first'], ['next', 'Next due'], ['total', 'Total spend'], ['name', 'A–Z']] as const;
const WD = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function VendorFields({ v }: { v?: Vendor }) {
  const p = v?.id ?? 'new';
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Name" htmlFor={`${p}-name`}><Input id={`${p}-name`} name="name" defaultValue={v?.name} required maxLength={120} /></Field>
      <Field label="Contact person" htmlFor={`${p}-contact`}><Input id={`${p}-contact`} name="contact_name" defaultValue={v?.contact_name ?? ''} maxLength={120} /></Field>
      <Field label="Email" htmlFor={`${p}-email`}><Input id={`${p}-email`} name="email" type="email" defaultValue={v?.email ?? ''} /></Field>
      <Field label="Phone" htmlFor={`${p}-phone`}><Input id={`${p}-phone`} name="phone" defaultValue={v?.phone ?? ''} maxLength={40} /></Field>
      <Field label="Payment terms (days)" htmlFor={`${p}-terms`} hint="Used to suggest a due date on new bills.">
        <Input id={`${p}-terms`} name="payment_terms_days" type="number" min={0} max={365} defaultValue={v?.payment_terms_days ?? 30} required />
      </Field>
      <Field label="Usually paid by" htmlFor={`${p}-method`}>
        <Select id={`${p}-method`} name="pay_method" defaultValue={v?.pay_method ?? ''}>
          <option value="">Not set</option>{Object.entries(PAY_METHODS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </Select>
      </Field>
      <Field label="Put under" htmlFor={`${p}-kind`} hint="Where this vendor's bills go in the Due view.">
        <Select id={`${p}-kind`} name="kind" defaultValue={v?.kind ?? ''}>
          <option value="">Automatic (from the name)</option><option value="order">Orders (merchandise)</option><option value="bill">Bills (rent, utilities, services)</option>
        </Select>
      </Field>
      <div className="sm:col-span-2">
        <Field label="Notes" htmlFor={`${p}-notes`}><Textarea id={`${p}-notes`} name="notes" defaultValue={v?.notes ?? ''} maxLength={2000} className="min-h-20" /></Field>
      </div>
    </div>
  );
}

export default async function VendorsPage({ searchParams }: PageProps<'/app/vendors'>) {
  const ctx = await getOrgContext();
  if (!can(ctx, 'vendors.view')) return <Notice tone="warning">You don’t have access to vendors.</Notice>;
  const sp = await searchParams;
  const q = typeof sp.q === 'string' ? sp.q.trim().slice(0, 60) : '';
  const sort = SORTS.find(([k]) => k === sp.sort)?.[0] ?? 'owed';
  const showMoney = can(ctx, 'bills.view');
  const supabase = await getSupabase();
  const [{ data }, { data: billRows }, { data: orgRow }] = await Promise.all([
    supabase.from('vendors')
      .select('id, name, contact_name, email, phone, payment_terms_days, pay_method, kind, notes, is_active')
      .eq('organization_id', ctx.org.id).order('name'),
    showMoney
      ? supabase.from('bills').select('vendor_id, bill_date, due_date, status, total_cents, paid_cents, recurring_bill_id')
        .eq('organization_id', ctx.org.id).neq('status', 'void').order('bill_date', { ascending: false }).limit(10000)
      : Promise.resolve({ data: [] as Bill[] }),
    supabase.from('organizations').select('timezone').eq('id', ctx.org.id).maybeSingle(),
  ]);
  const vendors = (data ?? []) as Vendor[];
  const bills = (billRows ?? []) as Bill[];
  const today = todayIn(orgRow?.timezone);
  const editable = can(ctx, 'vendors.manage') && ctx.access.canWrite;

  // Per-vendor money: what's owed (approved, unpaid), past due, next due date, total spend.
  const stats = new Map<string, { owed: number; pastDue: number; next: string | null; total: number; count: number }>();
  for (const v of vendors) stats.set(v.id, { owed: 0, pastDue: 0, next: null, total: 0, count: 0 });
  for (const b of bills) {
    const s = stats.get(b.vendor_id); if (!s) continue;
    s.total += Number(b.total_cents); s.count++;
    const left = Number(b.total_cents) - Number(b.paid_cents);
    if (b.status === 'approved' && left > 0) {
      s.owed += left;
      if (b.due_date < today) s.pastDue += left;
      else if (!s.next || b.due_date < s.next) s.next = b.due_date;
    }
  }
  const names = new Map(vendors.map((v) => [v.id, v.name]));
  const reps = repSchedule(bills, names, today);
  const todayDow = new Date(`${today}T00:00:00Z`).getUTCDay();
  const repsToday = reps.filter((r) => r.days.includes(todayDow));
  const st = (v: Vendor) => stats.get(v.id)!;
  const sorters: Record<string, (a: Vendor, b: Vendor) => number> = {
    owed: (a, b) => st(b).owed - st(a).owed || a.name.localeCompare(b.name),
    late: (a, b) => st(b).pastDue - st(a).pastDue || st(b).owed - st(a).owed || a.name.localeCompare(b.name),
    next: (a, b) => (st(a).next ?? '9999').localeCompare(st(b).next ?? '9999') || a.name.localeCompare(b.name),
    total: (a, b) => st(b).total - st(a).total || a.name.localeCompare(b.name),
    name: (a, b) => a.name.localeCompare(b.name),
  };
  const rows = vendors.filter((v) => !q || v.name.toLowerCase().includes(q.toLowerCase())).sort(sorters[showMoney ? sort : 'name']);
  const sum = (k: 'owed' | 'pastDue' | 'total') => vendors.reduce((a, v) => a + st(v)[k], 0);
  const qs = (o: { q?: string; sort?: string }) => {
    const p = new URLSearchParams(); const qq = o.q ?? q, ss = o.sort ?? sort;
    if (qq) p.set('q', qq); if (ss !== 'owed') p.set('sort', ss);
    const s = p.toString(); return s ? `/app/vendors?${s}` : '/app/vendors';
  };

  return (
    <>
      <PageHeader title="Vendors" description="The suppliers you buy from. Vendors can be turned off but not deleted, so their bill history stays intact."
        actions={showMoney ? <a href="/app/vendors/calendar" download className="rounded-full bg-card px-3.5 py-2 text-sm font-semibold text-accent-strong shadow-[var(--shadow-card)]">Calendar (.ics)</a> : undefined} />
      <ReadOnlyNotice show={can(ctx, 'vendors.manage') && !ctx.access.canWrite} />
      {showMoney && vendors.length > 0 && (
        <div className="grid grid-cols-3 gap-2.5">
          <Stat block="blue" label="You owe" value={formatMoney(sum('owed'))} />
          <Stat block={sum('pastDue') > 0 ? 'coral' : undefined} label="Past due" value={formatMoney(sum('pastDue'))} />
          <Stat label="Total spend" value={formatMoney(sum('total'))} />
        </div>
      )}
      {showMoney && (
        <Link href="/app/bills/reps" className="flex items-center justify-between gap-2 rounded-[14px] bg-accent-soft px-4 py-3 text-[15px] font-semibold text-accent-strong">
          <span>{repsToday.length ? `Today (${WD[todayDow]}) usually: ${repsToday.slice(0, 3).map((r) => r.name).join(', ')}${repsToday.length > 3 ? '…' : ''}` : 'Rep schedule: which days each vendor comes'}</span><span aria-hidden>›</span>
        </Link>
      )}
      {vendors.length > 0 && (
        <div className="flex flex-col gap-2.5">
          <form action="/app/vendors" className="flex gap-2" role="search">
            {sort !== 'owed' && <input type="hidden" name="sort" value={sort} />}
            <label htmlFor="vq" className="sr-only">Search vendors</label>
            <Input id="vq" name="q" type="search" placeholder="Search vendors" defaultValue={q} autoComplete="off" className="flex-1" />
            <SubmitButton variant="secondary">Search</SubmitButton>
          </form>
          {showMoney && (
            <nav aria-label="Sort" className="flex flex-wrap gap-1.5">
              {SORTS.map(([k, l]) => (
                <Link key={k} href={qs({ sort: k })} aria-current={sort === k ? 'page' : undefined}
                  className={cx('rounded-full px-3 py-1.5 text-sm font-semibold', sort === k ? 'bg-accent text-white' : 'bg-card text-muted shadow-[var(--shadow-card)] hover:text-ink')}>{l}</Link>
              ))}
            </nav>
          )}
          <p className="text-sm text-muted">{rows.length} vendor{rows.length === 1 ? '' : 's'}{q && <> matching “{q}” · <Link href={qs({ q: '' })} className="font-semibold text-accent-strong">clear</Link></>}</p>
        </div>
      )}
      {vendors.length === 0 ? (
        <EmptyState title="No vendors yet">{editable ? 'Add your first supplier below.' : can(ctx, 'vendors.manage') ? null : 'An owner or admin can add vendors.'}</EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((v) => {
            const s = st(v);
            return (
            <li key={v.id}>
              <Card>
                <details>
                  <summary className="flex cursor-pointer list-none flex-col gap-1">
                    <span className="flex flex-wrap items-baseline justify-between gap-3">
                      <span className="font-bold">{v.name}</span>
                      {showMoney ? <span className={cx('num font-semibold', s.pastDue > 0 && 'text-late')}>{formatMoney(s.owed)}</span>
                        : v.is_active ? <Badge tone="good">Active</Badge> : <Badge>Turned off</Badge>}
                    </span>
                    <span className="flex flex-wrap gap-x-2 text-[13px] text-muted">
                      <span>Net {v.payment_terms_days}</span>
                      <span>· {v.pay_method ? PAY_METHODS[v.pay_method] : 'Payment method not set'}</span>
                      {showMoney && (s.pastDue > 0 ? <span className="font-semibold text-late">· {formatMoney(s.pastDue)} past due</span>
                        : s.next ? <span>· next due {fmtDate(s.next)}</span> : null)}
                      {showMoney && <span>· {formatMoney(s.total)} total spend ({s.count} bill{s.count === 1 ? '' : 's'})</span>}
                      {v.contact_name && <span>· {v.contact_name}</span>}
                      {showMoney && !v.is_active && <span>· Turned off</span>}
                    </span>
                  </summary>
                  {editable ? (
                    <ActionForm action={updateVendor} className="mt-4 flex flex-col gap-3">
                      <input type="hidden" name="id" value={v.id} />
                      <VendorFields v={v} />
                      <label className="flex items-center gap-2 text-[15px]">
                        <input type="hidden" name="is_active" value="false" />
                        <input type="checkbox" name="is_active" value="true" defaultChecked={v.is_active} className="size-4 accent-[#3f63de]" /> Active
                      </label>
                      <SubmitButton className="self-start" variant="secondary" pendingText="Saving…">Save vendor</SubmitButton>
                    </ActionForm>
                  ) : (
                    <p className="mt-3 text-muted">{[v.email, v.phone].filter(Boolean).join(' · ') || 'No contact details on file.'}</p>
                  )}
                </details>
              </Card>
            </li>
            );
          })}
        </ul>
      )}
      {editable && (
        <Card>
          <h2 className="mb-4 text-lg font-bold">Add a vendor</h2>
          <ActionForm action={createVendor} className="flex flex-col gap-4">
            <VendorFields />
            <SubmitButton className="self-start" pendingText="Adding…">Add vendor</SubmitButton>
          </ActionForm>
        </Card>
      )}
    </>
  );
}
