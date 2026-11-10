import type { Metadata } from 'next';
import Link from 'next/link';
import { can, getOrgContext, getSupabase } from '@/lib/auth/context';
import { ActionForm } from '@/components/action-form';
import { SubmitButton } from '@/components/submit-button';
import { Badge, Block, Card, EmptyState, Eyebrow, Field, Input, Notice, PageHeader, Select, cx } from '@/components/ui';
import { formatMoney } from '@/lib/billing/plans';
import { ReadOnlyNotice } from '../../read-only-notice';
import { fmtDate } from '../format';
import { discardInvoice, reviewInvoice } from './actions';
import { InvoiceUploader } from './uploader';

export const metadata: Metadata = { title: 'Invoices' };

type Inv = {
  id: string; location_id: string | null; vendor_id: string | null; bill_id: string | null; storage_path: string; file_name: string;
  mime_type: string; status: 'needs_review' | 'reviewed'; invoice_number: string | null; invoice_date: string | null;
  amount_cents: number | null; note: string | null; created_at: string;
};
const monthOf = (i: Inv) => (i.invoice_date ?? i.created_at.slice(0, 10)).slice(0, 7);
const ymLabel = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' });

/** #105: vendor invoices in a private bucket, listed by month, with search and Needs review. */
export default async function InvoicesPage({ searchParams }: PageProps<'/app/bills/invoices'>) {
  const ctx = await getOrgContext();
  if (!can(ctx, 'invoices.view')) return <Notice tone="warning">You don’t have access to invoices.</Notice>;
  const sp = await searchParams;
  const q = typeof sp.q === 'string' ? sp.q.trim().slice(0, 60) : '';
  const view = sp.view === 'review' ? 'review' : 'all';
  const month = typeof sp.m === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.m) ? sp.m : 'all';
  const supabase = await getSupabase();
  const [{ data: rows }, { data: monthRows }, { count: needs }, { data: vendors }, { data: locs }, { data: bills }] = await Promise.all([
    // Filtered in the database so every invoice is reachable (#142).
    supabase.rpc('list_invoices', { p_org: ctx.org.id, p_month: month === 'all' ? null : month, p_q: q || null, p_needs_review: view === 'review', p_limit: 201 }),
    supabase.rpc('invoice_months', { p_org: ctx.org.id }),
    supabase.from('invoice_files').select('id', { count: 'exact', head: true }).eq('organization_id', ctx.org.id).eq('status', 'needs_review'),
    supabase.from('vendors').select('id, name').eq('organization_id', ctx.org.id).order('name'),
    supabase.rpc('my_locations', { p_org: ctx.org.id }),
    can(ctx, 'bills.view')
      ? supabase.from('bills').select('id, vendor_id, bill_number, total_cents, bill_date').eq('organization_id', ctx.org.id).neq('status', 'void')
        .order('bill_date', { ascending: false }).limit(300)
      : Promise.resolve({ data: [] as { id: string; vendor_id: string; bill_number: string; total_cents: number; bill_date: string }[] }),
  ]);
  const list = (rows ?? []) as Inv[];
  const monthList = (monthRows ?? []) as { month: string; invoices: number }[];
  const total = monthList.reduce((a, m) => a + m.invoices, 0);
  const vendorName = new Map((vendors ?? []).map((v) => [v.id, v.name]));
  const stores = ((locs ?? []) as { id: string; name: string }[]);
  const storeName = new Map(stores.map((s) => [s.id, s.name]));
  const months = monthList.map((m) => m.month);
  const shown = list.slice(0, 200);
  // Short-lived links: Storage only signs files this user may read (invoices.view + store access).
  const { data: signed } = shown.length
    ? await supabase.storage.from('invoices').createSignedUrls(shown.map((i) => i.storage_path), 600)
    : { data: [] as { path: string | null; signedUrl: string }[] };
  const urlFor = new Map((signed ?? []).filter((s) => s.path).map((s) => [s.path as string, s.signedUrl]));
  const groups = new Map<string, Inv[]>();
  for (const i of shown) groups.set(monthOf(i), [...(groups.get(monthOf(i)) ?? []), i]);
  const editable = can(ctx, 'invoices.upload') && ctx.access.canWrite;
  const qs = (o: { view?: string; m?: string; q?: string }) => {
    const p = new URLSearchParams(); const v = o.view ?? view, m = o.m ?? month, qq = o.q ?? q;
    if (v !== 'all') p.set('view', v); if (m !== 'all') p.set('m', m); if (qq) p.set('q', qq);
    const s = p.toString(); return s ? `/app/bills/invoices?${s}` : '/app/bills/invoices';
  };

  return (
    <>
      <PageHeader title="Invoices" description="Photos and PDFs of your vendor invoices, kept private to your business. Upload them, then fill in the vendor, number and amount." />
      <ReadOnlyNotice show={can(ctx, 'invoices.upload') && !ctx.access.canWrite} />
      <div className="grid grid-cols-2 gap-2.5">
        <Link href={qs({ view: 'review' })} className="hover:opacity-90">
          <Block tone={needs ? 'coral' : 'blue'} className="flex flex-col gap-1">
            <span className="text-[11px] font-bold uppercase tracking-[.08em]">Needs review</span>
            <span className="num text-[28px] font-medium leading-none">{needs ?? 0}</span>
          </Block>
        </Link>
        <Card className="flex flex-col gap-1">
          <Eyebrow>All invoices</Eyebrow>
          <span className="num text-[28px] font-medium leading-none">{total}</span>
        </Card>
      </div>
      {editable && <Card><InvoiceUploader stores={stores} /></Card>}

      <div className="flex flex-col gap-2.5">
        <nav aria-label="Show" className="flex gap-1 self-start rounded-full bg-soft p-1">
          {(['all', 'review'] as const).map((v) => (
            <Link key={v} href={qs({ view: v })} aria-current={view === v ? 'page' : undefined}
              className={cx('rounded-full px-3.5 py-1.5 text-sm font-semibold', view === v ? 'bg-card text-ink shadow-[var(--shadow-card)]' : 'text-muted hover:text-ink')}>
              {v === 'all' ? 'All' : `Needs review${needs ? ` (${needs})` : ''}`}
            </Link>
          ))}
        </nav>
        <form action="/app/bills/invoices" role="search" className="flex flex-wrap gap-2">
          {view !== 'all' && <input type="hidden" name="view" value={view} />}
          <label htmlFor="inv-q" className="sr-only">Search invoices</label>
          <Input id="inv-q" name="q" type="search" placeholder="Vendor, invoice # or file name" defaultValue={q} className="min-w-0 flex-1" />
          <label htmlFor="inv-m" className="sr-only">Month</label>
          <Select id="inv-m" name="m" defaultValue={month} className="w-auto">
            <option value="all">All months</option>{months.map((m) => <option key={m} value={m}>{ymLabel(m)}</option>)}
          </Select>
          <SubmitButton variant="secondary">Search</SubmitButton>
        </form>
      </div>

      {total === 0 ? (
        <EmptyState title="No invoices yet">{editable ? 'Upload photos or PDFs of your vendor invoices above.' : 'Someone with upload rights can add invoices.'}</EmptyState>
      ) : list.length === 0 ? (
        <EmptyState title="Nothing matches">Try another month or search. <Link href="/app/bills/invoices" className="font-semibold text-accent-strong">Show all</Link></EmptyState>
      ) : (
        [...groups.entries()].map(([m, items]) => (
          <section key={m} className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-2">
              <Eyebrow>{ymLabel(m)}</Eyebrow>
              <span className="num text-[13px] text-muted">{items.length} invoice{items.length === 1 ? '' : 's'} · {formatMoney(items.reduce((a, i) => a + Number(i.amount_cents ?? 0), 0))}</span>
            </div>
            <ul className="flex flex-col gap-2">
              {items.map((i) => {
                const url = urlFor.get(i.storage_path);
                const vendorBills = (bills ?? []).filter((b) => !i.vendor_id || b.vendor_id === i.vendor_id).slice(0, 60);
                return (
                  <li key={i.id}>
                    <Card className="flex flex-col gap-2 py-3">
                      <div className="flex items-start gap-3">
                        {url && i.mime_type.startsWith('image/') && i.mime_type !== 'image/heic'
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={url} alt="" className="size-14 shrink-0 rounded-lg bg-soft object-cover" />
                          : <span className="grid size-14 shrink-0 place-items-center rounded-lg bg-soft text-xs font-bold text-muted">{i.mime_type === 'application/pdf' ? 'PDF' : 'IMG'}</span>}
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="flex items-baseline justify-between gap-2">
                            <span className="truncate font-semibold">{i.vendor_id ? vendorName.get(i.vendor_id) : i.file_name}</span>
                            <span className="num shrink-0 font-semibold">{i.amount_cents ? formatMoney(Number(i.amount_cents)) : ''}</span>
                          </span>
                          <span className="flex flex-wrap gap-x-2 text-[13px] text-muted">
                            {i.status === 'needs_review' ? <Badge tone="warning">Needs review</Badge> : <Badge tone="good">Reviewed</Badge>}
                            {i.invoice_number && <span>#{i.invoice_number}</span>}
                            <span>{i.invoice_date ? `Dated ${fmtDate(i.invoice_date)}` : `Uploaded ${fmtDate(i.created_at.slice(0, 10))}`}</span>
                            {stores.length > 1 && <span>· {i.location_id ? storeName.get(i.location_id) ?? 'Store' : 'Whole business'}</span>}
                            {i.bill_id && <Link href={`/app/bills/${i.bill_id}`} className="font-semibold text-accent-strong">· Bill</Link>}
                          </span>
                        </div>
                        {url && <a href={url} target="_blank" rel="noopener noreferrer" className="shrink-0 rounded-full bg-soft px-3 py-1.5 text-sm font-semibold text-accent-strong">Open</a>}
                      </div>
                      {editable && (
                        <details open={i.status === 'needs_review' && view === 'review'}>
                          <summary className="cursor-pointer text-sm font-semibold text-accent-strong">{i.status === 'needs_review' ? 'Review' : 'Edit details'}</summary>
                          <ActionForm action={reviewInvoice} className="mt-3 grid gap-3 sm:grid-cols-2">
                            <input type="hidden" name="id" value={i.id} />
                            <Field label="Vendor" htmlFor={`v-${i.id}`}>
                              <Select id={`v-${i.id}`} name="vendor_id" defaultValue={i.vendor_id ?? ''}><option value="">Choose…</option>{(vendors ?? []).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</Select>
                            </Field>
                            <Field label="Invoice #" htmlFor={`n-${i.id}`}><Input id={`n-${i.id}`} name="invoice_number" maxLength={60} defaultValue={i.invoice_number ?? ''} /></Field>
                            <Field label="Invoice date" htmlFor={`d-${i.id}`}><Input id={`d-${i.id}`} name="invoice_date" type="date" defaultValue={i.invoice_date ?? ''} /></Field>
                            <Field label="Amount" htmlFor={`a-${i.id}`}><Input id={`a-${i.id}`} name="amount" inputMode="decimal" className="num" defaultValue={i.amount_cents ? (Number(i.amount_cents) / 100).toFixed(2) : ''} /></Field>
                            {can(ctx, 'bills.view') && (
                              <Field label="Bill (optional)" htmlFor={`b-${i.id}`} hint="Link the bill you entered for this invoice.">
                                <Select id={`b-${i.id}`} name="bill_id" defaultValue={i.bill_id ?? ''}><option value="">None</option>
                                  {vendorBills.map((b) => <option key={b.id} value={b.id}>{vendorName.get(b.vendor_id)} #{b.bill_number} · {formatMoney(Number(b.total_cents))}</option>)}
                                </Select>
                              </Field>
                            )}
                            <Field label="Note" htmlFor={`o-${i.id}`}><Input id={`o-${i.id}`} name="note" maxLength={500} defaultValue={i.note ?? ''} /></Field>
                            <div className="flex flex-wrap gap-2 sm:col-span-2">
                              <SubmitButton name="reviewed" value="true" pendingText="Saving…">Save and mark reviewed</SubmitButton>
                              <SubmitButton name="reviewed" value="false" variant="secondary" pendingText="Saving…">Save for later</SubmitButton>
                            </div>
                          </ActionForm>
                          {!i.bill_id && (
                            <ActionForm action={discardInvoice} className="mt-2">
                              <input type="hidden" name="id" value={i.id} />
                              <SubmitButton variant="ghost" size="sm" pendingText="Removing…">Not an invoice: remove from the list</SubmitButton>
                            </ActionForm>
                          )}
                        </details>
                      )}
                    </Card>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
      {list.length > shown.length && <p className="text-sm text-muted">Showing the newest 200 that match. Pick a month or search to narrow it down.</p>}
    </>
  );
}
