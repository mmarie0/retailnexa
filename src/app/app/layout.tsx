import Link from 'next/link';
import { can, getOrgContext } from '@/lib/auth/context';
import { Logo, Notice, Select, buttonClass } from '@/components/ui';
import { ROLE_LABELS } from '@/lib/auth/permissions';
import { AppNav, type NavItem } from './app-nav';
import { switchOrganization } from './org-actions';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getOrgContext();
  const items: NavItem[] = [{ href: '/app', label: 'Overview' }];
  if (can(ctx, 'billing.view')) items.push({ href: '/app/billing', label: 'Billing' });
  if (can(ctx, 'org.view')) items.push({ href: '/app/settings', label: 'Business profile' });
  if (can(ctx, 'locations.view')) items.push({ href: '/app/settings/locations', label: 'Locations' });
  if (can(ctx, 'members.view')) items.push({ href: '/app/settings/team', label: 'Team' });
  if (can(ctx, 'org.manage')) items.push({ href: '/app/settings/support-access', label: 'Support access' });
  if (can(ctx, 'sales.view')) items.push({ href: '/app/sales', label: 'Sales' });
  if (can(ctx, 'accounting.post') || can(ctx, 'cash.create')) items.push({ href: '/app/deposits', label: 'Deposits & payments' });
  if (can(ctx, 'bills.view')) items.push({ href: '/app/bills', label: 'Bills' });
  if (can(ctx, 'vendors.view')) items.push({ href: '/app/vendors', label: 'Vendors' });
  if (can(ctx, 'bank.view')) items.push({ href: '/app/bank', label: 'Bank' });
  if (can(ctx, 'accounting.view')) items.push({ href: '/app/accounting', label: 'Accounting' });
  if (can(ctx, 'audit.view')) items.push({ href: '/app/audit', label: 'Audit log' });
  if (can(ctx, 'data.export')) items.push({ href: '/app/settings/export', label: 'Export data' });

  const notice = ctx.access.notice;
  return (
    <div className="mx-auto grid min-h-dvh max-w-7xl gap-6 px-4 py-4 lg:grid-cols-[230px_1fr] lg:py-6">
      <aside className="flex flex-col gap-5 lg:sticky lg:top-6 lg:h-[calc(100dvh-3rem)]">
        <div className="flex items-center justify-between gap-3">
          <Link href="/app" aria-label="Overview"><Logo /></Link>
        </div>
        {ctx.orgs.length > 1 ? (
          <form action={switchOrganization} className="flex gap-2">
            <Select name="org" defaultValue={ctx.org.id} aria-label="Switch business" className="py-2 text-sm">
              {ctx.orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </Select>
            <button className={buttonClass('secondary', 'sm')}>Go</button>
          </form>
        ) : (
          <p className="font-bold leading-tight">{ctx.org.name}<span className="block text-sm font-medium text-muted">{ROLE_LABELS[ctx.org.role]}</span></p>
        )}
        <AppNav items={items} />
        <div className="mt-auto hidden flex-col gap-2 text-sm lg:flex">
          <p className="truncate text-muted" title={ctx.user.email}>{ctx.user.email}</p>
          <Link href="/account/security" className="font-semibold text-accent-strong">Two-factor authentication</Link>
          <Link href="/onboarding?new=1" className="font-semibold text-accent-strong">Add another business</Link>
          <form action="/auth/signout" method="post"><button className="font-semibold text-muted hover:text-ink">Log out</button></form>
        </div>
      </aside>
      <main id="main" className="flex min-w-0 flex-col gap-6 pb-16">
        {notice && (
          <Notice tone={notice.tone} action={can(ctx, 'billing.view') && <Link href="/app/billing" className={buttonClass('secondary', 'sm')}>Go to billing</Link>}>
            {notice.message}
          </Notice>
        )}
        {children}
        <form action="/auth/signout" method="post" className="lg:hidden"><button className="text-sm font-semibold text-muted">Log out</button></form>
      </main>
    </div>
  );
}
