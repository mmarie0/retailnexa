import type { Metadata } from 'next';
import Link from 'next/link';
import { can, getOrgContext } from '@/lib/auth/context';
import { isPermission } from '@/lib/auth/permissions';
import { Icon } from '../../app-shell';
import { visibleMore, type IconKey } from '../../nav';

export const metadata: Metadata = { title: 'More' };

const DESC: Record<string, string> = {
  reps: 'Which days each vendor’s sales rep usually comes',
  fixed: 'Rent, card fees and other monthly bills',
  statements: 'Check a statement against your invoices',
  bank: 'Match checks, ACH and card deposits',
  aging: 'Open bills by how late they are',
  deposits: 'Cash and card deposits, sales tax and owner draws',
};
const TONE: Record<string, string> = { reps: 'coral', fixed: 'indigo', statements: 'lav', bank: 'blue', aging: 'coral', deposits: 'indigo' };

/** Bills → More, as in the RetailNexa app. */
export default async function BillsMorePage() {
  const ctx = await getOrgContext();
  const pages = visibleMore((p) => isPermission(p) && can(ctx, p));
  return (
    <div className="overflow-hidden rounded-[18px] bg-card shadow-[var(--shadow-card)]">
      {pages.map((p, i) => {
        const inner = (
          <>
            <span className={`blk ${TONE[p.key] ?? 'blue'} grid size-[38px] flex-none place-items-center rounded-xl`}><Icon k={p.icon as IconKey} className="size-5" /></span>
            <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
              <span className="truncate text-base font-semibold">{p.label}</span>
              <span className="text-[13.5px] text-muted">{DESC[p.key]}</span>
            </span>
            {p.href ? <span className="font-semibold text-accent-strong" aria-hidden>›</span> : <span className="rounded-full bg-soft px-2 py-0.5 text-[11px] font-bold text-muted">Soon</span>}
          </>
        );
        const cls = `flex items-center gap-3 px-3.5 py-3 ${i ? 'border-t border-soft' : ''}`;
        return p.href ? <Link key={p.key} href={p.href} className={`${cls} hover:bg-soft`}>{inner}</Link> : <div key={p.key} className={`${cls} opacity-70`}>{inner}</div>;
      })}
    </div>
  );
}
