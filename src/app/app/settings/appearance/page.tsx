import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { getOrgContext } from '@/lib/auth/context';
import { ActionForm } from '@/components/action-form';
import { Eyebrow, PageHeader, cx } from '@/components/ui';
import { THEMES, THEME_COOKIE, themeFrom } from '@/lib/themes';
import { setTheme } from './actions';

export const metadata: Metadata = { title: 'Appearance' };

/** #116 Themes: 4 light and 4 dark, picked per person and saved on this device. */
export default async function AppearancePage() {
  await getOrgContext();
  const cur = themeFrom((await cookies()).get(THEME_COOKIE)?.value);
  const opt = (t: (typeof THEMES)[number]) => (
    <ActionForm key={t.id} action={setTheme} className="contents" render={() => null}>
      <input type="hidden" name="theme" value={t.id} />
      <button type="submit" aria-pressed={cur === t.id}
        className={cx('flex items-center gap-3 rounded-[16px] bg-card p-3 text-left shadow-[var(--shadow-card)]', cur === t.id && 'ring-2 ring-accent')}>
        <span aria-hidden className="flex h-12 w-16 flex-none items-end gap-0.5 overflow-hidden rounded-lg p-1" style={{ background: t.sw[0] }}>
          <i className="w-1/3 rounded-sm" style={{ background: t.sw[1], height: '70%' }} /><i className="w-1/3 rounded-sm" style={{ background: t.sw[2], height: '45%' }} /><i className="w-1/3 rounded-sm" style={{ background: t.sw[3], height: '25%' }} />
        </span>
        <span className="font-semibold">{t.name}{cur === t.id ? <span className="block text-xs font-normal text-muted">In use</span> : null}</span>
      </button>
    </ActionForm>
  );
  return (
    <>
      <PageHeader title="Appearance" description="Pick the colours for RetailNexa. Saved on this device; everyone who uses the app picks their own." />
      <Eyebrow>Light</Eyebrow>
      <div className="grid grid-cols-2 gap-3">{THEMES.filter((t) => t.mode === 'light').map(opt)}</div>
      <Eyebrow>Dark</Eyebrow>
      <div className="grid grid-cols-2 gap-3">{THEMES.filter((t) => t.mode === 'dark').map(opt)}</div>
    </>
  );
}
