import type { ReactNode } from 'react';
import { cx } from '@/components/ui';

const blocks = {
  blue: 'bg-[linear-gradient(150deg,#7E99FA,#5B7FF5)] text-white',
  indigo: 'bg-[linear-gradient(150deg,#4B489E,#38357F)] text-white',
  lav: 'bg-[linear-gradient(150deg,#8f93dc,#6c70c4)] text-white',
  coral: 'bg-[linear-gradient(150deg,#e86c63,#c9483f)] text-white',
  plain: 'bg-card text-ink border border-line',
} as const;

export interface KpiTileProps {
  label: string;
  value: string;
  /** e.g. "+8.2% vs same day last year" */
  comparison?: { text: string; direction: 'up' | 'down' | 'flat' } | null;
  footnote?: ReactNode;
  tone?: keyof typeof blocks;
  size?: 'lg' | 'md';
}

/** Headline number tile. Colour blocks carry RetailNexa's identity; values stay in text colour, not series colour. */
export function KpiTile({ label, value, comparison, footnote, tone = 'plain', size = 'md' }: KpiTileProps) {
  const onBlock = tone !== 'plain';
  return (
    <div className={cx('flex min-w-0 flex-col justify-between gap-3 rounded-[18px] p-4', blocks[tone], size === 'lg' && 'min-h-36 p-5')}>
      <p className={cx('text-sm font-semibold', onBlock ? 'text-white/85' : 'text-muted')}>{label}</p>
      <div>
        <p className={cx('num font-extrabold leading-none', size === 'lg' ? 'text-[28px] sm:text-[34px]' : 'text-[24px]')}>{value}</p>
        {comparison && (
          <p className={cx('mt-2 text-sm font-medium', onBlock ? 'text-white/90' : 'text-muted')}>
            <span aria-hidden="true">{comparison.direction === 'up' ? '▲ ' : comparison.direction === 'down' ? '▼ ' : '■ '}</span>
            {comparison.text}
          </p>
        )}
        {footnote && <p className={cx('mt-1 text-[13px]', onBlock ? 'text-white/80' : 'text-muted')}>{footnote}</p>}
      </div>
    </div>
  );
}
