import type { Metadata } from 'next';
import Link from 'next/link';
import { can, getSupabase } from '@/lib/auth/context';
import { ActionForm } from '@/components/action-form';
import { Badge, Card, EmptyState, Field, Input, Notice, PageHeader, Select } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';
import { centsToInput } from '@/lib/money';
import { fmtDate } from '../../bills/format';
import { Stat } from '../../_dashboard/tiles';
import { ReadOnlyNotice } from '../../read-only-notice';
import { loadCommission, wsContext } from '../_data';
import { money, money0 } from '../_ui';
import { recordPayout, voidPayout } from '../actions';
import { getLocale, getT } from '@/lib/i18n/server';

export const metadata: Metadata = { title: 'Commissions' };
const METHODS: [string, string][] = [['check', 'Check'], ['ach', 'ACH / bank transfer'], ['zelle', 'Zelle'], ['cash', 'Cash'], ['payroll', 'With payroll'], ['other', 'Other']];

const monthEnd = (m: string) => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).toISOString().slice(0, 10);
const shift = (m: string, n: number) => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7) - 1 + n, 1)).toISOString().slice(0, 7);
const monthName = (m: string, locale: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString(locale === 'ar' ? 'ar-u-nu-latn' : 'en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** Commission by month: what each rep earned, what you paid them, what you still owe; record and void payouts. */
export default async function CommissionsPage({ searchParams }: PageProps<'/app/wholesale/commissions'>) {
  const t = await getT();
  const locale = await getLocale();
  const ctx = await wsContext();
  if (!can(ctx, 'commissions.view') && !can(ctx, 'commissions.manage')) return <Notice tone="warning">{t('You don’t have access to commissions.')}</Notice>;
  const sp = await searchParams;
  const thisMonth = ctx.today.slice(0, 7);
  const m = typeof sp.m === 'string' && /^\d{4}-\d{2}$/.test(sp.m) && sp.m <= thisMonth ? sp.m : thisMonth;
  const from = `${m}-01`, to = m === thisMonth ? ctx.today : monthEnd(m);
  const sb = await getSupabase();
  const [rows, { data: payouts }] = await Promise.all([
    loadCommission(ctx.org.id, from, to),
    sb.from('commission_payouts').select('id, rep_id, paid_on, amount_cents, method, reference, note, voided_at, void_reason').eq('organization_id', ctx.org.id).order('paid_on', { ascending: false }).limit(200),
  ]);
  const focus = typeof sp.rep === 'string' ? sp.rep : rows.length === 1 ? rows[0].rep_id : '';
  const lines = focus ? (await sb.rpc('rep_commission_lines', { p_org: ctx.org.id, p_rep: focus, p_from: from, p_to: to })).data ?? [] : [];
  const name = new Map(rows.map((r) => [r.rep_id, r.name]));
  const manage = can(ctx, 'commissions.manage') && ctx.access.canWrite;
  const owed = rows.reduce((s, r) => s + Math.max(r.balance_cents, 0), 0);
  const q = (mm: string) => `/app/wholesale/commissions?m=${mm}${focus ? `&rep=${focus}` : ''}`;

  return (
    <>
      <PageHeader title={t('Commissions')} description={t('What each rep earned, what you’ve paid them, and what you still owe. Earned amounts follow each rep’s terms on the Sales reps page.')} />
      <ReadOnlyNotice show={can(ctx, 'commissions.manage') && !ctx.access.canWrite} />
      <div className="flex items-center justify-between gap-2">
        <Link href={q(shift(m, -1))} className="rounded-full bg-card px-3 py-1.5 text-sm font-semibold shadow-[var(--shadow-card)]"><span className="rtl-flip inline-block">‹</span> {t('Earlier')}</Link>
        <p className="font-bold">{monthName(m, locale)}{m === thisMonth ? t(' (so far)') : ''}</p>
        {m < thisMonth ? <Link href={q(shift(m, 1))} className="rounded-full bg-card px-3 py-1.5 text-sm font-semibold shadow-[var(--shadow-card)]">{t('Later')} <span className="rtl-flip inline-block">›</span></Link> : <span className="w-16" />}
      </div>
      {rows.length > 0 && (
        <div className="grid grid-cols-3 gap-3 max-[520px]:grid-cols-1">
          <Stat block="blue" label={t('Earned this month')} value={money0(rows.reduce((s, r) => s + r.earned_cents, 0))} sub={t('on {v0} invoiced', { v0: money0(rows.reduce((s, r) => s + r.invoiced_sales_cents, 0)) })} />
          <Stat label={t('Paid this month')} value={money0(rows.reduce((s, r) => s + r.paid_out_cents, 0))} />
          <Stat block={owed ? 'coral' : undefined} label={t('Still owed to reps')} value={money0(owed)} sub={t('All earned to date, less all payouts')} />
        </div>
      )}
      {rows.length ? (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[600px] text-[15px]">
            <thead><tr className="border-b border-line text-start text-sm text-muted">
              <th className="px-4 py-2 text-start font-semibold">{t('Rep')}</th><th className="px-4 py-2 text-end font-semibold">{t('Invoiced sales')}</th><th className="px-4 py-2 text-end font-semibold">{t('Earned')}</th>
              <th className="px-4 py-2 text-end font-semibold">{t('Paid')}</th><th className="px-4 py-2 text-end font-semibold">{t('Owed to date')}</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.rep_id} className={r.rep_id === focus ? 'border-b border-soft bg-accent-soft' : 'border-b border-soft'}>
                  <td className="px-4 py-2"><Link href={`/app/wholesale/commissions?m=${m}&rep=${r.rep_id}`} className="font-semibold text-accent-strong">{r.name}</Link>
                    <span className="block text-xs text-muted">{t(r.basis === 'sales' ? '{n}% of sales' : '{n}% of profit', { n: r.rate_pct })} · {r.earn_on === 'invoiced' ? t('when invoiced') : t('as paid')}</span></td>
                  <td className="num px-4 py-2 text-end">{money(r.invoiced_sales_cents)}</td>
                  <td className="num px-4 py-2 text-end">{money(r.earned_cents)}</td>
                  <td className="num px-4 py-2 text-end">{money(r.paid_out_cents)}</td>
                  <td className={r.balance_cents > 0 ? 'num px-4 py-2 text-end font-bold' : 'num px-4 py-2 text-end'}>{money(r.balance_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : <EmptyState title={t('No sales reps yet')}>{t('Add reps on the Sales reps page; their commission shows here.')}</EmptyState>}

      {focus && name.has(focus) && (
        <Card>
          <h2 className="font-bold">{name.get(focus)}{t(': what earned commission in')} {monthName(m, locale)}</h2>
          {lines.length ? (
            <ul className="mt-2 flex flex-col divide-y divide-soft text-[15px]">
              {(lines as { invoice_id: string; number: string; customer: string; on_date: string; sales_cents: number; earned_cents: number }[]).map((l, i) => (
                <li key={`${l.invoice_id}-${i}`} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                  <span>{fmtDate(l.on_date)} · {can(ctx, 'wholesale.receivables.view') ? <Link href={`/app/wholesale/invoices/${l.invoice_id}`} className="text-accent-strong">{l.number}</Link> : l.number} · {l.customer}</span>
                  <span className="num">{money(Number(l.sales_cents))} → <strong>{money(Number(l.earned_cents))}</strong></span>
                </li>
              ))}
            </ul>
          ) : <p className="mt-1 text-sm text-muted">{t('Nothing earned this month.')}</p>}
        </Card>
      )}

      {manage && rows.length > 0 && (
        <Card>
          <h2 className="font-bold">{t('Record a payout')}</h2>
          <ActionForm action={recordPayout} className="mt-3 grid gap-3 sm:grid-cols-3">
            <Field label={t('Rep')} htmlFor="pr">
              <Select id="pr" name="rep_id" defaultValue={focus || rows[0].rep_id}>{rows.map((r) => <option key={r.rep_id} value={r.rep_id}>{r.name} {t('· owed')} {money(r.balance_cents)}</option>)}</Select>
            </Field>
            <Field label={t('Amount')} htmlFor="pa"><Input id="pa" name="amount" inputMode="decimal" className="num" required defaultValue={(() => { const r = rows.find((x) => x.rep_id === (focus || rows[0].rep_id)); return r && r.balance_cents > 0 ? centsToInput(r.balance_cents) : ''; })()} /></Field>
            <Field label={t('Paid on')} htmlFor="pd"><Input id="pd" name="paid_on" type="date" defaultValue={ctx.today} max={ctx.today} required /></Field>
            <Field label={t('How you paid')} htmlFor="pm"><Select id="pm" name="method" defaultValue="check">{METHODS.map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}</Select></Field>
            <Field label={t('Check # or reference (optional)')} htmlFor="pf"><Input id="pf" name="reference" maxLength={60} /></Field>
            <Field label={t('Note (optional)')} htmlFor="pn"><Input id="pn" name="note" maxLength={300} placeholder={t('{v0} commission', { v0: monthName(m, locale) })} /></Field>
            <div className="sm:col-span-3"><SubmitButton>{t('Save payout')}</SubmitButton></div>
          </ActionForm>
        </Card>
      )}

      {(payouts ?? []).length > 0 && (
        <Card>
          <h2 className="font-bold">{t('Payouts')}</h2>
          <ul className="mt-2 flex flex-col divide-y divide-soft text-[15px]">
            {(payouts ?? []).filter((p) => !focus || p.rep_id === focus).map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className={p.voided_at ? 'text-muted line-through' : ''}>{fmtDate(p.paid_on)} · {name.get(p.rep_id) ?? t('Rep')} · {t(METHODS.find(([k]) => k === p.method)?.[1] ?? 'Other')}{p.reference ? ` #${p.reference}` : ''}{p.note ? ` · ${p.note}` : ''}</span>
                <span className="flex items-center gap-2">
                  {p.voided_at ? <Badge>{t('Void')}{p.void_reason ? `: ${p.void_reason}` : ''}</Badge> : <span className="num font-semibold">{money(Number(p.amount_cents))}</span>}
                  {manage && !p.voided_at && (
                    <details>
                      <summary className="cursor-pointer text-xs font-semibold text-muted">{t('Void')}</summary>
                      <ActionForm action={voidPayout} className="mt-1 flex items-end gap-1"><input type="hidden" name="id" value={p.id} /><Input name="reason" aria-label={t('Why')} placeholder={t('Why?')} maxLength={200} required className="w-32" /><SubmitButton size="sm" variant="danger">{t('Void')}</SubmitButton></ActionForm>
                    </details>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <p className="text-sm text-muted">{t('Payouts are a record of what you paid; they don’t move money or post to the books. A change to a rep’s terms applies to sales invoiced from that day on; earlier sales keep the terms they were made under.')}</p>
    </>
  );
}
