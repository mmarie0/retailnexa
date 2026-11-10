import { formatMoney } from '@/lib/billing/plans';
import type { Section } from '@/lib/accounting/statements';
import { cx } from '@/components/ui';

export function StatementSection({ section, totalLabel }: { section: Section; totalLabel?: string }) {
  return (
    <tbody>
      <tr><th colSpan={2} scope="colgroup" className="px-5 pb-1 pt-4 text-left text-sm font-bold uppercase tracking-wide text-muted">{section.title}</th></tr>
      {section.lines.length === 0 && <tr><td className="px-5 py-1.5 text-muted" colSpan={2}>Nothing in this period</td></tr>}
      {section.lines.map((l) => (
        <tr key={l.id}>
          <td className="px-5 py-1.5">{l.code && <span className="num mr-2 text-muted">{l.code}</span>}{l.name}</td>
          <td className="num px-5 text-right">{formatMoney(l.amount)}</td>
        </tr>
      ))}
      <tr className="border-t border-line font-semibold">
        <td className="px-5 py-2">{totalLabel ?? `Total ${section.title.toLowerCase()}`}</td>
        <td className="num px-5 text-right">{formatMoney(section.total)}</td>
      </tr>
    </tbody>
  );
}

export function TotalRow({ label, cents, strong }: { label: string; cents: number; strong?: boolean }) {
  return (
    <tbody>
      <tr className={cx('border-t-2 border-ink/20', strong ? 'text-lg font-bold' : 'font-bold')}>
        <td className="px-5 py-3">{label}</td>
        <td className={cx('num px-5 text-right', cents < 0 && 'text-late')}>{formatMoney(cents)}</td>
      </tr>
    </tbody>
  );
}
