import Link from 'next/link';
import { KpiTile } from '@/components/data/kpi-tile';
import { buttonClass } from '@/components/ui';
import { comparableDate, pctChange, sumRange } from '@/lib/finance/metrics';
import { formatMoney, PLANS, TRIAL_DAYS } from '@/lib/billing/plans';
import { demoDailySales, demoInvoices, DEMO_BUSINESS } from '@/demo/data';

export const revalidate = 86400;

function ClosingCard() {
  const anchor = new Date().toISOString().slice(0, 10);
  const sales = demoDailySales(anchor, 400);
  const by = new Map(sales.map((s) => [s.date, s]));
  const today = by.get(anchor)!;
  const ly = by.get(comparableDate(anchor));
  const mtd = sumRange(sales, `${anchor.slice(0, 8)}01`, anchor);
  const due = demoInvoices(anchor).filter((i) => i.paidCents < i.totalCents && i.dueDate >= anchor).sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 3);
  const change = ly ? pctChange(today.salesCents, ly.salesCents) : null;
  return (
    <div className="rounded-[22px] border border-line bg-card p-4 shadow-[var(--shadow-card)] sm:p-5">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <p className="font-bold">Before you lock up</p>
        <p className="text-sm text-muted">{DEMO_BUSINESS.name} · sample data</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <KpiTile size="lg" tone="indigo" label="Today’s sales" value={formatMoney(today.salesCents)}
          comparison={change === null ? null : { text: `${change > 0 ? '+' : ''}${change}% vs last year`, direction: change >= 0 ? 'up' : 'down' }} />
        <KpiTile size="lg" tone="blue" label="Month to date" value={formatMoney(mtd.salesCents)} footnote={`${mtd.transactions.toLocaleString()} transactions`} />
      </div>
      <p className="mt-4 text-sm font-semibold">Bills coming up</p>
      <ul className="mt-1">
        {due.map((i) => (
          <li key={i.id} className="num flex justify-between border-b border-line py-2 text-[15px] last:border-0">
            <span>{i.number}<span className="text-muted"> · due {new Date(`${i.dueDate}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}</span></span>
            <span>{formatMoney(i.totalCents - i.paidCents)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function Home() {
  return (
    <>
      <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 pb-16 pt-12 sm:pt-20 lg:grid-cols-[1.05fr_1fr]">
        <div>
          <h1 className="text-[42px] font-extrabold leading-[1.02] sm:text-[64px]">Know where your business stands before you lock up.</h1>
          <p className="mt-6 max-w-xl text-lg text-muted">
            Sales, vendor bills, bank reconciliation and the books for independent stores and wholesale distributors. One login for every location.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/signup" className={buttonClass('primary', 'lg')}>Start {TRIAL_DAYS}-day free trial</Link>
            <Link href="/demo" className={buttonClass('secondary', 'lg')}>Try the live demo</Link>
          </div>
          <p className="mt-4 text-sm text-muted">Card required to start. You pay nothing today and can cancel before the trial ends.</p>
        </div>
        <ClosingCard />
      </section>

      <section className="bg-indigo text-white">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 md:grid-cols-3">
          {[
            { title: 'For retail stores', body: 'Register reports, bills, vendors, bank matching, staff schedules and payroll records, profit and partners.', href: '/solutions/retail' },
            { title: 'For wholesale', body: 'Bookkeeping, bills and vendors today. Catalog with case packs, customer pricing, sales rep ordering, picking and invoicing are coming soon.', href: '/solutions/wholesale' },
            { title: 'For the books', body: 'Double-entry accounting underneath it all, so your profit and loss actually reconciles.', href: '/solutions/accounting' },
          ].map((c) => (
            <Link key={c.href} href={c.href} className="group block border-t-2 border-white/40 pt-4">
              <h2 className="text-2xl font-bold group-hover:underline">{c.title}</h2>
              <p className="mt-2 text-white/80">{c.body}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-20">
        <h2 className="text-3xl font-extrabold">How the free trial works</h2>
        <ol className="mt-8 grid gap-8 md:grid-cols-3">
          {[
            ['Create your account', 'Tell us your business name, whether you run retail, wholesale or both, and your first location.'],
            ['Add a payment method', `Stripe holds your card securely. Nothing is charged for ${TRIAL_DAYS} days.`],
            ['Decide by day ' + TRIAL_DAYS, 'Keep going and your plan starts automatically, or cancel from the billing page in two clicks.'],
          ].map(([t, b], i) => (
            <li key={t} className="flex gap-4">
              <span className="num flex size-10 flex-none items-center justify-center rounded-full bg-accent-soft font-extrabold text-indigo">{i + 1}</span>
              <div><h3 className="text-lg font-bold">{t}</h3><p className="mt-1 text-muted">{b}</p></div>
            </li>
          ))}
        </ol>
      </section>

      <section className="mx-auto max-w-6xl px-4">
        <div className="flex flex-col gap-6 rounded-[22px] bg-card p-8 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-2xl font-extrabold">Retail from {formatMoney(PLANS.retail.monthlyCents)}/month. Wholesale from {formatMoney(PLANS.wholesale.monthlyCents)}/month.</h2>
            <p className="mt-1 text-muted">Add more store locations as you grow. Run both on one account.</p>
          </div>
          <Link href="/pricing" className={buttonClass('primary', 'lg')}>See pricing</Link>
        </div>
      </section>
    </>
  );
}
