import Link from 'next/link';
import type { ReactNode } from 'react';
import { Badge, cx } from '@/components/ui';
import { formatMoney } from '@/lib/billing/plans';
import { INVOICE_STATUS, ORDER_STATUS, type InvoiceStatus } from '@/lib/wholesale/ledger';

export const money = formatMoney;
export const money0 = (c: number) => formatMoney(Math.round(c / 100) * 100).replace(/\.00$/, '');

export function InvoiceBadge({ s }: { s: InvoiceStatus }) {
  return <Badge tone={INVOICE_STATUS[s].tone}>{INVOICE_STATUS[s].label}</Badge>;
}
export function OrderBadge({ status, kind }: { status: string; kind?: string }) {
  if (kind === 'quote' && status !== 'cancelled') return <Badge tone="neutral">Quote</Badge>;
  const s = ORDER_STATUS[status] ?? ORDER_STATUS.open;
  return <Badge tone={s.tone}>{s.label}</Badge>;
}
export function Warnings({ list }: { list: string[] }) {
  if (!list.length) return null;
  return <span className="flex flex-wrap gap-1">{list.map((w) => <Badge key={w} tone={w === 'On hold' ? 'warning' : 'danger'}>{w}</Badge>)}</span>;
}

/** Pill filters as links (?f=…), like the Ledger's filter row. */
export function Pills({ base, current, items, param = 'f' }: { base: string; current: string; items: [string, string][]; param?: string }) {
  return (
    <nav aria-label="Filter" className="flex gap-1.5 overflow-x-auto pb-1">
      {items.map(([k, label]) => (
        <Link key={k} href={k ? `${base}?${param}=${k}` : base} aria-current={current === k ? 'page' : undefined}
          className={cx('whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-semibold', current === k ? 'bg-ink text-paper' : 'bg-card text-ink shadow-[var(--shadow-card)]')}>{label}</Link>
      ))}
    </nav>
  );
}

/** A tappable list row: title and detail on the left, amount and badge on the right. */
export function Row({ href, title, detail, amount, badge }: { href: string; title: ReactNode; detail?: ReactNode; amount?: ReactNode; badge?: ReactNode }) {
  return (
    <li>
      <Link href={href} className="flex items-start justify-between gap-3 rounded-[16px] bg-card px-4 py-3 shadow-[var(--shadow-card)] hover:bg-soft">
        <span className="min-w-0"><span className="block truncate font-bold">{title}</span>{detail && <span className="block text-sm text-muted">{detail}</span>}</span>
        <span className="flex flex-none flex-col items-end gap-1">{amount && <span className="num font-semibold">{amount}</span>}{badge}</span>
      </Link>
    </li>
  );
}

export function SearchBox({ action, q, placeholder, hidden }: { action: string; q: string; placeholder: string; hidden?: Record<string, string> }) {
  return (
    <form action={action} className="flex gap-2" role="search">
      {Object.entries(hidden ?? {}).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <input name="q" defaultValue={q} placeholder={placeholder} aria-label={placeholder}
        className="min-w-0 flex-1 rounded-[12px] border border-line bg-card px-3 py-2 text-[15px]" />
      <button className="rounded-[12px] bg-card px-3.5 py-2 text-sm font-semibold shadow-[var(--shadow-card)]">Search</button>
    </form>
  );
}
