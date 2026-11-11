import type { Metadata } from 'next';
import Link from 'next/link';
import { can, getOrgContext, getSupabase } from '@/lib/auth/context';
import { Card, EmptyState, Notice, cx } from '@/components/ui';
import { formatMoney } from '@/lib/billing/plans';
import { todayIn } from '@/lib/time';
import { compareCategories, pctChange, type CategoryRow } from '@/lib/sales/history';
import { Stat } from '../../_dashboard/tiles';
import { CategoryUpload } from '../history/upload';

export const metadata: Metadata = { title: 'Categories' };
const ymAdd = (ym: string, n: number) => new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 1 + n, 1)).toISOString().slice(0, 7);
const label = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' });
const delta = (v: number | null) => v === null ? <span className="text-muted">—</span> : <span className={v >= 0 ? 'text-paid' : 'text-late'}>{v >= 0 ? '▲' : '▼'} {Math.abs(v).toFixed(1)}%</span>;

/** #112 Sales by category: upload a month's category report, compare with last month and last year. */
export default async function CategoriesPage({ searchParams }: PageProps<'/app/sales/categories'>) {
  const ctx = await getOrgContext();
  if (!can(ctx, 'sales.view')) return <Notice tone="warning">You don’t have access to sales.</Notice>;
  const sp = await searchParams;
  const supabase = await getSupabase();
  const [{ data: org }, { data: locs }] = await Promise.all([
    supabase.from('organizations').select('timezone').eq('id', ctx.org.id).maybeSingle(),
    supabase.rpc('my_locations', { p_org: ctx.org.id }),
  ]);
  const today = todayIn(org?.timezone);
  const { data: latest } = await supabase.from('category_sales').select('month').eq('organization_id', ctx.org.id).order('month', { ascending: false }).limit(1);
  const ym = typeof sp.m === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.m) ? sp.m : (latest?.[0]?.month?.slice(0, 7) ?? ymAdd(today.slice(0, 7), -1));
  const prev = ymAdd(ym, -1), ly = ymAdd(ym, -12);
  // Page in 1,000s (the API caps a single read at 1,000 rows); several stores × 3 months can pass that (#163).
  const data: { month: string; category: string; sales_cents: number; quantity: number | null }[] = [];
  let truncated = false;
  for (let page = 0; page < 30; page++) {
    const { data: part } = await supabase.from('category_sales').select('id, month, category, sales_cents, quantity').eq('organization_id', ctx.org.id)
      .in('month', [`${ym}-01`, `${prev}-01`, `${ly}-01`]).order('id').range(page * 1000, page * 1000 + 999);
    data.push(...(part ?? []));
    if (!part || part.length < 1000) break;
    if (page === 29) truncated = true;
  }
  const rows = data.map((r) => ({ ...r, month: String(r.month).slice(0, 7), sales_cents: Number(r.sales_cents), quantity: r.quantity === null ? null : Number(r.quantity) }));
  const of = (m: string) => rows.filter((r) => r.month === m) as CategoryRow[];
  const cmp = compareCategories(of(ym), of(prev), of(ly));
  const total = (m: string) => of(m).reduce((a, r) => a + r.sales_cents, 0);
  const t = total(ym), tp = total(prev), tl = total(ly);
  const max = Math.max(1, ...cmp.map((c) => c.cents));
  const editable = can(ctx, 'sales.import') && ctx.access.canWrite;

  return (
    <>
      <nav aria-label="Month" className="flex items-center justify-between gap-2">
        <Link href={`/app/sales/categories?m=${prev}`} aria-label="Previous month" className="grid size-10 place-items-center rounded-full bg-card text-lg shadow-[var(--shadow-card)]">‹</Link>
        <h1 className="text-[22px] font-bold tracking-tight">{label(ym)}</h1>
        <Link href={`/app/sales/categories?m=${ymAdd(ym, 1)}`} aria-label="Next month" className="grid size-10 place-items-center rounded-full bg-card text-lg shadow-[var(--shadow-card)]">›</Link>
      </nav>
      {truncated && <Notice tone="warning">This month has more category rows than one page can show, so totals may be short. Contact support.</Notice>}
      {editable && <Card><CategoryUpload stores={(locs ?? []) as { id: string; name: string }[]} month={ym} /></Card>}
      {cmp.length === 0 ? <EmptyState title={`No category report for ${label(ym)}`}>Upload your POS’s category (or department) report for the month to see what sells and how it compares.</EmptyState> : (
        <>
          <div className="grid grid-cols-3 gap-2.5">
            <Stat block="blue" label="Category sales" value={formatMoney(t)} sub={`${cmp.filter((c) => c.cents).length} categories`} />
            <Stat label="vs last month" value={tp ? `${(pctChange(t, tp) ?? 0) >= 0 ? '+' : ''}${(pctChange(t, tp) ?? 0).toFixed(1)}%` : '—'} sub={tp ? formatMoney(tp) : 'No report'} />
            <Stat label="vs last year" value={tl ? `${(pctChange(t, tl) ?? 0) >= 0 ? '+' : ''}${(pctChange(t, tl) ?? 0).toFixed(1)}%` : '—'} sub={tl ? formatMoney(tl) : 'No report'} />
          </div>
          <Card className="overflow-x-auto p-0">
            <table className="w-full min-w-[720px] text-[14px]">
              <thead className="text-left"><tr><th className="px-4 py-2">Category</th><th className="px-2 text-right">Sales</th><th className="px-2">Share</th><th className="px-2 text-right">Qty</th><th className="px-2 text-right">vs {label(prev).split(' ')[0]}</th><th className="px-4 text-right">vs {ly.slice(0, 4)}</th></tr></thead>
              <tbody>{cmp.map((c) => (
                <tr key={c.category} className={cx('border-t border-line', !c.cents && 'text-muted')}>
                  <td className="px-4 py-2 font-semibold">{c.category}</td>
                  <td className="num px-2 text-right">{formatMoney(c.cents)}</td>
                  <td className="px-2"><span className="flex items-center gap-2"><span className="h-2 w-24 rounded bg-soft"><span className="block h-2 rounded bg-accent" style={{ width: `${(c.cents / max) * 100}%` }} /></span><span className="num text-xs">{c.sharePct === null ? '—' : `${c.sharePct.toFixed(1)}%`}</span></span></td>
                  <td className="num px-2 text-right">{c.qty ?? '—'}</td>
                  <td className="num px-2 text-right">{delta(c.vsPrevPct)}</td>
                  <td className="num px-4 text-right">{delta(c.vsLastYearPct)}</td>
                </tr>
              ))}</tbody>
            </table>
          </Card>
        </>
      )}
    </>
  );
}
