import type { Metadata } from 'next';
import Link from 'next/link';
import { can, getOrgContext, getSupabase } from '@/lib/auth/context';
import { Badge, Card } from '@/components/ui';
import { ROLE_LABELS } from '@/lib/auth/permissions';
import { formatMoney } from '@/lib/billing/plans';
import { todayIn } from '@/lib/time';
import { salesWindows, summarizeBills, summarizeSales } from '@/lib/dashboard/summary';
import { incomeStatement, type LedgerRow } from '@/lib/accounting/statements';
import { budgetFor, daysInMonth, monthItems, totals, type BillRow, type Budget, type TemplateRow } from '@/lib/bills/due';
import { DailySalesChart } from './_dashboard/daily-sales-chart';
import { Change, Stat } from './_dashboard/tiles';

export const metadata: Metadata = { title: 'Overview' };

export default async function OverviewPage() {
  const ctx = await getOrgContext();
  const supabase = await getSupabase();
  const [{ count: locations }, { count: members }, { data: announcements }, { data: orgRow }] = await Promise.all([
    supabase.from('locations').select('id', { count: 'exact', head: true }).eq('organization_id', ctx.org.id).eq('is_active', true),
    can(ctx, 'members.view')
      ? supabase.from('memberships').select('id', { count: 'exact', head: true }).eq('organization_id', ctx.org.id).eq('status', 'active')
      : Promise.resolve({ count: null }),
    supabase.from('announcements').select('id, title, body, severity, audience').order('starts_at', { ascending: false }).limit(3),
    supabase.from('organizations').select('timezone').eq('id', ctx.org.id).maybeSingle(),
  ]);
  const today = todayIn(orgRow?.timezone);
  const monthStart = `${today.slice(0, 8)}01`;
  const showSales = can(ctx, 'sales.view');
  const showBills = can(ctx, 'bills.view');
  const showProfit = can(ctx, 'accounting.view') || can(ctx, 'profit.view');
  const w = salesWindows(today);
  const salesSel = 'business_date, gross_sales_cents, discounts_cents, transaction_count';
  const ym = today.slice(0, 7);
  const [recent, lastYear, bills, activity, monthBills, tpls, budgetRows, vendorRows, seesAll] = await Promise.all([
    showSales ? supabase.from('sales_days').select(salesSel).eq('organization_id', ctx.org.id).is('voided_at', null)
      .gte('business_date', w.recent.from).lte('business_date', w.recent.to).limit(2000) : Promise.resolve({ data: null }),
    showSales ? supabase.from('sales_days').select(salesSel).eq('organization_id', ctx.org.id).is('voided_at', null)
      .gte('business_date', w.lastYear.from).lte('business_date', w.lastYear.to).limit(2000) : Promise.resolve({ data: null }),
    showBills ? supabase.from('bills').select('status, due_date, total_cents, paid_cents').eq('organization_id', ctx.org.id)
      .in('status', ['draft', 'approved']).limit(2000) : Promise.resolve({ data: null }),
    showProfit ? supabase.rpc('account_activity_detail', { p_org: ctx.org.id, p_from: monthStart, p_to: today }) : Promise.resolve({ data: null }),
    // "Bills this month" (#101): same numbers as the Due view.
    showBills ? supabase.from('bills').select('id, vendor_id, bill_number, bill_date, due_date, status, total_cents, paid_cents, recurring_bill_id')
      .eq('organization_id', ctx.org.id).neq('status', 'void').gte('due_date', monthStart).lte('due_date', `${ym}-${daysInMonth(ym)}`).limit(2000) : Promise.resolve({ data: null }),
    showBills ? supabase.from('recurring_bills').select('id, vendor_id, name, frequency, day_of_month, next_date, end_date, due_days, is_active, lines')
      .eq('organization_id', ctx.org.id).eq('is_active', true) : Promise.resolve({ data: null }),
    showBills ? supabase.from('bill_budgets').select('month, amount_cents').eq('organization_id', ctx.org.id) : Promise.resolve({ data: null }),
    showBills ? supabase.from('vendors').select('id, name, kind').eq('organization_id', ctx.org.id) : Promise.resolve({ data: null }),
    showBills ? supabase.rpc('sees_all_stores', { p_org: ctx.org.id }) : Promise.resolve({ data: false }),
  ]);
  const billMonth = showBills ? (() => {
    const templates = ((tpls.data ?? []) as (Omit<TemplateRow, 'amount_cents'> & { lines: { amount_cents: number }[] })[])
      .map(({ lines, ...t }) => ({ ...t, amount_cents: lines.reduce((a, l) => a + Number(l.amount_cents), 0) }));
    const items = monthItems(ym, (monthBills.data ?? []) as BillRow[], templates, new Map((vendorRows.data ?? []).map((v) => [v.id as string, v.name as string])), today);
    return { ...totals(items), budget: seesAll.data === true ? budgetFor(ym, (budgetRows.data ?? []) as Budget[])?.cents ?? null : null };
  })() : null;
  const salesRows = [...(recent.data ?? []), ...(lastYear.data ?? [])].map((r) => ({
    date: r.business_date as string, netCents: Number(r.gross_sales_cents) - Number(r.discounts_cents), transactions: r.transaction_count as number | null,
  }));
  const sales = showSales && (recent.data ?? []).length ? summarizeSales(salesRows, today) : null;
  const ap = showBills ? summarizeBills((bills.data ?? []).map((b) => ({
    status: b.status as string, dueDate: b.due_date as string, openCents: Number(b.total_cents) - Number(b.paid_cents),
  })), today) : null;
  // Same rows and builder as the Profit & loss page, so the tiles always agree with it (#47).
  const pl = showProfit && activity.data ? incomeStatement(((activity.data ?? []) as { account_id: string; code: string; name: string; type: LedgerRow['type']; role: string | null; net_cents: number }[])
    .map((r) => ({ id: r.account_id, code: r.code, name: r.name, type: r.type, role: r.role, net: Number(r.net_cents) }))) : null;
  const marginPct = pl && pl.revenue.total ? Math.round((pl.grossProfit / pl.revenue.total) * 10_000) / 100 : null;
  const monthName = new Date(`${today}T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long' });

  const steps = [
    { done: !!ctx.subscription, label: 'Choose a plan and start your trial', href: '/app/billing', show: can(ctx, 'billing.manage') },
    { done: (locations ?? 0) > 0, label: `Add your locations (${locations ?? 0} so far)`, href: '/app/settings/locations', show: can(ctx, 'locations.manage') },
    { done: (members ?? 0) > 1, label: 'Invite your team', href: '/app/settings/team', show: can(ctx, 'members.manage') },
    { done: false, label: 'Review what each role can see', href: '/help/roles-and-permissions', show: can(ctx, 'roles.manage') },
  ].filter((s) => s.show);
  const visibleAnnouncements = (announcements ?? []).filter((a) => !a.audience || a.audience === ctx.org.businessType || ctx.org.businessType === 'both');

  return (
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
      {sales && (
        <section aria-label="Sales" className="flex flex-col gap-3">
          <Stat hero block="blue" label={`${monthName} so far`} value={formatMoney(sales.monthToDate.netCents)} sub={<Change pct={sales.monthToDate.changePct} vs="last year" />} href="/app/sales" />
          <div className="grid grid-cols-3 gap-2.5 max-[520px]:grid-cols-1">
            <Stat label="Today" value={sales.today.netCents === null ? '—' : formatMoney(sales.today.netCents)} sub={sales.today.netCents === null ? 'Not recorded yet' : 'Net sales'} href="/app/sales" />
            <Stat label="Yesterday" value={sales.yesterday.netCents === null ? '—' : formatMoney(sales.yesterday.netCents)} sub={sales.yesterday.netCents === null ? 'Not recorded' : 'Net sales'} href="/app/sales" />
            <Stat label="Last 7 days" value={formatMoney(sales.last7.netCents)} sub={<Change pct={sales.last7.changePct} vs="prior week" />} />
          </div>
          <Card><DailySalesChart points={sales.daily} /></Card>
        </section>
      )}
      {showSales && !sales && can(ctx, 'sales.import') && ctx.access.canWrite && (
        <Card>
          <h2 className="text-lg font-bold">Bring in your sales</h2>
          <p className="mt-1 text-muted">Import your POS daily report or enter a day by hand to see sales here.</p>
          <Link href="/app/sales/import" className="mt-3 inline-block font-semibold text-accent-strong">Add sales</Link>
        </Card>
      )}
      {(ap || pl) && (
        <div className="grid grid-cols-2 gap-3">
          {ap && <Stat block="indigo" label="Bills to pay" value={formatMoney(ap.unpaidCents)} sub={ap.drafts ? `${ap.drafts} draft${ap.drafts === 1 ? '' : 's'} awaiting approval` : `${formatMoney(ap.dueNext7Cents)} due this week`} href="/app/bills" />}
          {ap && <Stat label="Overdue bills" value={formatMoney(ap.overdueCents)} tone={ap.overdueCents > 0 ? 'late' : undefined} sub={ap.overdueCount ? `${ap.overdueCount} bill${ap.overdueCount === 1 ? '' : 's'} past due` : 'Nothing overdue'} href="/app/bills" />}
          {pl && <Stat block="lav" label={`${monthName} gross profit`} value={formatMoney(pl.grossProfit)} href={can(ctx, 'accounting.view') ? '/app/accounting/profit-loss' : undefined}
            sub={pl.cogs.total === 0 && pl.revenue.total > 0 ? 'Cost of goods not tracked yet' : marginPct === null ? 'No sales yet' : `${marginPct.toFixed(2)}% margin`} />}
          {pl && <Stat label={`${monthName} operating profit`} value={formatMoney(pl.operatingProfit)} sub={`After ${formatMoney(pl.operatingExpenses.total)} expenses`} />}
        </div>
      )}
      {billMonth && billMonth.count > 0 && (() => {
        const b = billMonth, scale = Math.max(b.budget ?? 0, b.total) || 1;
        return (
          <Link href="/app/bills" className="flex flex-col gap-2 rounded-[18px] bg-card p-4 shadow-[var(--shadow-card)] hover:opacity-90">
            <span className="flex items-baseline justify-between gap-2">
              <span className="text-[11px] font-bold uppercase tracking-[.08em] text-muted">Bills this month</span>
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
      })()}
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
      <Card>
        <h2 className="text-lg font-bold">What’s next for RetailNexa</h2>
        <p className="mt-1 text-muted">Sales, bills and vendors (including recurring bills), bank reconciliation and bookkeeping (including cash flow) are live. Inventory and cost of goods and wholesale arrive in the next releases and will appear in the menu when they’re available to you.</p>
      </Card>
    </>
  );
}
