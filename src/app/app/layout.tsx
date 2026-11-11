import Link from 'next/link';
import { cookies } from 'next/headers';
import { THEME_COOKIE, themeFrom } from '@/lib/themes';
import { can, getOrgContext, getSupabase } from '@/lib/auth/context';
import { isPermission } from '@/lib/auth/permissions';
import { Notice, Select, buttonClass } from '@/components/ui';
import { AppShell } from './app-shell';
import { FAB, visibleAreas, visibleMore } from './nav';
import { switchOrganization } from './org-actions';
import { getLocale, getT } from '@/lib/i18n/server';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const t = await getT();
  const locale = await getLocale();
  const ctx = await getOrgContext();
  const has = (p: string) => isPermission(p) && can(ctx, p);
  // Menu names are translated here; the shell shows them as given.
  const tr = <P extends { label: string }>(p: P): P => ({ ...p, label: t(p.label) });
  const areas = visibleAreas(has, ctx.org.businessType).map((a) => ({ ...tr(a), pages: a.pages.map(tr) }));
  const more = visibleMore(has).map(tr);
  const { data: orgRow } = await (await getSupabase()).from('organizations').select('timezone').eq('id', ctx.org.id).maybeSingle();
  const today = new Date().toLocaleDateString(locale === 'ar' ? 'ar-u-nu-latn' : 'en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: orgRow?.timezone ?? 'America/New_York' });
  // Add-button permissions the shell needs to pick the button for the current page (it follows client navigation).
  const fabPerms = ctx.access.canWrite ? [...new Set(Object.values(FAB).flatMap((f) => (f && has(f.perm) ? [f.perm] : [])))] : [];

  const switcher = ctx.orgs.length > 1 ? (
    <form action={switchOrganization} className="mt-2 flex gap-2">
      <Select name="org" defaultValue={ctx.org.id} aria-label={t('Switch business')} className="py-1.5 text-sm">
        {ctx.orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </Select>
      <button className={buttonClass('secondary', 'sm')}>{t('Go')}</button>
    </form>
  ) : undefined;

  const notice = ctx.access.notice;
  const theme = themeFrom((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <AppShell theme={theme} areas={areas} more={more} orgName={ctx.org.name} orgSwitcher={switcher} email={ctx.user.email} today={today} fabPerms={fabPerms}>
      {notice && (
        <Notice tone={notice.tone} action={can(ctx, 'billing.view') && <Link href="/app/billing" className={buttonClass('secondary', 'sm')}>{t('Go to billing')}</Link>}>
          {notice.message}
        </Notice>
      )}
      {children}
    </AppShell>
  );
}
