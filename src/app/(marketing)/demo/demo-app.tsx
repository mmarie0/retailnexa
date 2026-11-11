'use client';
import { useMemo, useState } from 'react';
import { KpiTile } from '@/components/data/kpi-tile';
import { TrendChart } from '@/components/data/trend-chart';
import { DataTable } from '@/components/data/data-table';
import { Badge, Card, Input, Select, cx, buttonClass } from '@/components/ui';
import { averageTicketCents, comparableDate, computeProfit, pctChange, projectMonthEnd, sumRange } from '@/lib/finance/metrics';
import { stepQuantity, validateQuantity } from '@/lib/wholesale/quantity';
import { formatMoney } from '@/lib/billing/plans';
import {
  DEMO_BUSINESS, DEMO_CATALOG, DEMO_COGS_RATIO, DEMO_INVENTORY, DEMO_MONTHLY_OPEX, DEMO_VENDORS, DEMO_WHOLESALE_CUSTOMER,
  demoDailySales, demoInvoices, type DemoInvoice,
} from '@/demo/data';

const money = (c: number) => formatMoney(c);
const shortMoney = (c: number) => (c >= 100_000_00 ? `$${Math.round(c / 100_000)}k` : c >= 1_000_00 ? `$${(c / 100_000).toFixed(1)}k` : `$${Math.round(c / 100)}`);
const DAY = 86_400_000;
const addDays = (d: string, n: number) => new Date(new Date(`${d}T00:00:00Z`).getTime() + n * DAY).toISOString().slice(0, 10);
const fmtDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const LOCATION_SHARE: Record<string, number> = { all: 1, 'Harbor Street': 0.58, 'Westgate Plaza': 0.42 };

const TABS = ['Dashboard', 'Vendors', 'Bills & invoices', 'Inventory', 'Wholesale order'] as const;
type Tab = (typeof TABS)[number];
type Account = 'retail' | 'wholesale';
/** Inventory and price-increase alerts are wholesale features; retail accounts don't have them. */
const TABS_FOR: Record<Account, readonly Tab[]> = {
  retail: ['Dashboard', 'Vendors', 'Bills & invoices'],
  wholesale: TABS,
};

export function DemoApp({ anchor }: { anchor: string }) {
  const [account, setAccount] = useState<Account>('retail');
  const [tab, setTab] = useState<Tab>('Dashboard');
  const tabs = TABS_FOR[account];
  const pick = (a: Account) => { setAccount(a); if (!TABS_FOR[a].includes(tab)) setTab('Dashboard'); };
  return (
    <div className="rounded-[22px] border border-line bg-paper p-3 sm:p-5">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span className="text-sm font-semibold text-muted" id="demo-account">Account type</span>
        <div role="radiogroup" aria-labelledby="demo-account" className="inline-flex rounded-full bg-soft p-1">
          {(['retail', 'wholesale'] as const).map((a) => (
            <button key={a} type="button" role="radio" aria-checked={account === a} onClick={() => pick(a)}
              className={cx('rounded-full px-4 py-1.5 text-sm font-semibold', account === a ? 'bg-accent text-white' : 'text-muted hover:text-ink')}>
              {a === 'retail' ? 'Retail store' : 'Wholesale'}
            </button>
          ))}
        </div>
      </div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="font-bold">{DEMO_BUSINESS.name} <span className="font-normal text-muted">— fictional sample {account === 'retail' ? 'retail' : 'wholesale'} data</span></p>
        <div role="tablist" aria-label="Demo sections" className="flex flex-wrap gap-1 rounded-[18px] bg-soft p-1">
          {tabs.map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={cx('whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-semibold', tab === t ? 'bg-card text-ink shadow-[var(--shadow-card)]' : 'text-muted hover:text-ink')}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
      <div role="tabpanel" aria-label={tab}>
        {tab === 'Dashboard' && <Dashboard anchor={anchor} account={account} />}
        {tab === 'Vendors' && <Vendors anchor={anchor} account={account} />}
        {tab === 'Bills & invoices' && <Invoices anchor={anchor} />}
        {account === 'wholesale' && tab === 'Inventory' && <Inventory />}
        {account === 'wholesale' && tab === 'Wholesale order' && <OrderBuilder />}
      </div>
    </div>
  );
}

function compare(cur: number, prev: number, suffix: string) {
  const p = pctChange(cur, prev);
  if (p === null) return null;
  return { text: `${p > 0 ? '+' : ''}${p}% ${suffix}`, direction: p > 0.05 ? 'up' : p < -0.05 ? 'down' : 'flat' } as const;
}

function Dashboard({ anchor, account }: { anchor: string; account: Account }) {
  const [location, setLocation] = useState<'all' | 'Harbor Street' | 'Westgate Plaza'>('all');
  const [day, setDay] = useState<'today' | 'yesterday'>('today');
  const share = LOCATION_SHARE[location];
  const sales = useMemo(
    () => demoDailySales(anchor).map((s) => ({ ...s, salesCents: Math.round(s.salesCents * share), transactions: Math.round(s.transactions * share) })),
    [anchor, share],
  );
  const invoices = useMemo(() => demoInvoices(anchor), [anchor]);

  const focus = day === 'today' ? anchor : addDays(anchor, -1);
  const byDate = new Map(sales.map((s) => [s.date, s]));
  const f = byDate.get(focus)!;
  const fPrev = byDate.get(comparableDate(focus));
  const monthStart = `${anchor.slice(0, 8)}01`;
  const mtd = sumRange(sales, monthStart, anchor);
  const mtdPrev = sumRange(sales, comparableDate(monthStart), comparableDate(anchor));
  const projection = projectMonthEnd(sales, anchor);
  const lastMonthEnd = addDays(monthStart, -1);
  const lastMonth = sumRange(sales, `${lastMonthEnd.slice(0, 8)}01`, lastMonthEnd);
  const lastMonthName = new Date(`${lastMonthEnd}T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long' });

  const daysElapsed = Number(anchor.slice(8, 10));
  const daysInMonth = new Date(Date.UTC(Number(anchor.slice(0, 4)), Number(anchor.slice(5, 7)), 0)).getUTCDate();
  const prorate = daysElapsed / daysInMonth;
  const opex = Object.fromEntries(Object.entries(DEMO_MONTHLY_OPEX).map(([k, v]) => [k, Math.round(v * share * prorate)]));
  const profit = computeProfit({ netSalesCents: mtd.salesCents, cogsCents: Math.round(mtd.salesCents * DEMO_COGS_RATIO), operatingExpensesCents: opex });

  const dueSoon = invoices.filter((i) => i.paidCents < i.totalCents && i.dueDate <= addDays(anchor, 7));
  const vendorBalance = DEMO_VENDORS.reduce((a, v) => a + v.balanceCents, 0);
  const inventoryValue = DEMO_INVENTORY.filter((i) => location === 'all' || i.location === location).reduce((a, i) => a + i.onHand * i.costCents, 0);

  const last30 = sales.slice(-30).map((s) => ({ label: fmtDay(s.date), current: s.salesCents, previous: byDate.get(comparableDate(s.date))?.salesCents ?? null }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-3">
        <Select aria-label="Location" value={location} onChange={(e) => setLocation(e.target.value as typeof location)} className="w-auto">
          <option value="all">All locations (consolidated)</option>
          {DEMO_BUSINESS.locations.map((l) => <option key={l} value={l}>{l}</option>)}
        </Select>
        <div className="inline-flex rounded-[10px] border border-line bg-card p-1">
          {(['today', 'yesterday'] as const).map((d) => (
            <button key={d} aria-pressed={day === d} onClick={() => setDay(d)} className={cx('rounded-lg px-3 py-1.5 text-sm font-semibold', day === d ? 'bg-ink text-white' : 'text-muted')}>
              {d === 'today' ? 'Today' : 'Yesterday'}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile size="lg" tone="indigo" label={`${day === 'today' ? 'Today' : 'Yesterday'}, ${fmtDay(focus)}`} value={money(f.salesCents)}
          comparison={fPrev ? compare(f.salesCents, fPrev.salesCents, `vs same weekday last year`) : null} />
        <KpiTile size="lg" tone="blue" label="Month to date" value={money(mtd.salesCents)} comparison={compare(mtd.salesCents, mtdPrev.salesCents, 'vs last year')} />
        <KpiTile size="lg" tone="lav" label="Projected month-end" value={projection ? money(projection.projectedCents) : '—'}
          footnote={projection ? `Estimate from ${projection.basisDays} days of weekday averages` : 'Needs 7+ days of sales'} />
        <KpiTile size="lg" tone="coral" label="Bills due in 7 days" value={money(dueSoon.reduce((a, i) => a + i.totalCents - i.paidCents, 0))} footnote={`${dueSoon.length} open invoice${dueSoon.length === 1 ? '' : 's'}`} />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {/* RetailNexa isn't a POS: transactions and average sale come from the monthly sales report the store uploads at month end. */}
        <KpiTile label={`${lastMonthName} report: transactions`} value={lastMonth.transactions.toLocaleString('en-US')} footnote="From the monthly sales report you upload at month end (coming soon)" />
        <KpiTile label={`${lastMonthName} report: average sale`} value={money(averageTicketCents(lastMonth.salesCents, lastMonth.transactions) ?? 0)} footnote={`${money(lastMonth.salesCents)} in sales that month`} />
        {account === 'wholesale'
          ? <KpiTile label="Inventory value (at cost)" value={money(inventoryValue)} footnote={`Vendor balances owed: ${money(vendorBalance)}`} />
          : <KpiTile label="Vendor balances owed" value={money(vendorBalance)} footnote={`${DEMO_VENDORS.length} vendors`} />}
      </div>

      <Card>
        <TrendChart title="Daily sales, last 30 days" points={last30} currentLabel="This year" previousLabel="Same weekday last year" format={shortMoney} />
      </Card>

      <Card>
        <h3 className="font-bold">Profit, month to date</h3>
        <dl className="mt-3 grid gap-x-8 gap-y-1.5 text-[15px] sm:grid-cols-2">
          {[
            ['Net sales', profit.netSalesCents],
            ['Cost of goods sold', -Math.round(mtd.salesCents * DEMO_COGS_RATIO)],
            ['Gross profit', profit.grossProfitCents, `${profit.grossMarginPct}% margin`],
            ['Operating expenses (prorated)', -profit.operatingExpensesCents],
            ['Operating profit', profit.operatingProfitCents],
          ].map(([k, v, note]) => (
            <div key={k as string} className="flex justify-between gap-4 border-b border-line py-1.5">
              <dt className={cx((k as string).includes('profit') && 'font-semibold')}>{k}{note && <span className="ms-2 text-sm text-muted">{note}</span>}</dt>
              <dd className="num">{money(v as number)}</dd>
            </div>
          ))}
        </dl>
        {!profit.netIncomeComplete && (
          <p className="mt-3 text-sm text-muted">
            Net income isn’t shown because taxes, interest and other non-operating items haven’t been entered. RetailNexa only labels a figure “net income” when every expense is accounted for.
          </p>
        )}
      </Card>
    </div>
  );
}

function Vendors({ anchor, account }: { anchor: string; account: Account }) {
  const [selected, setSelected] = useState(DEMO_VENDORS[0].id);
  const v = DEMO_VENDORS.find((x) => x.id === selected)!;
  const invoices = demoInvoices(anchor).filter((i) => i.vendorId === v.id);
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.1fr]">
      <DataTable
        caption="Vendors"
        rows={DEMO_VENDORS}
        rowKey={(r) => r.id}
        activeKey={selected}
        onRowClick={(r) => setSelected(r.id)}
        columns={[
          { key: 'name', header: 'Vendor', cell: (r) => r.name },
          { key: 'terms', header: 'Terms', cell: (r) => r.terms, hideOnMobile: true },
          { key: 'bal', header: 'Balance', cell: (r) => money(r.balanceCents), align: 'right' },
        ]}
      />
      <Card className="flex flex-col gap-4">
        <div>
          <h3 className="text-xl font-bold">{v.name}</h3>
          <p className="text-muted">{v.legalName}</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <KpiTile label="Outstanding" value={money(v.balanceCents)} />
          <KpiTile label="Credit limit" value={money(v.creditLimitCents)} />
          <KpiTile label="Spent this year" value={money(v.ytdCents)} />
          <KpiTile label="Spent all time" value={money(v.allTimeCents)} />
        </div>
        <div>
          <p className="text-sm font-semibold">Names on bank statements</p>
          <div className="mt-1 flex flex-wrap gap-1.5">{v.aliases.map((a) => <Badge key={a}>{a}</Badge>)}</div>
        </div>
        <p className="text-[15px]">{v.terms} · {v.contact.name} · {v.contact.phone}</p>
        {account === 'wholesale' && v.priceAlerts.length > 0 && (
          <div className="rounded-xl bg-soon-soft p-3 text-soon">
            <p className="font-semibold">Price increase flagged</p>
            {v.priceAlerts.map((p) => (
              <p key={p.item} className="num text-sm">{p.item}: {money(p.fromCents)} → {money(p.toCents)} (+{pctChange(p.toCents, p.fromCents)}%)</p>
            ))}
          </div>
        )}
        <div>
          <p className="text-sm font-semibold">Recent invoices</p>
          {invoices.length ? invoices.map((i) => (
            <p key={i.id} className="num flex justify-between border-b border-line py-1.5 text-[15px]"><span>{i.number} · {fmtDay(i.date)}</span>{money(i.totalCents)}</p>
          )) : <p className="text-muted">No invoices in this period.</p>}
        </div>
      </Card>
    </div>
  );
}

function invoiceStatus(i: DemoInvoice, anchor: string): { label: string; tone: 'good' | 'warning' | 'danger' | 'info' } {
  if (i.paidCents >= i.totalCents) return { label: 'Paid', tone: 'good' };
  if (i.dueDate < anchor) return { label: 'Overdue', tone: 'danger' };
  if (i.paidCents > 0) return { label: 'Partly paid', tone: 'info' };
  if (i.dueDate <= addDays(anchor, 7)) return { label: 'Due soon', tone: 'warning' };
  return { label: 'Open', tone: 'info' };
}

function Invoices({ anchor }: { anchor: string }) {
  const invoices = demoInvoices(anchor);
  const [open, setOpen] = useState<string | null>(invoices[0].id);
  const inv = invoices.find((i) => i.id === open);
  const vendorName = (id: string) => DEMO_VENDORS.find((v) => v.id === id)?.name ?? '';
  return (
    <div className="flex flex-col gap-4">
      <DataTable
        caption="Vendor invoices"
        rows={invoices}
        rowKey={(r) => r.id}
        activeKey={open}
        onRowClick={(r) => setOpen(r.id)}
        columns={[
          { key: 'n', header: 'Invoice', cell: (r) => r.number },
          { key: 'v', header: 'Vendor', cell: (r) => vendorName(r.vendorId) },
          { key: 'd', header: 'Due', cell: (r) => fmtDay(r.dueDate) },
          { key: 's', header: 'Status', cell: (r) => { const s = invoiceStatus(r, anchor); return <Badge tone={s.tone}>{s.label}</Badge>; } },
          { key: 't', header: 'Balance', cell: (r) => money(r.totalCents - r.paidCents), align: 'right' },
        ]}
      />
      {inv && (
        <Card>
          <h3 className="font-bold">{inv.number} — {vendorName(inv.vendorId)}</h3>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[560px] text-[15px]">
              <thead className="text-start text-sm text-muted"><tr><th className="py-1.5">SKU</th><th>UPC</th><th>Item</th><th className="text-end">Qty</th><th className="text-end">Unit</th><th className="text-end">Total</th></tr></thead>
              <tbody>
                {inv.lines.map((l) => (
                  <tr key={l.sku} className="border-t border-line">
                    <td className="py-1.5">{l.sku}</td><td className="num">{l.upc}</td><td>{l.description}</td>
                    <td className="num text-end">{l.qty}</td><td className="num text-end">{money(l.unitCents)}</td><td className="num text-end">{money(l.qty * l.unitCents)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr className="border-t border-line font-semibold"><td colSpan={5} className="py-1.5">Total · paid {money(inv.paidCents)}</td><td className="num text-end">{money(inv.totalCents)}</td></tr></tfoot>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function Inventory() {
  const [q, setQ] = useState('');
  const [dept, setDept] = useState('all');
  const [lowOnly, setLowOnly] = useState(false);
  const depts = [...new Set(DEMO_INVENTORY.map((i) => i.department))];
  const term = q.trim().toLowerCase().replace(/\s/g, '');
  const rows = DEMO_INVENTORY.filter((i) =>
    (dept === 'all' || i.department === dept) &&
    (!lowOnly || i.onHand <= i.reorderPoint) &&
    (!term || i.name.toLowerCase().replace(/\s/g, '').includes(term) || i.sku.toLowerCase().includes(term) || i.upc.includes(term)));
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-3">
        <Input aria-label="Search by name, SKU or UPC" placeholder="Search name, SKU or scan a UPC" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
        <Select aria-label="Department" value={dept} onChange={(e) => setDept(e.target.value)} className="w-auto">
          <option value="all">All departments</option>
          {depts.map((d) => <option key={d}>{d}</option>)}
        </Select>
        <label className="inline-flex items-center gap-2 text-[15px] font-medium"><input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} className="size-4 accent-[#3f63de]" /> Low stock only</label>
      </div>
      {rows.length === 0 ? <p className="rounded-xl bg-card p-6 text-center text-muted">No items match. Try a different search or department.</p> : (
        <DataTable
          caption="Inventory"
          rows={rows}
          rowKey={(r) => r.sku}
          columns={[
            { key: 'n', header: 'Item', cell: (r) => r.name },
            { key: 'sku', header: 'SKU', cell: (r) => r.sku, hideOnMobile: true },
            { key: 'loc', header: 'Location', cell: (r) => r.location },
            { key: 'oh', header: 'On hand', cell: (r) => r.onHand, align: 'right' },
            { key: 'margin', header: 'Margin', cell: (r) => `${Math.round(((r.priceCents - r.costCents) / r.priceCents) * 100)}%`, align: 'right', hideOnMobile: true },
            { key: 'flag', header: 'Status', cell: (r) => r.onHand === 0 ? <Badge tone="danger">Out of stock</Badge> : r.onHand <= r.reorderPoint ? <Badge tone="warning">Reorder</Badge> : r.lastSoldDaysAgo > 90 ? <Badge>Aged {r.lastSoldDaysAgo}d</Badge> : <Badge tone="good">OK</Badge> },
          ]}
        />
      )}
    </div>
  );
}

function OrderBuilder() {
  const [q, setQ] = useState('');
  const [qty, setQty] = useState<Record<string, number>>({});
  const [variant, setVariant] = useState<Record<string, string>>({});
  const [placed, setPlaced] = useState(false);
  const term = q.trim().toLowerCase();
  const items = DEMO_CATALOG.filter((i) => !term || i.name.toLowerCase().includes(term) || i.upc.includes(term) || i.brand.toLowerCase().includes(term));
  const lines = DEMO_CATALOG.filter((i) => (qty[i.sku] ?? 0) > 0);
  const total = lines.reduce((a, i) => a + i.priceCents * qty[i.sku], 0);
  const invalid = lines.some((i) => !validateQuantity(qty[i.sku], i.rule).ok);
  const overCredit = DEMO_WHOLESALE_CUSTOMER.openBalanceCents + total > DEMO_WHOLESALE_CUSTOMER.creditLimitCents;

  if (placed) {
    return (
      <Card className="text-center">
        <p className="text-xl font-bold">Order placed (demo)</p>
        <p className="mt-1 text-muted">In the real app this goes to the warehouse for approval and picking. Nothing was sent.</p>
        <button className={cx(buttonClass('secondary'), 'mt-4')} onClick={() => { setPlaced(false); setQty({}); }}>Start a new order</button>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
      <div className="flex flex-col gap-3">
        <p className="text-[15px]">Ordering for <strong>{DEMO_WHOLESALE_CUSTOMER.name}</strong> · {DEMO_WHOLESALE_CUSTOMER.tier} pricing · {DEMO_WHOLESALE_CUSTOMER.terms}</p>
        <Input aria-label="Search catalog" placeholder="Search by name, brand or UPC" value={q} onChange={(e) => setQ(e.target.value)} />
        {items.map((i) => {
          const value = qty[i.sku] ?? 0;
          const check = validateQuantity(value, i.rule);
          return (
            <Card key={i.sku} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-48 flex-1">
                <p className="font-semibold">{i.name}</p>
                <p className="text-sm text-muted">{i.brand} · UPC {i.upc} · {i.available.toLocaleString()} available</p>
                <p className="num text-sm"><strong>{money(i.priceCents)}</strong> <span className="text-muted line-through">{money(i.listCents)}</span> · sold in {i.rule.increment}s, min {i.rule.min}</p>
              </div>
              {i.variants.length > 1 && (
                <Select aria-label={`${i.name} colour`} value={variant[i.sku] ?? i.variants[0]} onChange={(e) => setVariant({ ...variant, [i.sku]: e.target.value })} className="w-auto">
                  {i.variants.map((v) => <option key={v}>{v}</option>)}
                </Select>
              )}
              <div className="flex flex-col items-start gap-1 sm:items-end">
                <div className="inline-flex items-center rounded-[10px] border border-line">
                  <button aria-label={`Fewer ${i.name}`} className="px-3 py-2 text-lg font-bold" onClick={() => setQty({ ...qty, [i.sku]: stepQuantity(value, -1, i.rule) })}>−</button>
                  <input
                    aria-label={`${i.name} quantity`}
                    inputMode="numeric"
                    className="num w-14 border-x border-line py-2 text-center"
                    value={value}
                    onChange={(e) => setQty({ ...qty, [i.sku]: Number(e.target.value.replace(/\D/g, '')) || 0 })}
                  />
                  <button aria-label={`More ${i.name}`} className="px-3 py-2 text-lg font-bold" onClick={() => setQty({ ...qty, [i.sku]: stepQuantity(value, 1, i.rule) })}>+</button>
                </div>
                {!check.ok && (
                  <p className="text-sm text-late" role="alert">
                    {check.reason}{check.suggestion !== null && <> <button className="font-semibold underline" onClick={() => setQty({ ...qty, [i.sku]: check.suggestion! })}>Use {check.suggestion}</button></>}
                  </p>
                )}
              </div>
            </Card>
          );
        })}
      </div>
      <Card className="h-fit lg:sticky lg:top-20">
        <h3 className="font-bold">Order summary</h3>
        {lines.length === 0 ? <p className="mt-2 text-muted">Add items to start an order.</p> : (
          <ul className="mt-2">
            {lines.map((i) => (
              <li key={i.sku} className="num flex justify-between gap-3 border-b border-line py-1.5 text-[15px]">
                <span>{qty[i.sku]} × {i.name}{i.variants.length > 1 && ` (${variant[i.sku] ?? i.variants[0]})`}</span>
                <span>{money(qty[i.sku] * i.priceCents)}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="num mt-3 flex justify-between text-lg font-bold"><span>Total</span>{money(total)}</p>
        <p className="num mt-1 text-sm text-muted">Open balance {money(DEMO_WHOLESALE_CUSTOMER.openBalanceCents)} of {money(DEMO_WHOLESALE_CUSTOMER.creditLimitCents)} credit limit</p>
        {overCredit && <p className="mt-2 text-sm text-late">This order would exceed the credit limit and will need approval.</p>}
        <button className={cx(buttonClass('primary'), 'mt-4 w-full')} disabled={!lines.length || invalid} onClick={() => setPlaced(true)}>
          {overCredit ? 'Submit for approval' : 'Place order'}
        </button>
        {invalid && <p className="mt-2 text-sm text-late">Fix quantities marked in red first.</p>}
      </Card>
    </div>
  );
}
