'use client';
import { useActionState, useState } from 'react';
import Link from 'next/link';
import { useFormStatus } from 'react-dom';
import { cx } from '@/components/ui';
import { initialActionState } from '@/lib/actions';
import { markBillPaid } from './actions';

export interface CalItem {
  id: string; billId: string | null; name: string; detail: string; dueDate: string;
  amountCents: number; leftCents: number; dot: 'paid' | 'late' | 'soon' | 'upcoming'; stage: string; kind: 'order' | 'bill';
}

const usd = (c: number) => (c / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const short = (c: number) => (c >= 100_000 ? `$${(c / 100_000).toFixed(c >= 1_000_000 ? 0 : 1)}k` : `$${Math.round(c / 100)}`);
const DOT: Record<CalItem['dot'], string> = { paid: 'bg-paid', late: 'bg-late', soon: 'bg-soon', upcoming: 'bg-accent' };
const longDay = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' });

/** Month calendar with status dots; tapping a day opens its bills under that week (as in the live app). */
export function DueCalendar({ ym, today, items, showKind, canAdd }: { ym: string; today: string; items: CalItem[]; showKind: boolean; canAdd: boolean }) {
  const [sel, setSel] = useState<string | null>(null);
  const first = new Date(`${ym}-01T00:00:00Z`).getUTCDay();
  const n = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).getUTCDate();
  const byDay = new Map<number, CalItem[]>();
  for (const i of items) { const d = +i.dueDate.slice(8); byDay.set(d, [...(byDay.get(d) ?? []), i]); }
  const cells: React.ReactNode[] = ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <div key={`h${i}`} className="pb-0.5 text-center text-[11px] font-semibold text-muted" aria-hidden>{d}</div>);
  for (let i = 0; i < first; i++) cells.push(<div key={`b${i}`} aria-hidden />);
  for (let d = 1; d <= n; d++) {
    const iso = `${ym}-${String(d).padStart(2, '0')}`, list = byDay.get(d) ?? [], on = sel === iso;
    const sum = list.reduce((a, b) => a + b.amountCents, 0);
    cells.push(
      <button key={iso} type="button" onClick={() => setSel(on ? null : iso)} aria-pressed={on}
        aria-label={`${longDay(iso)}${list.length ? `, ${list.length} due, ${usd(sum)}` : ''}`}
        className={cx('flex min-h-[54px] min-w-0 flex-col items-center gap-0.5 rounded-xl border px-0.5 py-1 text-[13px]',
          on ? 'border-transparent bg-accent text-white' : 'bg-card', iso === today && !on ? 'border-accent' : 'border-transparent')}>
        <span>{d}</span>
        <span className="flex h-1.5 gap-0.5">{list.slice(0, 3).map((b) => <i key={b.id} className={cx('size-1.5 rounded-full', DOT[b.dot])} />)}</span>
        {list.length > 0 && <span className={cx('num max-w-full overflow-hidden text-[10px] whitespace-nowrap', on ? 'text-white' : 'text-muted')}>{short(sum)}</span>}
      </button>,
    );
    const endOfRow = (first + d) % 7 === 0 || d === n;
    if (endOfRow && sel?.startsWith(ym)) {
      const sd = +sel.slice(8), rowStart = d - ((first + d - 1) % 7);
      if (sd >= rowStart && sd <= d) {
        const dl = byDay.get(sd) ?? [];
        cells.push(
          <div key={`p${d}`} data-fab-hide className="col-span-7 my-1 flex flex-col gap-2 rounded-xl bg-soft p-3">
            <div className="flex items-center justify-between gap-2"><b>{longDay(sel)}</b><span className="num text-sm">{dl.length ? `${usd(dl.reduce((a, b) => a + b.amountCents, 0))} due` : ''}</span></div>
            {dl.length ? <ul className="flex flex-col gap-1.5">{dl.map((b) => <li key={b.id}><ItemLine item={b} showKind={showKind} /></li>)}</ul> : <p className="text-sm text-muted">Nothing due this day.</p>}
            <div className="flex flex-wrap gap-2">
              {canAdd && <Link href={`/app/bills/new?due=${sel}`} className="rounded-full bg-card px-3 py-1.5 text-sm font-semibold text-accent-strong">+ Add bill for this day</Link>}
              <button type="button" onClick={() => setSel(null)} className="rounded-full px-3 py-1.5 text-sm font-semibold text-muted">Close</button>
            </div>
          </div>,
        );
      }
    }
  }
  return <div role="group" aria-label="Due dates" className="grid grid-cols-7 gap-1">{cells}</div>;
}

function ItemLine({ item, showKind }: { item: CalItem; showKind: boolean }) {
  const body = (
    <>
      <span className="min-w-0 truncate"><b>{item.name}</b> <span className="text-muted">· {item.detail}{showKind ? ` · ${item.kind === 'order' ? 'order' : 'bill'}` : ''}</span></span>
      <span className={cx('num shrink-0', item.leftCents === 0 && 'text-muted')}>{item.leftCents === 0 ? 'Paid' : usd(item.leftCents)}</span>
    </>
  );
  const cls = 'flex items-center justify-between gap-3 rounded-lg bg-card px-3 py-2 text-[14px]';
  return item.billId ? <Link href={`/app/bills/${item.billId}`} className={cls}>{body}</Link> : <Link href="/app/bills/recurring" className={cls}>{body}</Link>;
}

function Box({ name }: { name: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-label={`Mark ${name} paid`} title="Pays what’s left from the bank today. Open the bill to pay by cash or on another date."
      className={cx('grid size-6 shrink-0 place-items-center rounded-md border-2 border-accent bg-card', pending && 'opacity-50')}>
      {pending && <span className="size-2 rounded-full bg-accent" />}
    </button>
  );
}

/** The live app's paid check box, for approved bills. */
export function PaidBox({ billId, name, idemKey }: { billId: string; name: string; idemKey: string }) {
  const [state, run] = useActionState(markBillPaid, initialActionState);
  return (
    <form action={run} className="flex items-center gap-2">
      <input type="hidden" name="id" value={billId} />
      <input type="hidden" name="idempotency_key" value={idemKey} />
      <Box name={name} />
      {state.message && !state.ok && <span role="alert" className="text-xs text-late">{state.message}</span>}
    </form>
  );
}
