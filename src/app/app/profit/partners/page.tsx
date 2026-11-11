import type { Metadata } from 'next';
import { can, getOrgContext, getSupabase } from '@/lib/auth/context';
import { ActionForm } from '@/components/action-form';
import { Badge, Card, EmptyState, Eyebrow, Field, Input, Notice, Select } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';
import { formatMoney } from '@/lib/billing/plans';
import { todayIn } from '@/lib/time';
import { fmtDate } from '../../bills/format';
import { ReadOnlyNotice } from '../../read-only-notice';
import { Stat } from '../../_dashboard/tiles';
import { ProfitTabs } from '../tabs';
import { addDistribution, payShare, removeDistributionItem, savePartners } from '../actions';

export const metadata: Metadata = { title: 'Partners' };
const METHOD = { check: 'Check', ach: 'Bank transfer (ACH)', cash: 'Cash', zelle: 'Zelle', other: 'Other' } as const;
const mon = (d: string) => new Date(`${d.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' });
type Partner = { id: string; name: string; pct: number; is_active: boolean; sort: number };
type Dist = { id: string; month: string; dist_date: string; total_cents: number; note: string | null };
type Share = { id: string; distribution_id: string; partner_id: string; pct: number; share_cents: number };
type Pay = { id: string; share_id: string; paid_on: string; amount_cents: number; method: keyof typeof METHOD; reference: string | null };

/** #104 Partners: split %, distributions ledger (this year and all time), paying each partner. */
export default async function PartnersPage() {
  const ctx = await getOrgContext();
  if (!can(ctx, 'profit.view')) return <Notice tone="warning">You don’t have access to profit.</Notice>;
  const supabase = await getSupabase();
  const [{ data: tz }, { data: seesAll }, { data: ps }, { data: ds }, { data: ss }, { data: pays }] = await Promise.all([
    supabase.from('organizations').select('timezone').eq('id', ctx.org.id).maybeSingle(),
    supabase.rpc('sees_all_stores', { p_org: ctx.org.id }),
    supabase.from('partners').select('id, name, pct, is_active, sort').eq('organization_id', ctx.org.id).order('sort'),
    supabase.from('distributions').select('id, month, dist_date, total_cents, note').eq('organization_id', ctx.org.id).order('dist_date', { ascending: false }).limit(1000),
    supabase.from('distribution_shares').select('id, distribution_id, partner_id, pct, share_cents').eq('organization_id', ctx.org.id).limit(1000),
    supabase.from('distribution_payments').select('id, share_id, paid_on, amount_cents, method, reference').eq('organization_id', ctx.org.id).order('paid_on').limit(1000),
  ]);
  if (seesAll !== true) return <><ProfitTabs active="/app/profit/partners" /><Notice tone="warning">Partner figures are business-wide, so only people who see every store can open them.</Notice></>;
  const today = todayIn(tz?.timezone), year = today.slice(0, 4);
  const partners = ((ps ?? []) as Partner[]).map((p) => ({ ...p, pct: Number(p.pct) }));
  const dists = ((ds ?? []) as Dist[]).map((d) => ({ ...d, total_cents: Number(d.total_cents) }));
  const shares = ((ss ?? []) as Share[]).map((s) => ({ ...s, share_cents: Number(s.share_cents), pct: Number(s.pct) }));
  const payments = ((pays ?? []) as Pay[]).map((p) => ({ ...p, amount_cents: Number(p.amount_cents) }));
  const paidBy = new Map<string, number>();
  for (const p of payments) paidBy.set(p.share_id, (paidBy.get(p.share_id) ?? 0) + p.amount_cents);
  const name = new Map(partners.map((p) => [p.id, p.name]));
  const distYear = new Map(dists.map((d) => [d.id, d.dist_date.slice(0, 4)]));
  const totals = partners.map((p) => {
    const mine = shares.filter((s) => s.partner_id === p.id);
    const ytd = mine.filter((s) => distYear.get(s.distribution_id) === year);
    const t = (xs: Share[]) => ({ share: xs.reduce((a, s) => a + s.share_cents, 0), paid: xs.reduce((a, s) => a + (paidBy.get(s.id) ?? 0), 0) });
    return { ...p, ytd: t(ytd), all: t(mine) };
  });
  const manage = can(ctx, 'org.manage') && ctx.access.canWrite;
  const activeTotal = partners.filter((p) => p.is_active).reduce((a, p) => a + p.pct, 0);
  const ytdTotal = dists.filter((d) => d.dist_date.startsWith(year)).reduce((a, d) => a + d.total_cents, 0);
  const rows = [...partners, ...Array.from({ length: 3 }, () => null)];

  return (
    <>
      <h1 className="text-[26px] font-extrabold tracking-[-.02em]">Partners</h1>
      <ProfitTabs active="/app/profit/partners" />
      <ReadOnlyNotice show={can(ctx, 'org.manage') && !ctx.access.canWrite} />
      <div className="grid grid-cols-2 gap-3">
        <Stat block="sunset" label={`Distributed in ${year}`} value={formatMoney(ytdTotal)} sub={`${dists.filter((d) => d.dist_date.startsWith(year)).length} distributions`} />
        <Stat label="All time" value={formatMoney(dists.reduce((a, d) => a + d.total_cents, 0))} sub={`${dists.length} distributions`} />
      </div>

      {totals.length > 0 && (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[560px] text-[14.5px]">
            <thead className="text-start text-xs uppercase tracking-[.06em] text-muted"><tr><th className="px-4 py-2.5">Partner</th><th className="px-2 text-end">Share</th><th className="px-2 text-end">{year} share</th><th className="px-2 text-end">{year} paid</th><th className="px-4 text-end">All time paid</th></tr></thead>
            <tbody>
              {totals.map((p) => (
                <tr key={p.id} className="border-t border-line">
                  <td className="px-4 py-2 font-semibold">{p.name} {!p.is_active && <Badge>Inactive</Badge>}</td>
                  <td className="num px-2 text-end">{p.pct.toFixed(2)}%</td>
                  <td className="num px-2 text-end">{formatMoney(p.ytd.share)}</td>
                  <td className="num px-2 text-end">{formatMoney(p.ytd.paid)}{p.ytd.share > p.ytd.paid ? <span className="block text-xs text-late">{formatMoney(p.ytd.share - p.ytd.paid)} left</span> : null}</td>
                  <td className="num px-4 text-end">{formatMoney(p.all.paid)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {manage && (
        <Card>
          <h2 className="text-lg font-bold">Partners and shares</h2>
          <p className="mt-1 text-sm text-muted">Active partners must add up to 100%{partners.length ? ` (now ${activeTotal.toFixed(2)}%)` : ''}. Leave a name blank to remove that partner; anyone already paid stays on record as inactive.</p>
          <ActionForm action={savePartners} className="mt-3 flex flex-col gap-2">
            {rows.map((p, i) => (
              <div key={p?.id ?? `new-${i}`} className="grid grid-cols-[1fr_7rem_auto] items-end gap-2">
                <input type="hidden" name={`id-${i}`} value={p?.id ?? ''} />
                <Field label={i === 0 ? 'Name' : ''} htmlFor={`pn-${i}`}><Input id={`pn-${i}`} name={`name-${i}`} defaultValue={p?.name ?? ''} maxLength={80} aria-label={`Partner ${i + 1} name`} /></Field>
                <Field label={i === 0 ? 'Share %' : ''} htmlFor={`pp-${i}`}><Input id={`pp-${i}`} name={`pct-${i}`} inputMode="decimal" className="num" defaultValue={p ? p.pct.toFixed(2) : ''} aria-label={`Partner ${i + 1} share percent`} /></Field>
                <label className="flex items-center gap-1.5 pb-2.5 text-sm"><input type="checkbox" name={`active-${i}`} defaultChecked={p ? p.is_active : true} className="size-4 accent-[#3f63de]" />Active</label>
              </div>
            ))}
            <div><SubmitButton>Save partners</SubmitButton></div>
          </ActionForm>
        </Card>
      )}

      {manage && partners.some((p) => p.is_active) && (
        <Card>
          <h2 className="text-lg font-bold">Record a distribution</h2>
          <p className="mt-1 text-sm text-muted">Split among active partners: {partners.filter((p) => p.is_active).map((p) => `${p.name} ${p.pct.toFixed(2)}%`).join(', ')}. Leftover cents go to the biggest share.</p>
          <ActionForm action={addDistribution} className="mt-3 grid gap-3 sm:grid-cols-4">
            <Field label="For month" htmlFor="d-month"><Input id="d-month" name="month" type="month" defaultValue={today.slice(0, 7)} max={today.slice(0, 7)} required /></Field>
            <Field label="Date" htmlFor="d-date"><Input id="d-date" name="dist_date" type="date" defaultValue={today} required /></Field>
            <Field label="Total" htmlFor="d-total"><Input id="d-total" name="total" inputMode="decimal" className="num" required placeholder="10000.00" /></Field>
            <Field label="Note (optional)" htmlFor="d-note"><Input id="d-note" name="note" maxLength={300} /></Field>
            <div className="sm:col-span-4"><SubmitButton>Record and split</SubmitButton></div>
          </ActionForm>
        </Card>
      )}

      <Eyebrow>Distributions</Eyebrow>
      {dists.length === 0 ? <EmptyState title="No distributions yet">{manage ? 'Set up partners, then record what you take out.' : null}</EmptyState> : (
        <ul className="flex flex-col gap-3">
          {dists.map((d) => {
            const mine = shares.filter((s) => s.distribution_id === d.id).sort((a, b) => b.pct - a.pct);
            const anyPaid = mine.some((s) => paidBy.get(s.id));
            return (
              <li key={d.id}>
                <Card className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-bold">{mon(d.month)} <span className="font-normal text-muted">· {fmtDate(d.dist_date)}{d.note ? ` · ${d.note}` : ''}</span></p>
                    <p className="num text-[20px] font-medium">{formatMoney(d.total_cents)}</p>
                  </div>
                  <ul className="flex flex-col divide-y divide-line text-[14.5px]">
                    {mine.map((s) => {
                      const paid = paidBy.get(s.id) ?? 0, left = s.share_cents - paid;
                      return (
                        <li key={s.id} className="flex flex-col gap-1 py-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span>{name.get(s.partner_id) ?? 'Partner'} <span className="text-muted">{s.pct.toFixed(2)}%</span></span>
                            <span className="num">{formatMoney(s.share_cents)} {left === 0 ? <Badge tone="good">Paid</Badge> : <span className="text-sm text-muted">{formatMoney(left)} left</span>}</span>
                          </div>
                          {payments.filter((p) => p.share_id === s.id).map((p) => (
                            <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 ps-3 text-sm text-muted">
                              <span>{fmtDate(p.paid_on)} · {METHOD[p.method] ?? p.method}{p.reference ? ` #${p.reference}` : ''}</span>
                              <span className="flex items-center gap-2"><span className="num">{formatMoney(p.amount_cents)}</span>
                                {manage && <ActionForm action={removeDistributionItem} className="contents"><input type="hidden" name="kind" value="payment" /><input type="hidden" name="id" value={p.id} /><SubmitButton variant="ghost" size="sm" aria-label={`Remove the ${formatMoney(p.amount_cents)} payment`}>Remove</SubmitButton></ActionForm>}
                              </span>
                            </div>
                          ))}
                          {manage && left > 0 && (
                            <details>
                              <summary className="cursor-pointer text-sm font-semibold text-accent-strong">Pay {name.get(s.partner_id) ?? 'partner'}</summary>
                              <ActionForm action={payShare} className="mt-2 grid gap-2 sm:grid-cols-4">
                                <input type="hidden" name="share_id" value={s.id} />
                                <Field label="Amount" htmlFor={`sp-${s.id}-a`}><Input id={`sp-${s.id}-a`} name="amount" inputMode="decimal" className="num" defaultValue={(left / 100).toFixed(2)} required /></Field>
                                <Field label="Date" htmlFor={`sp-${s.id}-d`}><Input id={`sp-${s.id}-d`} name="paid_on" type="date" defaultValue={today} max={today} required /></Field>
                                <Field label="How" htmlFor={`sp-${s.id}-m`}><Select id={`sp-${s.id}-m`} name="method" defaultValue="check">{Object.entries(METHOD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
                                <Field label="Check # (optional)" htmlFor={`sp-${s.id}-r`}><Input id={`sp-${s.id}-r`} name="reference" maxLength={100} /></Field>
                                <div className="sm:col-span-4"><SubmitButton size="sm">Save payment</SubmitButton></div>
                              </ActionForm>
                            </details>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  {manage && !anyPaid && (
                    <ActionForm action={removeDistributionItem}><input type="hidden" name="kind" value="distribution" /><input type="hidden" name="id" value={d.id} /><SubmitButton variant="ghost" size="sm">Remove this distribution</SubmitButton></ActionForm>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
