'use client';
import { cx } from '@/components/ui';
import { LANGUAGE_NAMES, LOCALES } from '@/lib/i18n/config';
import { useLocale, useT } from '@/lib/i18n/client';
import { setLanguage } from '@/lib/i18n/actions';

/** English / العربية switch. Each name is shown in its own language. */
export function LanguageSwitch({ className }: { className?: string }) {
  const locale = useLocale();
  const t = useT();
  return (
    <form action={setLanguage} className={cx('flex gap-1', className)} aria-label={t('Language')}>
      {LOCALES.map((l) => (
        <button key={l} type="submit" name="lang" value={l} aria-pressed={locale === l} lang={l}
          className={cx('rounded-full px-3 py-1.5 text-sm font-semibold', locale === l ? 'bg-ink text-paper' : 'bg-card text-ink shadow-[var(--shadow-card)]')}>
          {LANGUAGE_NAMES[l]}
        </button>
      ))}
    </form>
  );
}
