import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { ActionForm } from '@/components/action-form';
import { SubmitButton } from '@/components/submit-button';
import { Block, Card, Eyebrow, Input, LinkButton, cx } from '@/components/ui';
import { formatMoney } from '@/lib/billing/plans';
import {
  budgetFor, forecast, monthItems, totals, ymAdd,
  type BillRow, type Budget, type DueItem, type Kind, type TemplateRow,
} from '@/lib/bills/due';
import { setBillBudget } from './actions';
import { DueCalendar, PaidBox } from './due-client';

const ymLabel = (ym: string, short = false) =>
  new Date(`${ym}-01T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: short ? 'short' : 'long', year: 'numeric' });
const monLabel = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short' });
const dayLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
const money0 = (c: number) => (c / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const moneyShort = (c: number) => (c >= 100_000 ? `$${(c / 100_000).toFixed(1)}k` : money0(c));
const KIND_L = { all: 'All', order: 'Orders', bill: 'Bills' } as const;
const FILTER_L = { all: 'All', unpaid: 'Unpaid', paid: 'Paid' } as const;

export interface DueViewProps {
  ym: string; curYm: string; today: string; K: Kind | 'all'; F: 'all' | 'unpaid' | 'paid';
  bills: BillRow[]; templates: TemplateRow[]; vendorName: Map<string, string>; budgets: Budget[];
  canCreate: boolean; canPay: boolean; canBudget: boolean;
  /** False for store-limited members: the budget is business-wide (#135). */
  showBudget: boolean;
  vendorKind?: Map<string, Kind>;
}

/** The Due view, copied from the RetailNexa app's month view (#101). Rendering only; the page loads the data. */
export function DueView({ ym, curYm, today, K, F, bills, templates, vendorName, budgets, canCreate, canPay, canBudget: canBudgetIn, showBudget, vendorKind }: DueViewProps) {
  const canBudget = canBudgetIn && showBudget;
  const href = (o: { m?: string; k?: string; f?: string }) => {
    const q = new URLSearchParams();
    const m = o.m ?? ym, k = o.k ?? K, f = o.f ?? F;
    if (m !== curYm) q.set('m', m);
    if (k !== 'all') q.set('k', k);
    if (f !== 'all') q.set('f', f);
    const s = q.toString();
    return s ? `/app/bills?${s}` : '/app/bills';
  };
  const allItems = monthItems(ym, bills, templates, vendorName, today, vendorKind);
  const items = K === 'all' ? allItems : allItems.filter((i) => i.kind === K);
  const t = totals(items);
  const budget = K === 'all' && showBudget ? budgetFor(ym, budgets) : null;
  const scale = Math.max(budget?.cents ?? 0, t.total) || 1;
  const after = budget ? budget.cents - t.total : null;
  const pastAndDone = ym < curYm && t.left === 0;
  const kindCount = (k: Kind | 'all') => { const l = k === 'all' ? allItems : allItems.filter((i) => i.kind === k); return { n: l.length, left: totals(l).left }; };

  const nx = ymAdd(ym, 1);
  const f15 = monthItems(nx, bills, templates, vendorName, today, vendorKind).filter((i) => +i.dueDate.slice(8) <= 15);
  const f15t = totals(f15), f15orders = f15.filter((i) => i.kind === 'order').length;
  const fc = forecast(ym, 6, bills, templates, vendorName, showBudget ? budgets : [], today, vendorKind);
  const fmax = Math.max(1, ...fc.map((x) => Math.max(x.total, x.budget ?? 0)));

  const shown = items.filter((i) => (F === 'unpaid' ? i.leftCents > 0 : F === 'paid' ? i.leftCents === 0 : true));
  const row = (i: DueItem) => (
    <li key={i.id} className="flex items-center gap-3 rounded-[14px] bg-card px-3.5 py-3 shadow-[var(--shadow-card)]">
      {i.stage === 'open' && i.billId && canPay ? <PaidBox billId={i.billId} name={i.name} idemKey={randomUUID()} />
        : <span aria-hidden className={cx('grid size-6 shrink-0 place-items-center rounded-md border-2 text-xs', i.stage === 'paid' ? 'border-paid bg-paid text-white' : 'border-line')}>{i.stage === 'paid' ? '✓' : ''}</span>}
      <Link href={i.billId ? `/app/bills/${i.billId}` : '/app/bills/recurring'} className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-baseline justify-between gap-3">
          <span className="truncate font-semibold">{i.name}</span>
          <span className={cx('num shrink-0 font-semibold', i.stage === 'paid' && 'text-muted')}>{i.stage === 'paid' ? formatMoney(i.amountCents) : formatMoney(i.leftCents)}</span>
        </span>
        <span className="flex flex-wrap gap-x-2 text-[13px] text-muted">
          <span className={cx(i.dot === 'late' && 'font-semibold text-late', i.dot === 'soon' && 'font-semibold text-soon')}>
            {i.stage === 'paid' ? 'Paid' : i.dot === 'late' ? 'Late' : 'Due'} {dayLabel(i.dueDate)}
          </span>
          <span>· {i.detail}</span>
          {i.stage === 'draft' && <span>· Draft, needs approval</span>}
          {i.stage === 'scheduled' && <span>· Recurring, not created yet</span>}
          {i.stage === 'open' && i.paidCents > 0 && <span>· {formatMoney(i.paidCents)} paid</span>}
        </span>
      </Link>
    </li>
  );
  const group = (k: Kind, list: DueItem[]) => (
    <div key={k} className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <Eyebrow>{k === 'order' ? 'Orders · vendor invoices' : 'Bills · rent, utilities, services'}</Eyebrow>
        <span className="num text-[13px] text-muted">{money0(totals(list).left)} left of {money0(totals(list).total)}</span>
      </div>
      {list.length ? <ul className="flex flex-col gap-2">{list.map(row)}</ul>
        : <p className="rounded-[14px] bg-card p-4 text-center text-sm text-muted">No {k === 'order' ? 'orders' : 'bills'} {F === 'all' ? 'this month' : F}.</p>}
    </div>
  );

  return (
    <>
      {/* Month bar */}
      <nav aria-label="Month" className="flex items-center justify-between gap-2">
        <Link href={href({ m: ymAdd(ym, -1) })} aria-label="Previous month" className="grid size-10 place-items-center rounded-full bg-card text-lg shadow-[var(--shadow-card)]">‹</Link>
        <div className="text-center">
          <h1 className="text-[22px] font-bold tracking-tight">{ymLabel(ym)}</h1>
          {ym !== curYm && <Link href={href({ m: curYm })} className="text-sm font-semibold text-accent-strong">Back to this month</Link>}
        </div>
        <Link href={href({ m: ymAdd(ym, 1) })} aria-label="Next month" className="grid size-10 place-items-center rounded-full bg-card text-lg shadow-[var(--shadow-card)]">›</Link>
      </nav>

      {/* Orders / Bills */}
      <nav aria-label="Show" className="grid grid-cols-3 gap-1 rounded-[14px] bg-card p-1 shadow-[var(--shadow-card)]">
        {(['all', 'order', 'bill'] as const).map((k) => {
          const c = kindCount(k);
          return (
            <Link key={k} href={href({ k })} aria-current={K === k ? 'page' : undefined}
              className={cx('flex min-w-0 flex-col items-center rounded-[10px] px-1.5 py-2', K === k ? 'bg-accent text-white' : 'text-ink hover:bg-soft')}>
              <b className="text-sm">{KIND_L[k]}</b>
              <span className={cx('num max-w-full truncate text-[11px]', K === k ? 'text-white/90' : 'text-muted')}>{c.n} · {money0(c.left)} left</span>
            </Link>
          );
        })}
      </nav>

      {/* Left to pay */}
      <Block tone="blue" className="flex flex-col gap-3 p-[18px]">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-bold uppercase tracking-[.08em]">{pastAndDone ? 'Total spent' : 'Left to pay'}</span>
          {t.late > 0 && <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-bold text-late">{t.late} overdue</span>}
        </div>
        <p className="num text-[36px] font-medium leading-none tracking-[-.02em] max-[421px]:text-[31px]">{formatMoney(pastAndDone ? t.total : t.left)}</p>
        <div className="grid grid-cols-3 gap-2">
          <div><p className="num text-lg font-semibold">{formatMoney(t.total)}</p><p className="text-xs opacity-90">{t.count} {K === 'order' ? 'order' : K === 'bill' ? 'bill' : 'item'}{t.count === 1 ? '' : 's'} due</p></div>
          <div><p className="num text-lg font-semibold">{formatMoney(t.paid)}</p><p className="text-xs opacity-90">Paid</p></div>
          <div><p className="num text-lg font-semibold">{budget ? formatMoney(budget.cents) : '—'}</p><p className="text-xs opacity-90">Budget</p></div>
        </div>
        <div role="img" aria-label={`Paid ${formatMoney(t.paid)}, unpaid ${formatMoney(t.left)}${budget ? `, budget ${formatMoney(budget.cents)}` : ''}`}
          className="relative mt-1 flex h-2.5 rounded-md bg-white/25">
          <span className="h-full rounded-l-md bg-white" style={{ width: `${(t.paid / scale) * 100}%` }} />
          <span className={cx('h-full bg-white/55', !t.paid && 'rounded-l-md')} style={{ width: `${(t.left / scale) * 100}%` }} />
          {budget && <i className="absolute -top-1 -bottom-1 w-0.5 bg-[#1d1d40]" style={{ left: `calc(${Math.min(100, (budget.cents / scale) * 100)}% - 1px)` }} />}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-sm bg-white" />Paid</span>
          <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-sm bg-white/55" />Still to pay</span>
          {budget && <span className="flex items-center gap-1.5"><i className="h-2.5 w-0.5 bg-[#1d1d40]" />Budget</span>}
        </div>
        {K !== 'all' ? (
          <p className="text-sm opacity-90">{K === 'order' ? 'Vendor orders and invoices only' : 'Rent, utilities, insurance and other bills only'} · <Link href={href({ k: 'all' })} className="font-semibold underline">show all</Link></p>
        ) : !showBudget ? (
          <p className="text-sm opacity-90">Bills for the stores you work in. The monthly budget covers the whole business, so only owners and admins see it.</p>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-dashed border-white/40 pt-3 text-sm">
            <span>{after === null ? 'No budget set for this month' : after >= 0 ? <><b>{formatMoney(after)}</b> under budget after all bills</> : <><b>{formatMoney(-after)}</b> over budget</>}{budget && !budget.own && <span className="block text-xs opacity-90">Your every-month budget</span>}</span>
            {canBudget && (
              <details className="group">
                <summary className="cursor-pointer list-none rounded-full bg-white/20 px-3.5 py-1.5 font-semibold hover:bg-white/30">{budget ? 'Edit budget' : 'Set budget'}</summary>
                <ActionForm action={setBillBudget} className="mt-3 flex flex-col gap-2 rounded-xl bg-card p-3 text-ink">
                  <input type="hidden" name="month" value={ym} />
                  <label htmlFor="bg-amt" className="text-sm font-semibold">Budget for {ymLabel(ym)}</label>
                  <Input id="bg-amt" name="amount" inputMode="decimal" className="num" placeholder="4500.00" defaultValue={budget ? (budget.cents / 100).toFixed(2) : ''} />
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="every_month" defaultChecked={!budget || !budget.own} className="size-4 accent-[#3f63de]" /> Use this for every month without its own budget</label>
                  <p className="text-xs text-muted">Leave the amount empty to remove the budget.</p>
                  <SubmitButton size="sm" className="self-start" pendingText="Saving…">Save budget</SubmitButton>
                </ActionForm>
              </details>
            )}
          </div>
        )}
      </Block>

      {/* First 15 days of next month */}
      <Card>
        <details>
          <summary className="flex cursor-pointer list-none flex-col gap-1">
            <span className="flex items-center justify-between gap-2"><Eyebrow>{monLabel(nx)} 1–15 · all expenses</Eyebrow><span className="text-sm text-muted">{f15.length} item{f15.length === 1 ? '' : 's'} ›</span></span>
            <span className="flex flex-wrap items-baseline gap-x-3"><b className="num text-xl">{formatMoney(f15t.total)}</b><span className="text-sm text-muted">{f15t.left < f15t.total ? `${formatMoney(f15t.left)} still to pay · ` : ''}{f15orders} order{f15orders === 1 ? '' : 's'}, {f15.length - f15orders} bill{f15.length - f15orders === 1 ? '' : 's'}</span></span>
          </summary>
          {f15.length ? (
            <ul className="mt-3 flex flex-col divide-y divide-line">
              {f15.map((i) => (
                <li key={i.id}><Link href={i.billId ? `/app/bills/${i.billId}` : '/app/bills/recurring'} className="grid grid-cols-[4rem_1fr_auto] gap-2 py-2 text-[14px]">
                  <span className="text-muted">{dayLabel(i.dueDate)}</span>
                  <span className="truncate">{i.name}{i.kind === 'order' && <span className="text-muted"> · order</span>}</span>
                  <b className={cx('num', i.leftCents === 0 && 'text-muted')}>{i.leftCents === 0 ? 'Paid' : formatMoney(i.leftCents)}</b>
                </Link></li>
              ))}
            </ul>
          ) : <p className="mt-2 text-sm text-muted">Nothing due yet.</p>}
          <Link href={href({ m: nx })} className="mt-2 inline-block text-sm font-semibold text-accent-strong">Open {ymLabel(nx, true)}</Link>
        </details>
      </Card>

      {/* Calendar */}
      <Card className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-muted">Tap a day to see its bills</span>
          <span className="flex gap-3 text-xs text-muted">
            <span className="flex items-center gap-1"><i className="size-2 rounded-full bg-late" />Late</span>
            <span className="flex items-center gap-1"><i className="size-2 rounded-full bg-soon" />Soon</span>
            <span className="flex items-center gap-1"><i className="size-2 rounded-full bg-accent" />Upcoming</span>
            <span className="flex items-center gap-1"><i className="size-2 rounded-full bg-paid" />Paid</span>
          </span>
        </div>
        <DueCalendar ym={ym} today={today} showKind={K === 'all'} canAdd={canCreate}
          items={items.map((i) => ({ id: i.id, billId: i.billId, name: i.name, detail: i.detail, dueDate: i.dueDate, amountCents: i.amountCents, leftCents: i.leftCents, dot: i.dot, stage: i.stage, kind: i.kind }))} />
      </Card>

      {/* List */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-bold">{K === 'order' ? 'Orders' : K === 'bill' ? 'Bills' : 'Due'} this month</h2>
          <nav aria-label="Filter" className="flex gap-1 rounded-full bg-soft p-1">
            {(['all', 'unpaid', 'paid'] as const).map((f) => (
              <Link key={f} href={href({ f })} aria-current={F === f ? 'page' : undefined}
                className={cx('rounded-full px-3 py-1 text-sm font-semibold', F === f ? 'bg-card text-ink shadow-[var(--shadow-card)]' : 'text-muted hover:text-ink')}>{FILTER_L[f]}</Link>
            ))}
          </nav>
        </div>
        {items.length === 0 ? (
          <Card className="flex flex-col items-center gap-2 text-center">
            <strong>{ym < curYm ? `No bills recorded for ${ymLabel(ym)}` : 'Nothing due this month'}</strong>
            {canCreate && <LinkButton href="/app/bills/new" size="sm">Enter a bill</LinkButton>}
          </Card>
        ) : K === 'all' ? (
          <>{group('order', shown.filter((i) => i.kind === 'order'))}{group('bill', shown.filter((i) => i.kind === 'bill'))}</>
        ) : shown.length ? <ul className="flex flex-col gap-2">{shown.map(row)}</ul>
          : <p className="rounded-[14px] bg-card p-4 text-center text-sm text-muted">Nothing {F} this month.</p>}
        {canPay && <p className="text-xs text-muted">The check box pays what’s left from the bank today. To pay by cash, part of a bill, or on another date, open the bill.</p>}
      </section>

      {/* Six-month forecast */}
      <Card className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-2"><h2 className="text-lg font-bold">Six-month forecast</h2><span className="text-sm text-muted">{showBudget ? 'Bills due vs. budget' : 'Bills due'}</span></div>
        <ul className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-x-3 gap-y-2.5">
          {fc.map((x) => (
            <li key={x.ym} className="contents">
              <Link href={href({ m: x.ym })} className="text-sm font-semibold">{ymLabel(x.ym, true)}</Link>
              <span className="relative h-3 overflow-hidden rounded bg-soft" role="img" aria-label={`${formatMoney(x.total)} due${x.budget !== null ? `, budget ${formatMoney(x.budget)}` : ''}`}>
                <span className={cx('absolute inset-y-0 left-0 rounded', x.budget !== null && x.total > x.budget ? 'bg-late' : 'bg-accent')} style={{ width: `${(x.total / fmax) * 100}%` }} />
                {x.budget !== null && <b className="absolute inset-y-0 w-0.5 bg-ink" style={{ left: `calc(${(x.budget / fmax) * 100}% - 1px)` }} />}
              </span>
              <span className="num text-sm">{moneyShort(x.total)}{x.budget !== null ? ` / ${moneyShort(x.budget)}` : ''}</span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted">Includes recurring bills that haven’t been created yet.</p>
      </Card>

      <div className="flex flex-wrap gap-2">
        <LinkButton href="/app/bills/list" variant="secondary">All bills</LinkButton>
        <LinkButton href="/app/bills/aging" variant="secondary">What you owe by age</LinkButton>
        {canCreate && <LinkButton href="/app/bills/new">Enter a bill</LinkButton>}
      </div>
    </>
  );
}
