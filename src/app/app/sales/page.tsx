import type { Metadata } from 'next';
import { can, getOrgContext, getSupabase } from '@/lib/auth/context';
import { ActionForm } from '@/components/action-form';
import { Badge, Card, EmptyState, Field, Input, LinkButton, Notice, PageHeader } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';
import { formatMoney } from '@/lib/billing/plans';
import { fmtDate } from '../bills/format';
import { voidSalesDay } from './actions';
import { ReadOnlyNotice } from '../read-only-notice';

export const metadata: Metadata = { title: 'Sales' };

const SOURCE: Record<string, string> = { manual: 'Entered', csv: 'Imported', vela: 'Vela POS' };

export default async function SalesPage({ searchParams }: PageProps<'/app/sales'>) {
  const ctx = await getOrgContext();
  if (!can(ctx, 'sales.view')) return <Notice tone="warning">You don’t have access to sales.</Notice>;
  const sp = await searchParams;
  const ok = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : null);
  // Date-range lookup (#103): any period, up to 1,000 rows; without a range, the latest 120.
  let from = ok(sp.from), to = ok(sp.to);
  if (from && to && from > to) [from, to] = [to, from];
  const supabase = await getSupabase();
  let q = supabase.from('sales_days')
    .select('id, location_id, register, business_date, gross_sales_cents, discounts_cents, sales_tax_cents, cash_cents, card_cents, customer_credit_cents, source, voided_at, void_reason')
    .eq('organization_id', ctx.org.id);
  if (from) q = q.gte('business_date', from);
  if (to) q = q.lte('business_date', to);
  const limit = from || to ? 1000 : 120;
  const [{ data }, { data: locs }] = await Promise.all([
    q.order('business_date', { ascending: false }).order('register').limit(limit + 1),
    supabase.from('locations').select('id, name').eq('organization_id', ctx.org.id),
  ]);
  const more = (data ?? []).length > limit;
  const days = (data ?? []).slice(0, limit);
  const live = days.filter((d) => !d.voided_at);
  const rangeNet = live.reduce((a, r) => a + Number(r.gross_sales_cents) - Number(r.discounts_cents), 0);
  const locName = new Map((locs ?? []).map((l) => [l.id, l.name]));
  const canAdd = can(ctx, 'sales.import') && ctx.access.canWrite;
  const canVoid = can(ctx, 'sales.edit') && ctx.access.canWrite;
  const byDate = new Map<string, typeof days>();
  for (const d of days) byDate.set(d.business_date, [...(byDate.get(d.business_date) ?? []), d]);

  return (
    <>
      <PageHeader title="Sales" description="End-of-day totals by register. Net sales exclude sales tax."
        actions={canAdd ? <LinkButton href="/app/sales/import">Add sales</LinkButton> : undefined} />
      <ReadOnlyNotice show={can(ctx, 'sales.import') && !ctx.access.canWrite} />
      <form action="/app/sales" className="flex flex-wrap items-end gap-2" role="search" aria-label="Look up a date range">
        <Field label="From" htmlFor="s-from"><Input id="s-from" name="from" type="date" defaultValue={from ?? ''} /></Field>
        <Field label="To" htmlFor="s-to"><Input id="s-to" name="to" type="date" defaultValue={to ?? ''} /></Field>
        <SubmitButton variant="secondary">Look up</SubmitButton>
        {(from || to) && <LinkButton href="/app/sales" variant="ghost">Latest days</LinkButton>}
      </form>
      {(from || to) && days.length > 0 && (
        <p className="rounded-[14px] bg-card px-4 py-3 text-[15px] shadow-[var(--shadow-card)]">
          {from ? fmtDate(from) : 'Start'} – {to ? fmtDate(to) : 'today'}: <b className="num">{formatMoney(rangeNet)}</b> net sales on {new Set(live.map((d) => d.business_date)).size} days{more && ' (first 1,000 rows; narrow the range for the rest)'}
        </p>
      )}
      {days.length === 0 ? (
        <EmptyState title={from || to ? 'No sales in that range' : 'No sales recorded yet'}>{canAdd ? 'Import your POS daily report or enter a day by hand.' : null}</EmptyState>
      ) : [...byDate.entries()].map(([date, rows]) => {
        const live = rows.filter((r) => !r.voided_at);
        const net = live.reduce((a, r) => a + Number(r.gross_sales_cents) - Number(r.discounts_cents), 0);
        return (
          <Card key={date} className="p-0">
            <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4">
              <h2 className="font-bold">{fmtDate(date)}</h2>
              <p className="text-sm text-muted">Net sales <span className="num ml-1 font-semibold text-ink">{formatMoney(net)}</span></p>
            </div>
            <ul className="mt-2 divide-y divide-line">
              {rows.map((r) => (
                <li key={r.id} className="px-5 py-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className={r.voided_at ? 'text-muted line-through' : ''}>{locName.get(r.location_id) ?? 'Store'} · {r.register}</span>
                    <span className="flex flex-wrap items-center gap-2 text-sm">
                      <Badge>{SOURCE[r.source] ?? r.source}</Badge>
                      {r.voided_at && <Badge tone="warning">Void</Badge>}
                      <span className="text-muted">tax {formatMoney(Number(r.sales_tax_cents))} · cash {formatMoney(Number(r.cash_cents))} · card {formatMoney(Number(r.card_cents))}</span>
                      <span className="num font-semibold">{formatMoney(Number(r.gross_sales_cents) - Number(r.discounts_cents))}</span>
                    </span>
                  </div>
                  {r.voided_at && r.void_reason && <p className="mt-1 text-sm text-muted">Voided: {r.void_reason}</p>}
                  {!r.voided_at && canVoid && (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-sm font-semibold text-late">Void to correct</summary>
                      <ActionForm action={voidSalesDay} className="mt-2 flex flex-wrap items-end gap-2">
                        <input type="hidden" name="id" value={r.id} />
                        <Field label="Reason" htmlFor={`reason-${r.id}`}><Input id={`reason-${r.id}`} name="reason" required minLength={3} maxLength={500} className="w-72" /></Field>
                        <SubmitButton size="sm" variant="danger" pendingText="Voiding…">Void day</SubmitButton>
                      </ActionForm>
                    </details>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        );
      })}
    </>
  );
}
