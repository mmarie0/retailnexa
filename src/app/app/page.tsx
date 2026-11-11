import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { can, getOrgContext, getSupabase } from '@/lib/auth/context';
import { Badge, Card, Eyebrow, Notice, cx } from '@/components/ui';
import { ROLE_LABELS } from '@/lib/auth/permissions';
import { formatMoney } from '@/lib/billing/plans';
import { todayIn } from '@/lib/time';
import { salesWindows, summarizeBills, summarizeSales } from '@/lib/dashboard/summary';
import {
  RANGES, cleanLayout, daysBetween, daysIn, pct, profitOf, projectMonth, rangeFor, salesByMonth, spendVsLastYear, trend12, ymAdd, type TileId,
} from '@/lib/dashboard/overview';
import { incomeStatement, type LedgerRow } from '@/lib/accounting/statements';
import { budgetFor, daysInMonth, monthItems, totals, type BillRow, type Budget, type TemplateRow } from '@/lib/bills/due';
import { DailySalesChart } from './_dashboard/daily-sales-chart';
import { TrendChart } from './_dashboard/trend-chart';
import { Change, Pct, Stat } from './_dashboard/tiles';
import { billTotals, monthReports, payrollPaid, salesRollups, scheduledPayroll } from './_dashboard/data';
import { RangeView } from './_dashboard/range-view';
import { Icon } from './app-shell';

export const metadata: Metadata = { title: 'Overview' };

const money0 = (c: number) => formatMoney(Math.round(c / 100) * 100).replace(/\.00$/, '');

export default async function OverviewPage({ searchParams }: PageProps<'/app'>) {
  const ctx = await getOrgContext();
  const sp = await searchParams;
  const supabase = await getSupabase();
  const [{ count: locations }, { count: members }, { data: announcements }, { data: orgRow }, { data: saved }] = await Promise.all([
    supabase.from('locations').select('id', { count: 'exact', head: true }).eq('organization_id', ctx.org.id).eq('is_active', true),
    can(ctx, 'members.view')
      ? supabase.from('memberships').select('id', { count: 'exact', head: true }).eq('organization_id', ctx.org.id).eq('status', 'active')
      : Promise.resolve({ count: null }),
    supabase.from('announcements').select('id, title, body, severity, audience').order('starts_at', { ascending: false }).limit(3),
    supabase.from('organizations').select('timezone').eq('id', ctx.org.id).maybeSingle(),
    supabase.from('overview_layouts').select('layout').eq('organization_id', ctx.org.id).eq('user_id', ctx.user.id).maybeSingle(),
  ]);
  const today = todayIn(orgRow?.timezone);
  const ym = today.slice(0, 7), monthStart = `${ym}-01`, monthEnd = `${ym}-${daysInMonth(ym)}`, lym = ymAdd(ym, -12);
  const perm = {
    sales: can(ctx, 'sales.view'), bills: can(ctx, 'bills.view'), payroll: can(ctx, 'payroll.view'),
    books: can(ctx, 'accounting.view') || can(ctx, 'profit.view'), profit: can(ctx, 'profit.view') || can(ctx, 'accounting.view'),
  };
  perm.profit = perm.profit && perm.sales && perm.bills && perm.payroll;
  const range = rangeFor(sp.r, today, sp.from, sp.to);

  const steps = [
    { done: !!ctx.subscription, label: 'Choose a plan and start your trial', href: '/app/billing', show: can(ctx, 'billing.manage') },
    { done: (locations ?? 0) > 0, label: `Add your locations (${locations ?? 0} so far)`, href: '/app/settings/locations', show: can(ctx, 'locations.manage') },
    { done: (members ?? 0) > 1, label: 'Invite your team', href: '/app/settings/team', show: can(ctx, 'members.manage') },
    { done: false, label: 'Review what each role can see', href: '/help/roles-and-permissions', show: can(ctx, 'roles.manage') },
  ].filter((s) => s.show);
  const visibleAnnouncements = (announcements ?? []).filter((a) => !a.audience || a.audience === ctx.org.businessType || ctx.org.businessType === 'both');
  const monthName = new Date(`${today}T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long' });

  const head = (
    <>
      <div className="flex items-baseline justify-between gap-2.5">
        <h1 className="text-[26px] font-extrabold tracking-[-.02em]">{ctx.org.name}</h1>
        <span className="text-[13px] text-muted">{ROLE_LABELS[ctx.org.role]}</span>
      </div>
      {visibleAnnouncements.map((a) => (
        <Card key={a.id} className={a.severity === 'critical' ? 'border-late' : a.severity === 'warning' ? 'border-soon' : ''}>
          <p className="font-bold">{a.title}</p><p className="mt-1 text-muted">{a.body}</p>
        </Card>
      ))}
      {(perm.sales || perm.bills) && <RangeBar range={range} today={today} />}
    </>
  );

  if (range) return <>{head}<RangeView ctx={ctx} range={range} perm={perm} /></>;

  const layout = cleanLayout(saved?.layout ?? null);
  const on = (id: TileId) => layout.includes(id);
  const want = {
    summary: perm.sales && (on('sales') || on('salesChart')),
    billMonth: perm.bills && (on('bills') || on('profit') || on('upcoming') || on('spend') || on('lySpend')),
    ap: perm.bills && on('billsToPay'),
    pl: perm.books && on('books'),
    months: perm.sales && (on('trend') || on('profit')),
    billHist: perm.bills && (on('lySpend') || on('profit')),
    payroll: perm.payroll && (on('payroll') || on('profit')),
  };
  const w = salesWindows(today);
  const salesSel = 'business_date, gross_sales_cents, discounts_cents, transaction_count';
  const nextEnd = `${ymAdd(ym, 1)}-${daysInMonth(ymAdd(ym, 1))}`;
  const none = Promise.resolve({ data: null });
  const [recent, lastYear, bills, activity, monthBills, tpls, budgetRows, vendorRows, seesAll, rolls, reps, billHist, payPaid, payLy, paySched] = await Promise.all([
    want.summary ? supabase.from('sales_days').select(salesSel).eq('organization_id', ctx.org.id).is('voided_at', null)
      .gte('business_date', w.recent.from).lte('business_date', w.recent.to).limit(2000) : none,
    want.summary ? supabase.from('sales_days').select(salesSel).eq('organization_id', ctx.org.id).is('voided_at', null)
      .gte('business_date', w.lastYear.from).lte('business_date', w.lastYear.to).limit(2000) : none,
    want.ap ? supabase.from('bills').select('status, due_date, total_cents, paid_cents').eq('organization_id', ctx.org.id)
      .in('status', ['draft', 'approved']).limit(2000) : none,
    want.pl ? supabase.rpc('account_activity_detail', { p_org: ctx.org.id, p_from: monthStart, p_to: today }) : none,
    // "Bills this month" (#101) uses the Due view's numbers; next month too for "Due next 7 days".
    want.billMonth ? supabase.from('bills').select('id, vendor_id, bill_number, bill_date, due_date, status, total_cents, paid_cents, recurring_bill_id')
      .eq('organization_id', ctx.org.id).neq('status', 'void').gte('due_date', monthStart).lte('due_date', nextEnd).limit(3000) : none,
    want.billMonth ? supabase.from('recurring_bills').select('id, vendor_id, name, frequency, day_of_month, next_date, end_date, due_days, is_active, lines')
      .eq('organization_id', ctx.org.id).eq('is_active', true) : none,
    want.billMonth ? supabase.from('bill_budgets').select('month, amount_cents').eq('organization_id', ctx.org.id) : none,
    want.billMonth ? supabase.from('vendors').select('id, name, kind').eq('organization_id', ctx.org.id) : none,
    want.billMonth ? supabase.rpc('sees_all_stores', { p_org: ctx.org.id }) : Promise.resolve({ data: false }),
    want.months ? salesRollups(supabase, ctx.org.id, `${ymAdd(ym, -23)}-01`, today, 'month') : Promise.resolve(null),
    want.months ? monthReports(supabase, ctx.org.id, `${ymAdd(ym, -23)}-01`, monthStart) : Promise.resolve(null),
    want.billHist ? billTotals(supabase, ctx.org.id, `${+ym.slice(0, 4) - 1}-01-01`, addMonthEnd(ymAdd(ym, -1))) : Promise.resolve(null),
    want.payroll ? payrollPaid(supabase, ctx.org.id, monthStart, monthEnd) : Promise.resolve(null),
    want.payroll && on('profit') ? payrollPaid(supabase, ctx.org.id, `${lym}-01`, addMonthEnd(lym)) : Promise.resolve(null),
    want.payroll ? scheduledPayroll(ctx, monthStart, monthEnd) : Promise.resolve(null),
  ]);

  // ---------- numbers ----------
  const items = want.billMonth ? (() => {
    const templates = ((tpls.data ?? []) as (Omit<TemplateRow, 'amount_cents'> & { lines: { amount_cents: number }[] })[])
      .map(({ lines, ...t }) => ({ ...t, amount_cents: lines.reduce((a, l) => a + Number(l.amount_cents), 0) }));
    const names = new Map((vendorRows.data ?? []).map((v) => [v.id as string, v.name as string]));
    const rows = (monthBills.data ?? []) as BillRow[];
    return { cur: monthItems(ym, rows, templates, names, today), next: monthItems(ymAdd(ym, 1), rows, templates, names, today) };
  })() : null;
  const billMonth = items ? { ...totals(items.cur), budget: seesAll.data === true ? budgetFor(ym, (budgetRows.data ?? []) as Budget[])?.cents ?? null : null } : null;
  const salesRows = [...(recent.data ?? []), ...(lastYear.data ?? [])].map((r) => ({
    date: r.business_date as string, netCents: Number(r.gross_sales_cents) - Number(r.discounts_cents), transactions: r.transaction_count as number | null,
  }));
  const sales = want.summary && (recent.data ?? []).length ? summarizeSales(salesRows, today) : null;
  const ap = want.ap ? summarizeBills((bills.data ?? []).map((b) => ({ status: b.status as string, dueDate: b.due_date as string, openCents: Number(b.total_cents) - Number(b.paid_cents) })), today) : null;
  // Same rows and builder as the Profit & loss page, so the tiles always agree with it (#47).
  const pl = want.pl && activity.data ? incomeStatement(((activity.data ?? []) as { account_id: string; code: string; name: string; type: LedgerRow['type']; role: string | null; net_cents: number }[])
    .map((r) => ({ id: r.account_id, code: r.code, name: r.name, type: r.type, role: r.role, net: Number(r.net_cents) }))) : null;
  const marginPct = pl && pl.revenue.total ? Math.round((pl.grossProfit / pl.revenue.total) * 10_000) / 100 : null;
  const months = rolls && reps ? salesByMonth(rolls, reps) : null;
  const projected = rolls && reps ? projectMonth(ym, rolls, reps) : null;
  const payProj = paySched !== null && payPaid ? Math.max(paySched, payPaid.cents) : null;
  const salesForPace = projected ?? months?.get(ym) ?? null;
  const profit = perm.profit && billMonth && payProj !== null ? profitOf(salesForPace, billMonth.total, payProj) : null;
  const lyProfit = perm.profit && months && billHist && payLy ? profitOf(months.get(lym) ?? null, billHist.get(lym)?.total ?? 0, payLy.cents) : null;
  const billByMonth = billHist ? new Map([...billHist].map(([k, v]) => [k, v.total])) : null;
  const lySpend = billByMonth && billMonth ? spendVsLastYear(ym, billByMonth, billMonth.total) : null;

  const canSales = can(ctx, 'sales.import') && ctx.access.canWrite;
  const quick = [
    canSales && { href: '/app/sales/import', label: 'Sales', icon: 'sales' as const, main: true },
    can(ctx, 'bills.create') && ctx.access.canWrite && { href: '/app/bills/new', label: 'Bill', icon: 'bills' as const },
    can(ctx, 'invoices.upload') && ctx.access.canWrite && { href: '/app/bills/invoices', label: 'Invoices', icon: 'invoice' as const },
    can(ctx, 'payroll.manage') && ctx.access.canWrite && { href: '/app/staff/payroll', label: 'Payroll', icon: 'staff' as const },
    canSales && { href: '/app/sales/history', label: 'Month report', icon: 'calendar' as const },
  ].filter(Boolean) as { href: string; label: string; icon: 'sales' | 'bills' | 'invoice' | 'staff' | 'calendar'; main?: boolean }[];

  // ---------- tiles ----------
  const section = (title: string, icon: Parameters<typeof Icon>[0]['k'], body: ReactNode, href?: string) => (
    <section className="flex flex-col gap-2.5 rounded-[18px] bg-card p-4 shadow-[var(--shadow-card)]">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-bold"><Icon k={icon} className="size-5 text-accent" />{title}</h2>
        {href && <Link href={href} className="text-sm font-semibold text-accent-strong">View ›</Link>}
      </div>
      {body}
    </section>
  );
  const kv = (rows: [string, ReactNode][]) => (
    <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1.5 text-[15px]">
      {rows.map(([k, v]) => <div key={k} className="contents"><dt className="text-muted">{k}</dt><dd className="num text-right font-medium">{v}</dd></div>)}
    </dl>
  );
  const hbars = (rows: { label: string; cents: number }[]) => {
    const mx = Math.max(1, ...rows.map((r) => r.cents));
    return (
      <ul className="flex flex-col gap-1.5 text-sm">
        {rows.map((r) => (
          <li key={r.label} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-2">
            <span className="truncate" title={r.label}>{r.label}</span>
            <span aria-hidden className="h-2.5 rounded-r bg-soft"><span className="block h-full rounded-r bg-[#3f63de]" style={{ width: `${Math.max(1, (r.cents / mx) * 100)}%` }} /></span>
            <span className="num">{money0(r.cents)}</span>
          </li>
        ))}
      </ul>
    );
  };

  const T: Record<TileId, () => { half?: boolean; node: ReactNode } | ReactNode | null> = {
    quick: () => quick.length ? (
      <nav aria-label="Quick actions" className="grid grid-cols-[repeat(auto-fit,minmax(96px,1fr))] gap-2">
        {quick.map((q) => (
          <Link key={q.href} href={q.href} className={cx('flex flex-col items-center gap-1.5 rounded-[16px] px-2 py-3 text-sm font-semibold shadow-[var(--shadow-card)] hover:opacity-90', q.main ? 'blk blue' : 'bg-card')}>
            <Icon k={q.icon} className="size-6" />{q.label}
          </Link>
        ))}
      </nav>
    ) : null,
    sales: () => sales ? (
      <section aria-label="Sales" className="flex flex-col gap-3">
        <Stat hero block="blue" label={`${monthName} so far`} value={formatMoney(sales.monthToDate.netCents)} sub={<Change pct={sales.monthToDate.changePct} vs="last year" />} href="/app/sales" />
        <div className="grid grid-cols-3 gap-2.5 max-[520px]:grid-cols-1">
          <Stat label="Today" value={sales.today.netCents === null ? '—' : formatMoney(sales.today.netCents)} sub={sales.today.netCents === null ? 'Not recorded yet' : 'Net sales'} href="/app/sales" />
          <Stat label="Yesterday" value={sales.yesterday.netCents === null ? '—' : formatMoney(sales.yesterday.netCents)} sub={sales.yesterday.netCents === null ? 'Not recorded' : 'Net sales'} href="/app/sales" />
          <Stat label="Last 7 days" value={formatMoney(sales.last7.netCents)} sub={<Change pct={sales.last7.changePct} vs="prior week" />} />
        </div>
      </section>
    ) : perm.sales && canSales ? (
      <Card>
        <h2 className="text-lg font-bold">Bring in your sales</h2>
        <p className="mt-1 text-muted">Import your POS daily report, or upload your monthly sales report at month end, to see sales here.</p>
        <Link href="/app/sales/import" className="mt-3 inline-block font-semibold text-accent-strong">Add sales</Link>
      </Card>
    ) : null,
    payroll: () => payPaid && paySched !== null ? { half: true, node: (
      <Stat block="indigo" label="Projected payroll" value={money0(payProj!)} href="/app/staff/payroll"
        sub={<>Paid so far {money0(payPaid.cents)}{salesForPace?.net ? <><br />{((payProj! / salesForPace.net) * 100).toFixed(1)}% of sales</> : null}</>} />
    ) } : null,
    profit: () => perm.profit && billMonth && payProj !== null ? { half: true, node: (
      <Stat block="sunset" label="Projected profit" value={profit === null ? '—' : money0(profit)}
        sub={<>Sales + tax − bills − payroll<br />{new Date(`${lym}-01T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', year: 'numeric' })}: <b>{lyProfit === null ? '—' : money0(lyProfit)}</b> <Pct v={pct(profit, lyProfit)} /></>} />
    ) } : null,
    bills: () => billMonth && billMonth.count > 0 ? (() => {
      const b = billMonth, scale = Math.max(b.budget ?? 0, b.total) || 1;
      return (
        <Link href="/app/bills" className="flex flex-col gap-2 rounded-[18px] bg-card p-4 shadow-[var(--shadow-card)] hover:opacity-90">
          <span className="flex items-baseline justify-between gap-2">
            <Eyebrow>Bills this month</Eyebrow>
            {b.late > 0 && <span className="text-xs font-bold text-late">{b.late} overdue</span>}
          </span>
          <span className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="num text-[22px] font-medium">{formatMoney(b.left)} <span className="text-sm text-muted">left to pay</span></span>
            <span className="text-sm text-muted">{formatMoney(b.paid)} of {formatMoney(b.total)} paid{b.budget !== null ? ` · budget ${formatMoney(b.budget)}` : ''}</span>
          </span>
          <span role="img" aria-label={`Paid ${formatMoney(b.paid)}, unpaid ${formatMoney(b.left)}`} className="relative flex h-2.5 rounded-md bg-soft">
            <span className="h-full rounded-l-md bg-paid" style={{ width: `${(b.paid / scale) * 100}%` }} />
            <span className="h-full bg-accent" style={{ width: `${(b.left / scale) * 100}%` }} />
            {b.budget !== null && <i className="absolute -top-1 -bottom-1 w-0.5 bg-ink" style={{ left: `calc(${Math.min(100, (b.budget / scale) * 100)}% - 1px)` }} />}
          </span>
        </Link>
      );
    })() : null,
    salesChart: () => sales ? <Card><DailySalesChart points={sales.daily} /></Card> : null,
    billsToPay: () => ap ? (
      <div className="grid grid-cols-2 gap-3">
        <Stat block="indigo" label="Bills to pay" value={formatMoney(ap.unpaidCents)} sub={ap.drafts ? `${ap.drafts} draft${ap.drafts === 1 ? '' : 's'} awaiting approval` : `${formatMoney(ap.dueNext7Cents)} due this week`} href="/app/bills" />
        <Stat label="Overdue bills" value={formatMoney(ap.overdueCents)} tone={ap.overdueCents > 0 ? 'late' : undefined} sub={ap.overdueCount ? `${ap.overdueCount} bill${ap.overdueCount === 1 ? '' : 's'} past due` : 'Nothing overdue'} href="/app/bills" />
      </div>
    ) : null,
    books: () => pl ? (
      <div className="grid grid-cols-2 gap-3">
        <Stat block="lav" label={`${monthName} gross profit`} value={formatMoney(pl.grossProfit)} href={can(ctx, 'accounting.view') ? '/app/accounting/profit-loss' : undefined}
          sub={pl.cogs.total === 0 && pl.revenue.total > 0 ? 'Cost of goods not tracked yet' : marginPct === null ? 'No sales yet' : `${marginPct.toFixed(2)}% margin`} />
        <Stat label={`${monthName} operating profit`} value={formatMoney(pl.operatingProfit)} sub={`After ${formatMoney(pl.operatingExpenses.total)} expenses`} />
      </div>
    ) : null,
    upcoming: () => {
      if (!items) return null;
      const to = addDaysIso(today, 7);
      const list = [...items.cur, ...items.next].filter((b) => b.dueDate >= today && b.dueDate <= to && b.leftCents > 0).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
      return section('Due next 7 days', 'calendar', list.length ? (
        <>
          <ul className="flex flex-col divide-y divide-line text-[15px]">
            {list.slice(0, 8).map((b) => (
              <li key={b.id} className="flex items-center gap-3 py-1.5">
                <span className="w-16 shrink-0 text-sm text-muted">{new Date(`${b.dueDate}T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', day: 'numeric' })}</span>
                <span className="min-w-0 flex-1 truncate">{b.name}{b.stage === 'scheduled' ? <span className="text-muted"> (recurring)</span> : null}</span>
                <b className="num font-medium">{formatMoney(b.leftCents)}</b>
              </li>
            ))}
          </ul>
          <p className="flex justify-between border-t border-line pt-2 font-bold"><span>Total</span><span className="num">{formatMoney(list.reduce((a, b) => a + b.leftCents, 0))}</span></p>
        </>
      ) : <p className="text-muted">Nothing due in the next 7 days.</p>, '/app/bills');
    },
    spend: () => {
      if (!items) return null;
      const by = new Map<string, number>();
      for (const b of items.cur) by.set(b.name, (by.get(b.name) ?? 0) + b.amountCents);
      const rows = [...by.entries()].sort((a, b) => b[1] - a[1]);
      const top = rows.slice(0, 6).map(([label, cents]) => ({ label, cents }));
      const rest = rows.slice(6).reduce((a, r) => a + r[1], 0);
      if (rest) top.push({ label: `${rows.length - 6} others`, cents: rest });
      return section(`Spend by vendor · ${monthName}`, 'bills', rows.length ? (
        <>
          <p><span className="num text-[24px] font-medium">{money0(billMonth!.total)}</span> <span className="text-sm text-muted">{items.cur.length} bills, {rows.length} vendors</span></p>
          {hbars(top)}
        </>
      ) : <p className="text-muted">No bills this month yet.</p>, '/app/bills');
    },
    lySpend: () => lySpend ? section('Spend vs last year', 'bills', kv([
      [`${shortMonth(lym)} bills`, lySpend.lastYearMonth === null ? '—' : money0(lySpend.lastYearMonth)],
      [`${shortMonth(ym)} bills`, <>{money0(lySpend.month)} <Pct v={pct(lySpend.month, lySpend.lastYearMonth)} /></>],
      [`${ym.slice(0, 4)} so far`, money0(lySpend.ytd)],
      [`Same months ${+ym.slice(0, 4) - 1}`, <>{money0(lySpend.lastYtd)} <Pct v={pct(lySpend.ytd, lySpend.lastYtd)} /></>],
    ])) : null,
    trend: () => months ? <Card><TrendChart points={trend12(ym, months, projected)} /></Card> : null,
  };

  const out: ReactNode[] = [];
  let halves: ReactNode[] = [];
  const flush = () => {
    for (let k = 0; k < halves.length; k += 2) out.push(<div key={`pair${out.length}`} className="grid grid-cols-2 gap-3">{halves[k]}{halves[k + 1] ?? null}</div>);
    halves = [];
  };
  for (const id of layout) {
    const r = T[id]();
    if (!r) continue;
    if (typeof r === 'object' && r !== null && 'node' in (r as object)) { halves.push(<div key={id} className="contents">{(r as { node: ReactNode }).node}</div>); continue; }
    flush();
    out.push(<div key={id} className="contents">{r as ReactNode}</div>);
  }
  flush();

  return (
    <>
      {head}
      {out}
      <Link href="/app/customize" className="self-center rounded-full bg-card px-4 py-2 text-sm font-semibold text-accent-strong shadow-[var(--shadow-card)]">
        <Icon k="repeat" className="mr-1.5 inline size-4" />Customize this page
      </Link>
      {steps.length > 0 && (
        <Card>
          <h2 className="text-lg font-bold">Get set up</h2>
          <ol className="mt-3 flex flex-col gap-2">
            {steps.map((s) => (
              <li key={s.label} className="flex items-center justify-between gap-3 rounded-xl bg-soft px-4 py-3">
                <Link href={s.href} className="font-semibold hover:underline">{s.label}</Link>
                {s.done ? <Badge tone="good">Done</Badge> : <Badge>To do</Badge>}
              </li>
            ))}
          </ol>
        </Card>
      )}
      {layout.length === 0 && <Notice>Your Overview is empty. <Link href="/app/customize" className="font-semibold underline">Add some boxes</Link>.</Notice>}
    </>
  );
}

const addMonthEnd = (ym: string) => `${ym}-${daysIn(ym)}`;
const addDaysIso = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const shortMonth = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', year: 'numeric' });

/** Month / week / last week / 30 days / this year / last year / custom (#108). */
function RangeBar({ range, today }: { range: ReturnType<typeof rangeFor>; today: string }) {
  const cur = range?.key ?? '';
  return (
    <div className="flex flex-col gap-2">
      <nav aria-label="Date range" className="flex gap-1.5 overflow-x-auto pb-1">
        {RANGES.filter(([k]) => k !== 'custom').map(([k, label]) => (
          <Link key={k} href={k ? `/app?r=${k}` : '/app'} aria-current={cur === k ? 'page' : undefined}
            className={cx('whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-semibold', cur === k ? 'bg-ink text-paper' : 'bg-card text-ink shadow-[var(--shadow-card)]')}>{label}</Link>
        ))}
      </nav>
      <form action="/app" className="flex flex-wrap items-end gap-2" aria-label="Custom dates">
        <input type="hidden" name="r" value="custom" />
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted">From
          <input type="date" name="from" defaultValue={range?.from ?? addDaysIso(today, -29)} max={today} className="rounded-[10px] border border-line bg-card px-2.5 py-1.5 text-sm text-ink" />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted">To
          <input type="date" name="to" defaultValue={range?.to ?? today} className="rounded-[10px] border border-line bg-card px-2.5 py-1.5 text-sm text-ink" />
        </label>
        <button className={cx('rounded-full px-3.5 py-1.5 text-sm font-semibold', cur === 'custom' ? 'bg-ink text-paper' : 'bg-card shadow-[var(--shadow-card)]')}>Custom</button>
        {range && <span className="text-sm text-muted">{daysBetween(range.from, range.to) + 1} days</span>}
      </form>
    </div>
  );
}
