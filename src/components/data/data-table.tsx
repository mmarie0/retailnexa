import type { ReactNode } from 'react';
import { cx } from '@/components/ui';

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  align?: 'left' | 'right';
  /** Hide on narrow screens' card view (still shown on desktop). */
  hideOnMobile?: boolean;
}

/** Table on desktop, stacked cards on phones (pattern carried over from the RetailNexa app). */
export function DataTable<T>({ columns, rows, rowKey, caption, onRowClick, activeKey }: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  caption?: string;
  onRowClick?: (row: T) => void;
  activeKey?: string | null;
}) {
  return (
    <div className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-card">
      <table className="w-full border-collapse text-[15px]">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead className="hidden bg-soft text-left text-sm text-muted md:table-header-group">
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={cx('px-4 py-2.5 font-semibold', c.align === 'right' && 'text-right')}>{c.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const k = rowKey(row);
            return (
              <tr
                key={k}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cx(
                  'block border-t border-line px-4 py-3 first:border-t-0 md:table-row md:px-0 md:py-0',
                  onRowClick && 'cursor-pointer hover:bg-soft',
                  activeKey === k && 'bg-accent-soft hover:bg-accent-soft',
                )}
              >
                {columns.map((c, i) => (
                  <td
                    key={c.key}
                    className={cx(
                      'md:px-4 md:py-2.5',
                      i === 0 ? 'block font-semibold md:table-cell md:font-normal' : 'flex justify-between gap-4 py-0.5 text-sm md:table-cell md:text-[15px]',
                      c.hideOnMobile && 'hidden md:table-cell',
                      c.align === 'right' && 'md:text-right num',
                    )}
                  >
                    {i > 0 && <span className="text-muted md:hidden">{c.header}</span>}
                    {onRowClick && i === 0 ? (
                      <button type="button" className="text-left font-semibold underline-offset-2 hover:underline" onClick={(e) => { e.stopPropagation(); onRowClick(row); }}>
                        {c.cell(row)}
                      </button>
                    ) : (
                      <span>{c.cell(row)}</span>
                    )}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
