'use client';
import { useActionState, useMemo, useState } from 'react';
import { Badge, Button, Card, Field, FormMessage, Input, Select, Textarea, cx } from '@/components/ui';
import { initialActionState, type ActionState } from '@/lib/actions';
import { formatMoney } from '@/lib/billing/plans';
import { centsToInput, parseDollarsToCents } from '@/lib/money';
import { orderTotals, tierPrice } from '@/lib/wholesale/ledger';
import { useT } from '@/lib/i18n/client';

export interface BuilderCustomer { id: string; name: string; tierName: string | null; pct: number; taxExempt: boolean; terms: number; warnings: string[] }
export interface BuilderItem { id: string; name: string; sku: string | null; brand: string | null; category: string | null; price: number; free: number; casePack: number | null }
export interface CartLine { key: string; item_id: string | null; name: string; sku: string | null; qty: number; price_cents: number }
export interface BuilderInitial {
  id?: string; kind?: 'quote' | 'order'; customer_id?: string; lines?: CartLine[]; discount?: number; shipping?: number; tax_rate?: number | null;
  customer_po?: string | null; need_by?: string | null; valid_until?: string | null; notes?: string | null; date?: string;
}

const QUICK = [3, 6, 12];
let seq = 0;
const key = () => `l${++seq}`;

/**
 * The Ledger's "Create order" screen: pick a customer (their tier sets the
 * prices), tap quantities on product tiles, then review and save as a quote,
 * a sales order, or (mode "invoice") a direct invoice. The server re-checks
 * everything and works out cost, tax and totals itself.
 */
export function OrderBuilder({ mode, action, customers, items, taxRate, today, initial }: {
  mode: 'order' | 'invoice';
  action: (p: ActionState, f: FormData) => Promise<ActionState>;
  customers: BuilderCustomer[]; items: BuilderItem[]; taxRate: number; today: string; initial?: BuilderInitial;
}) {
  const t = useT();
  const [state, run] = useActionState(action, initialActionState);
  const [custId, setCustId] = useState(initial?.customer_id ?? '');
  const [lines, setLines] = useState<CartLine[]>(initial?.lines ?? []);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'brand' | 'az'>('brand');
  const [kind, setKind] = useState<'quote' | 'order'>(initial?.kind ?? 'order');
  const [disc, setDisc] = useState(initial?.discount ? centsToInput(initial.discount) : '');
  const [ship, setShip] = useState(initial?.shipping ? centsToInput(initial.shipping) : '');
  const [rate, setRate] = useState(String(initial?.tax_rate ?? taxRate));
  const [custom, setCustom] = useState({ name: '', qty: '1', price: '' });
  const cust = customers.find((c) => c.id === custId);
  const pct = cust?.pct ?? 0;
  const effRate = cust?.taxExempt ? 0 : Number(rate) || 0;
  const totals = orderTotals(lines, parseDollarsToCents(disc) ?? 0, parseDollarsToCents(ship) ?? 0, effRate);
  const inCart = useMemo(() => new Map(lines.filter((l) => l.item_id).map((l) => [l.item_id!, l])), [lines]);

  const pickCustomer = (id: string) => {
    const next = customers.find((c) => c.id === id);
    setCustId(id);
    // Re-price catalog lines at the new customer's tier.
    if (next) setLines((ls) => ls.map((l) => { const it = l.item_id ? items.find((i) => i.id === l.item_id) : null; return it ? { ...l, price_cents: tierPrice(it.price, next.pct) } : l; }));
  };
  const setQty = (it: BuilderItem, qty: number) => setLines((ls) => {
    const have = ls.find((l) => l.item_id === it.id);
    if (qty <= 0) return ls.filter((l) => l.item_id !== it.id);
    if (have) return ls.map((l) => (l.item_id === it.id ? { ...l, qty } : l));
    return [...ls, { key: key(), item_id: it.id, name: it.name, sku: it.sku, qty, price_cents: tierPrice(it.price, pct) }];
  });
  const edit = (k: string, patch: Partial<CartLine>) => setLines((ls) => ls.map((l) => (l.key === k ? { ...l, ...patch } : l)));

  const shown = items.filter((i) => !q || [i.name, i.sku, i.brand, i.category].some((v) => v?.toLowerCase().includes(q.toLowerCase())));
  const groups = sort === 'brand'
    ? [...shown.reduce((m, i) => m.set(i.brand ?? 'Other', [...(m.get(i.brand ?? 'Other') ?? []), i]), new Map<string, BuilderItem[]>())].sort(([a], [b]) => (a === 'Other' ? 1 : b === 'Other' ? -1 : a.localeCompare(b)))
    : [['', [...shown].sort((a, b) => a.name.localeCompare(b.name))] as [string, BuilderItem[]]];
  const payload = JSON.stringify(lines.map((l) => ({ item_id: l.item_id, name: l.name, sku: l.sku ?? undefined, qty: l.qty, price_cents: l.price_cents })));
  const noun = mode === 'invoice' ? 'invoice' : kind === 'quote' ? 'quote' : 'order';

  return (
    <form action={run} className="flex flex-col gap-[18px]">
      <input type="hidden" name="id" value={initial?.id ?? ''} />
      <input type="hidden" name="lines" value={payload} />
      {mode === 'order' && <input type="hidden" name="kind" value={kind} />}
      <Card className="flex flex-col gap-2">
        <Field label={t('Customer')} htmlFor="cust">
          <Select id="cust" name="customer_id" value={custId} onChange={(e) => pickCustomer(e.target.value)} required>
            <option value="">{t('Choose a customer…')}</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        {cust && (
          <p className="flex flex-wrap items-center gap-1.5 text-sm text-muted">
            {cust.tierName ? t('{v0} pricing{v1}', { v0: cust.tierName, v1: cust.pct ? ` · ${cust.pct}% off list` : '' }) : t('List price')}{cust.taxExempt ? t(' · Tax exempt') : ''}
            {cust.warnings.map((w) => <Badge key={w} tone={w === 'On hold' ? 'warning' : 'danger'}>{w}</Badge>)}
          </p>
        )}
      </Card>

      <section className="flex flex-col gap-2" aria-label={t('Products')}>
        <div className="flex flex-wrap gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search products, SKU or brand')} aria-label={t('Search products')} className="min-w-0 flex-1 rounded-[12px] border border-line bg-card px-3 py-2 text-[15px]" />
          <div className="flex gap-1" role="group" aria-label={t('Sort')}>
            {(['brand', 'az'] as const).map((s) => (
              <button key={s} type="button" onClick={() => setSort(s)} aria-pressed={sort === s} className={cx('rounded-full px-3.5 py-1.5 text-sm font-semibold', sort === s ? 'bg-ink text-paper' : 'bg-card shadow-[var(--shadow-card)]')}>{s === 'brand' ? t('By brand') : 'A–Z'}</button>
            ))}
          </div>
        </div>
        {items.length === 0 && <p className="text-sm text-muted">{t('No items yet. Add them on the Inventory page, or add a custom line below.')}</p>}
        {groups.map(([brand, list]) => (
          <div key={brand || 'all'} className="flex flex-col gap-2">
            {brand && <p className="pt-1 text-[11px] font-semibold uppercase tracking-[.08em] text-muted">{brand}</p>}
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {list.map((it) => {
                const line = inCart.get(it.id);
                const quick = it.casePack && it.casePack > 1 ? [it.casePack, it.casePack * 2] : QUICK;
                return (
                  <li key={it.id} className={cx('flex flex-col gap-1.5 rounded-[16px] bg-card p-3 shadow-[var(--shadow-card)]', line && 'ring-2 ring-accent')}>
                    <p className="text-[14.5px] font-bold leading-snug">{it.name}</p>
                    <p className="text-xs text-muted">{[it.sku, it.casePack && it.casePack > 1 ? `${it.casePack}/case` : null].filter(Boolean).join(' · ')}</p>
                    <p className="num text-[15px] font-semibold">{formatMoney(tierPrice(it.price, pct))}{pct > 0 && <span className="ml-1 text-xs font-normal text-muted line-through">{formatMoney(it.price)}</span>}</p>
                    <p className={cx('text-xs', it.free <= 0 ? 'text-late' : 'text-muted')}>{it.free <= 0 ? t('Out of stock') : t('{v0} free', { v0: it.free })}</p>
                    <div className="mt-auto flex flex-wrap items-center gap-1">
                      {quick.map((n) => (
                        <button key={n} type="button" onClick={() => setQty(it, (line?.qty ?? 0) + n)} aria-label={t('Add {v0} {v1}', { v0: n, v1: it.name })} className="rounded-full bg-soft px-2.5 py-1 text-sm font-semibold hover:bg-line">+{n}</button>
                      ))}
                      <input type="number" min={0} step="any" value={line?.qty ?? ''} placeholder={t('Qty')} aria-label={t('Quantity of {v0}', { v0: it.name })}
                        onChange={(e) => setQty(it, Number(e.target.value) || 0)} className="num w-16 rounded-[10px] border border-line bg-card px-2 py-1 text-sm" />
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        <details className="rounded-[16px] bg-card p-3 shadow-[var(--shadow-card)]">
          <summary className="cursor-pointer font-semibold">{t('Add a custom line')}</summary>
          <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_6rem_8rem_auto]">
            <Input aria-label={t('Description')} placeholder={t('Description')} maxLength={160} value={custom.name} onChange={(e) => setCustom({ ...custom, name: e.target.value })} />
            <Input aria-label={t('Quantity')} type="number" min={0} step="any" className="num" value={custom.qty} onChange={(e) => setCustom({ ...custom, qty: e.target.value })} />
            <Input aria-label={t('Price each')} inputMode="decimal" placeholder={t('Price each')} className="num" value={custom.price} onChange={(e) => setCustom({ ...custom, price: e.target.value })} />
            <Button type="button" variant="secondary" size="sm" onClick={() => {
              const price = parseDollarsToCents(custom.price), qty = Number(custom.qty);
              if (!custom.name.trim() || price === null || !(qty > 0)) return;
              setLines((ls) => [...ls, { key: key(), item_id: null, name: custom.name.trim(), sku: null, qty, price_cents: price }]);
              setCustom({ name: '', qty: '1', price: '' });
            }}>{t('Add')}</Button>
          </div>
        </details>
      </section>

      <Card id="review" className="flex flex-col gap-3">
        <h2 className="text-lg font-bold">{t('Review')} {noun}</h2>
        {lines.length === 0 ? <p className="text-sm text-muted">{t('Nothing added yet.')}</p> : (
          <ul className="flex flex-col divide-y divide-soft">
            {lines.map((l) => (
              <li key={l.key} className="grid grid-cols-[1fr_5rem_6.5rem_auto] items-center gap-2 py-2">
                <span className="min-w-0"><span className="block truncate font-semibold">{l.name}</span><span className="num text-sm text-muted">{formatMoney(Math.round(l.qty * l.price_cents))}</span></span>
                <input type="number" min={0} step="any" value={l.qty} aria-label={t('Quantity of {v0}', { v0: l.name })} onChange={(e) => edit(l.key, { qty: Number(e.target.value) || 0 })} className="num rounded-[10px] border border-line bg-card px-2 py-1 text-sm" />
                <input key={`${l.key}-${l.price_cents}`} inputMode="decimal" defaultValue={centsToInput(l.price_cents)} aria-label={t('Price each for {v0}', { v0: l.name })} onBlur={(e) => { const c = parseDollarsToCents(e.target.value); if (c !== null) edit(l.key, { price_cents: c }); }} className="num rounded-[10px] border border-line bg-card px-2 py-1 text-sm" />
                <button type="button" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label={t('Remove {v0}', { v0: l.name })} className="rounded-full px-2 text-lg text-muted hover:text-late">×</button>
              </li>
            ))}
          </ul>
        )}
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t('Discount (optional)')} htmlFor="disc"><Input id="disc" name="discount" inputMode="decimal" className="num" value={disc} onChange={(e) => setDisc(e.target.value)} placeholder="0.00" /></Field>
          <Field label={t('Shipping (optional)')} htmlFor="ship"><Input id="ship" name="shipping" inputMode="decimal" className="num" value={ship} onChange={(e) => setShip(e.target.value)} placeholder="0.00" /></Field>
          <Field label={cust?.taxExempt ? t('Sales tax % (exempt)') : t('Sales tax %')} htmlFor="rate">
            <Input id="rate" name="tax_rate" type="number" min={0} max={30} step="0.001" className="num" value={cust?.taxExempt ? '0' : rate} disabled={cust?.taxExempt} onChange={(e) => setRate(e.target.value)} />
          </Field>
          <Field label={t('Customer PO # (optional)')} htmlFor="po"><Input id="po" name="customer_po" maxLength={60} defaultValue={initial?.customer_po ?? ''} /></Field>
          {mode === 'invoice' ? (
            <>
              <Field label={t('Invoice date')} htmlFor="idate"><Input id="idate" name="invoice_date" type="date" defaultValue={today} required /></Field>
              <Field label={t('Terms (days, optional)')} htmlFor="terms" hint={cust ? t('Blank uses their terms ({v0} days).', { v0: cust.terms }) : undefined}><Input id="terms" name="terms" type="number" min={0} max={365} className="num" /></Field>
            </>
          ) : (
            <>
              <Field label={t('Order date')} htmlFor="odate"><Input id="odate" name="order_date" type="date" defaultValue={initial?.date ?? today} required /></Field>
              {kind === 'quote'
                ? <Field label={t('Quote good until (optional)')} htmlFor="vu"><Input id="vu" name="valid_until" type="date" defaultValue={initial?.valid_until ?? ''} /></Field>
                : <Field label={t('Needed by (optional)')} htmlFor="nb"><Input id="nb" name="need_by" type="date" defaultValue={initial?.need_by ?? ''} /></Field>}
            </>
          )}
          <div className="sm:col-span-3"><Field label={t('Notes (optional)')} htmlFor="notes"><Textarea id="notes" name="notes" rows={2} maxLength={1000} defaultValue={initial?.notes ?? ''} /></Field></div>
        </div>
        <dl className="ml-auto grid w-full max-w-xs grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-[15px]">
          <dt className="text-muted">{t('Subtotal')}</dt><dd className="num text-right">{formatMoney(totals.subtotal)}</dd>
          {totals.subtotal !== totals.total - totals.tax && <><dt className="text-muted">{t('Discount / shipping')}</dt><dd className="num text-right">{formatMoney(totals.total - totals.tax - totals.subtotal)}</dd></>}
          <dt className="text-muted">{t('Tax')}</dt><dd className="num text-right">{formatMoney(totals.tax)}</dd>
          <dt className="font-bold">{t('Total')}</dt><dd className="num text-right font-bold">{formatMoney(totals.total)}</dd>
        </dl>
        <FormMessage state={state} />
        <div className="flex flex-wrap items-center gap-2">
          {mode === 'order' && !initial?.id && (
            <div className="flex gap-1" role="group" aria-label={t('Save as')}>
              {(['order', 'quote'] as const).map((k) => (
                <button key={k} type="button" onClick={() => setKind(k)} aria-pressed={kind === k} className={cx('rounded-full px-3.5 py-1.5 text-sm font-semibold', kind === k ? 'bg-ink text-paper' : 'bg-card shadow-[var(--shadow-card)]')}>{k === 'order' ? t('Sales order') : t('Quote')}</button>
              ))}
            </div>
          )}
          <Button type="submit" disabled={!custId || lines.length === 0}>{initial?.id ? t('Save changes') : t('Save {v0}', { v0: noun })}</Button>
        </div>
      </Card>

      {lines.length > 0 && (
        <a href="#review" className="fixed inset-x-4 bottom-[calc(84px+env(safe-area-inset-bottom,0px))] z-30 mx-auto flex max-w-[560px] items-center justify-between rounded-full bg-accent px-5 py-3 font-semibold text-on-accent shadow-[0_10px_24px_rgba(91,127,245,.45)]">
          <span>{lines.length} {t('line')}{lines.length === 1 ? '' : 's'} · <span className="num">{formatMoney(totals.total)}</span></span><span>{t('Review')} {noun} ›</span>
        </a>
      )}
    </form>
  );
}
