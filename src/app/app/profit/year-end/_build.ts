import 'server-only';
import { can, getSupabase, type OrgContext } from '@/lib/auth/context';
import { pageAll } from '@/lib/page-all';
import type { YearEndInput } from '@/lib/reports/year-end';
import { loadMonths } from '../../sales/history/_load';
import { loadProfitYear } from '../_data';

/** Everything the year-end workbook needs, limited to what this person may see (each sheet needs its own permission). */
export async function yearEndData(ctx: OrgContext, year: number): Promise<YearEndInput> {
  const sb = await getSupabase();
  const from = `${year}-01-01`, to = `${year}-12-31`;
  const org = ctx.org.id;
  const seeSales = can(ctx, 'sales.view'), seeBills = can(ctx, 'bills.view'), seePay = can(ctx, 'payroll.view'), seeProfit = can(ctx, 'profit.view'), seeBank = can(ctx, 'bank.view');
  const [profit, sales, vendors, locs] = await Promise.all([
    seeProfit ? loadProfitYear(ctx, year) : null,
    seeSales ? loadMonths(ctx, 1, year) : null,
    seeBills ? pageAll<{ id: string; name: string }>((a, b) => sb.from('vendors').select('id, name').eq('organization_id', org).order('id').range(a, b)) : [],
    sb.rpc('my_locations', { p_org: org }),
  ]);
  const out: YearEndInput = { year, businessName: ctx.org.name };
  if (profit && sales) {
    const s = new Map(sales.months.map((m) => [m.ym, m]));
    out.months = profit.months.map((m) => ({ ym: m.ym, sales: m.sales ?? 0, tax: m.tax, cash: s.get(m.ym)?.cash ?? 0, card: s.get(m.ym)?.card ?? 0, points: s.get(m.ym)?.points ?? 0,
      bills: m.bills, payroll: m.payroll, balancesIn: m.balancesIn, balancesOut: m.balancesOut, profit: m.profit, manual: m.manual !== null }));
  }
  if (seeBills) {
    const vName = new Map(vendors.map((v) => [v.id, v.name]));
    const bills = await pageAll<{ vendor_id: string; bill_number: string; bill_date: string; due_date: string; status: string; total_cents: number; paid_cents: number }>((a, b) =>
      sb.from('bills').select('id, vendor_id, bill_number, bill_date, due_date, status, total_cents, paid_cents').eq('organization_id', org).gte('due_date', from).lte('due_date', to).order('id').range(a, b), 50);
    out.bills = bills.map((b) => ({ ...b, vendor: vName.get(b.vendor_id) ?? 'Vendor' }));
  }
  if (seePay) {
    const runs = await pageAll<{ id: string; pay_date: string; period_start: string; period_end: string; voided_at: string | null }>((a, b) =>
      sb.from('pay_runs').select('id, pay_date, period_start, period_end, voided_at').eq('organization_id', org).gte('pay_date', from).lte('pay_date', to).order('id').range(a, b));
    const lines: { run_id: string; employee_id: string; hours: number; overtime_hours: number; gross_cents: number; bonus_cents: number; employer_tax_cents: number; advance_cents: number; net_cents: number }[] = [];
    for (let i = 0; i < runs.length; i += 100) {
      lines.push(...await pageAll<(typeof lines)[number]>((a, b) => sb.from('pay_run_lines').select('id, run_id, employee_id, hours, overtime_hours, gross_cents, bonus_cents, employer_tax_cents, advance_cents, net_cents')
        .eq('organization_id', org).in('run_id', runs.slice(i, i + 100).map((r) => r.id)).order('id').range(a, b)));
    }
    const emps = await pageAll<{ id: string; name: string }>((a, b) => sb.from('employees').select('id, name').eq('organization_id', org).order('id').range(a, b));
    const eName = new Map(emps.map((e) => [e.id, e.name])), runBy = new Map(runs.map((r) => [r.id, r]));
    const live = lines.filter((l) => !runBy.get(l.run_id)?.voided_at);
    out.payLines = live.map((l) => ({ ...l, employee: eName.get(l.employee_id) ?? 'Employee', pay_date: runBy.get(l.run_id)!.pay_date }));
    out.runs = runs.map((r) => {
      const ls = lines.filter((l) => l.run_id === r.id);
      return { pay_date: r.pay_date, period_start: r.period_start, period_end: r.period_end, voided: !!r.voided_at,
        gross_cents: ls.reduce((a, l) => a + Number(l.gross_cents), 0), employer_tax_cents: ls.reduce((a, l) => a + Number(l.employer_tax_cents), 0), net_cents: ls.reduce((a, l) => a + Number(l.net_cents), 0) };
    });
  }
  if (seeSales) {
    const store = new Map(((locs.data ?? []) as { id: string; name: string }[]).map((l) => [l.id, l.name]));
    const days = await pageAll<{ business_date: string; location_id: string; register: string; gross_sales_cents: number; discounts_cents: number; sales_tax_cents: number; cash_cents: number; card_cents: number; transaction_count: number | null }>((a, b) =>
      sb.from('sales_days').select('id, business_date, location_id, register, gross_sales_cents, discounts_cents, sales_tax_cents, cash_cents, card_cents, transaction_count')
        .eq('organization_id', org).is('voided_at', null).gte('business_date', from).lte('business_date', to).order('id').range(a, b), 60);
    out.days = days.map((d) => ({ date: d.business_date, store: store.get(d.location_id) ?? 'Store', register: d.register, net_cents: Number(d.gross_sales_cents) - Number(d.discounts_cents),
      tax_cents: Number(d.sales_tax_cents), cash_cents: Number(d.cash_cents), card_cents: Number(d.card_cents), transactions: d.transaction_count }));
  }
  if (seeProfit) {
    const [{ data: ps }, { data: ds }] = await Promise.all([
      sb.from('partners').select('id, name, pct, is_active').eq('organization_id', org).order('sort'),
      sb.from('distributions').select('id').eq('organization_id', org).gte('dist_date', from).lte('dist_date', to).limit(1000),
    ]);
    if ((ps ?? []).length) {
      const ids = (ds ?? []).map((d) => d.id as string);
      const shares = ids.length ? (await sb.from('distribution_shares').select('id, partner_id, share_cents').eq('organization_id', org).in('distribution_id', ids).limit(1000)).data ?? [] : [];
      const pays = shares.length ? (await sb.from('distribution_payments').select('share_id, amount_cents').eq('organization_id', org).in('share_id', shares.map((s) => s.id as string)).limit(1000)).data ?? [] : [];
      out.partners = (ps ?? []).filter((p) => p.is_active || shares.some((s) => s.partner_id === p.id)).map((p) => {
        const mine = shares.filter((s) => s.partner_id === p.id);
        return { name: p.name as string, pct: p.is_active ? Number(p.pct) : 0, distributed_cents: mine.reduce((a, s) => a + Number(s.share_cents), 0),
          paid_cents: pays.filter((x) => mine.some((s) => s.id === x.share_id)).reduce((a, x) => a + Number(x.amount_cents), 0) };
      });
    }
  }
  if (seeBank) {
    const lines = await pageAll<{ posted_on: string; amount_cents: number }>((a, b) => sb.from('bank_lines').select('id, posted_on, amount_cents').eq('organization_id', org).gte('posted_on', from).lte('posted_on', to).order('id').range(a, b), 60);
    const by = new Map<string, { out_cents: number; in_cents: number }>();
    for (const l of lines) { const k = l.posted_on.slice(0, 7), v = by.get(k) ?? { out_cents: 0, in_cents: 0 }; if (Number(l.amount_cents) < 0) v.out_cents -= Number(l.amount_cents); else v.in_cents += Number(l.amount_cents); by.set(k, v); }
    if (by.size) out.bankByMonth = [...by].sort().map(([ym, v]) => ({ ym, ...v }));
  }
  return out;
}
