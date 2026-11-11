import type { Metadata } from 'next';
import Link from 'next/link';
import { can, getOrgContext, getSupabase } from '@/lib/auth/context';
import { Badge, Card, EmptyState, Eyebrow, Notice, PageHeader } from '@/components/ui';
import { formatMoney } from '@/lib/billing/plans';
import { todayIn } from '@/lib/time';
import { matchCardDeposits } from '@/lib/bank/checks';
import { fmtDate } from '../../bills/format';
import { Stat } from '../../_dashboard/tiles';
import { BankTabs } from '../tabs';
import { bankLines, pageAll } from '../_load';

export const metadata: Metadata = { title: 'Card deposits' };
const ymAdd = (ym: string, n: number) => new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 1 + n, 1)).toISOString().slice(0, 7);
const label = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' });
const lastDay = (ym: string) => `${ym}-${new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).getUTCDate()}`;
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** #109 Card sales vs card deposits: every day's card sales should arrive in the bank 1–5 days later, less fees. */
export default async function CardDepositsPage({ searchParams }: PageProps<'/app/bank/card-deposits'>) {
  const ctx = await getOrgContext();
  if (!can(ctx, 'bank.view') || !can(ctx, 'sales.view')) return <Notice tone="warning">This check needs access to the bank and sales.</Notice>;
  const sp = await searchParams;
  const sb = await getSupabase();
  const [{ data: tz }, { data: seesAll }] = await Promise.all([
    sb.from('organizations').select('timezone').eq('id', ctx.org.id).maybeSingle(),
    sb.rpc('sees_all_stores', { p_org: ctx.org.id }),
  ]);
  const today = todayIn(tz?.timezone);
  const ym = typeof sp.m === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.m) && sp.m <= today.slice(0, 7) ? sp.m : today.slice(0, 7);
  // Card days of the month (plus 3 days before it), deposits through 8 days after it.
  const from = addDays(`${ym}-01`, -3), to = lastDay(ym), depTo = addDays(to, 8) < today ? addDays(to, 8) : today;
  const [sales, lines] = await Promise.all([
    pageAll<{ business_date: string; card_cents: number }>((a, b) => sb.from('sales_days').select('business_date, card_cents').eq('organization_id', ctx.org.id).is('voided_at', null)
      .gte('business_date', from).lte('business_date', to).order('business_date').order('id').range(a, b)),
    bankLines(sb, ctx, `${ym}-01`, depTo),
  ]);
  const byDay = new Map<string, number>();
  for (const s of sales) byDay.set(s.business_date, (byDay.get(s.business_date) ?? 0) + Number(s.card_cents));
  const r = matchCardDeposits([...byDay].map(([date, cardCents]) => ({ date, cardCents })),
    lines.filter((l) => Number(l.amount_cents) > 0).map((l) => ({ id: l.id, date: l.posted_on, amountCents: Number(l.amount_cents), description: l.description })), today);
  const matches = r.matches.filter((m) => m.to.startsWith(ym)), missing = r.missing.filter((m) => m.date.startsWith(ym));
  const cardMonth = [...byDay].filter(([d]) => d.startsWith(ym)).reduce((a, [, c]) => a + c, 0);
  const qs = (m: string) => `/app/bank/card-deposits?m=${m}`;

  return (
    <>
      <PageHeader title="Bank" description="Each day’s card sales should land in the bank 1 to 5 days later, less processing fees. Days with no deposit are flagged." />
      <BankTabs active="/app/bank/card-deposits" />
      {seesAll !== true && <Notice>You see only your stores’ card sales, so deposits for other stores won’t match.</Notice>}
      <nav aria-label="Month" className="flex items-center justify-between gap-2">
        <Link href={qs(ymAdd(ym, -1))} aria-label="Previous month" className="grid size-10 place-items-center rounded-full bg-card text-lg shadow-[var(--shadow-card)]">‹</Link>
        <h2 className="text-[20px] font-bold tracking-tight">{label(ym)}</h2>
        {ym < today.slice(0, 7) ? <Link href={qs(ymAdd(ym, 1))} aria-label="Next month" className="grid size-10 place-items-center rounded-full bg-card text-lg shadow-[var(--shadow-card)]">›</Link> : <span className="size-10" />}
      </nav>
      <div className="grid grid-cols-3 gap-3 max-[520px]:grid-cols-1">
        <Stat block="blue" label="Card sales" value={formatMoney(cardMonth)} sub={`${[...byDay.keys()].filter((d) => d.startsWith(ym)).length} days`} />
        <Stat label="Matched deposits" value={formatMoney(matches.reduce((a, m) => a + m.deposit.amountCents, 0))} sub={r.feePct === null ? 'No fee yet' : `About ${r.feePct.toFixed(2)}% in fees`} />
        <Stat label="Missing deposits" value={String(missing.length)} tone={missing.length ? 'late' : undefined} sub={missing.length ? `${formatMoney(missing.reduce((a, m) => a + m.cardCents, 0))} of card sales` : 'All accounted for'} />
      </div>
      {missing.length > 0 && (
        <Card>
          <Eyebrow>No deposit found</Eyebrow>
          <ul className="mt-2 flex flex-col divide-y divide-line text-[15px]">
            {missing.map((m) => <li key={m.date} className="flex justify-between gap-2 py-1.5"><span>{fmtDate(m.date)}</span><span className="num">{formatMoney(m.cardCents)} card sales</span></li>)}
          </ul>
          <p className="mt-2 text-sm text-muted">Import the newest bank statement first. If it’s still missing, ask your card processor.</p>
        </Card>
      )}
      {matches.length === 0 ? <EmptyState title="No card deposits matched yet">Import your bank statement on the Statement tab and record daily sales with card totals.</EmptyState> : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[560px] text-[14.5px]">
            <thead className="text-left text-xs uppercase tracking-[.06em] text-muted"><tr><th className="px-4 py-2.5">Deposit</th><th className="px-2">For card sales</th><th className="px-2 text-right">Card sales</th><th className="px-2 text-right">Deposited</th><th className="px-4 text-right">Fee</th></tr></thead>
            <tbody>
              {matches.map((m) => (
                <tr key={m.deposit.id} className="border-t border-line">
                  <td className="px-4 py-2">{fmtDate(m.deposit.date)}<span className="block max-w-[14rem] truncate text-xs text-muted">{m.deposit.description}</span></td>
                  <td className="px-2">{m.from === m.to ? fmtDate(m.from) : `${fmtDate(m.from)} – ${fmtDate(m.to)}`}</td>
                  <td className="num px-2 text-right">{formatMoney(m.expectedCents)}</td>
                  <td className="num px-2 text-right">{formatMoney(m.deposit.amountCents)}</td>
                  <td className="px-4 text-right"><Badge tone={m.feePct > 4 ? 'warning' : 'neutral'}>{m.feePct.toFixed(2)}%</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <p className="text-sm text-muted">A deposit matches 1 to 3 days of card sales ending 1 to 5 days earlier when it’s 93% to 100.5% of them. Card totals come from your daily sales entries.</p>
    </>
  );
}
