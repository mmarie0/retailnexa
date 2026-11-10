import Link from 'next/link';
import { can, getOrgContext, getSupabase } from '@/lib/auth/context';
import { isPermission } from '@/lib/auth/permissions';
import { Notice, Select, buttonClass } from '@/components/ui';
import { AppShell } from './app-shell';
import { FAB, visibleAreas, visibleMore } from './nav';
import { switchOrganization } from './org-actions';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getOrgContext();
  const has = (p: string) => isPermission(p) && can(ctx, p);
  const areas = visibleAreas(has);
  const more = visibleMore(has);
  const { data: orgRow } = await (await getSupabase()).from('organizations').select('timezone').eq('id', ctx.org.id).maybeSingle();
  const today = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: orgRow?.timezone ?? 'America/New_York' });
  // Add-button permissions the shell needs to pick the button for the current page (it follows client navigation).
  const fabPerms = ctx.access.canWrite ? [...new Set(Object.values(FAB).flatMap((f) => (f && has(f.perm) ? [f.perm] : [])))] : [];

  const switcher = ctx.orgs.length > 1 ? (
    <form action={switchOrganization} className="mt-2 flex gap-2">
      <Select name="org" defaultValue={ctx.org.id} aria-label="Switch business" className="py-1.5 text-sm">
        {ctx.orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </Select>
      <button className={buttonClass('secondary', 'sm')}>Go</button>
    </form>
  ) : undefined;

  const notice = ctx.access.notice;
  return (
    <AppShell areas={areas} more={more} orgName={ctx.org.name} orgSwitcher={switcher} email={ctx.user.email} today={today} fabPerms={fabPerms}>
      {notice && (
        <Notice tone={notice.tone} action={can(ctx, 'billing.view') && <Link href="/app/billing" className={buttonClass('secondary', 'sm')}>Go to billing</Link>}>
          {notice.message}
        </Notice>
      )}
      {children}
    </AppShell>
  );
}
