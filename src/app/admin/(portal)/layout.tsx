import type { Metadata } from 'next';
import Link from 'next/link';
import { getAdminContext } from '@/lib/auth/context';
import { Badge, Logo } from '@/components/ui';
import { AppNav } from '@/app/app/app-nav';

export const metadata: Metadata = { title: { default: 'Admin', template: '%s · RetailNexa Admin' }, robots: { index: false } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getAdminContext();
  return (
    <div className="mx-auto grid min-h-dvh max-w-7xl gap-6 px-4 py-4 lg:grid-cols-[220px_1fr] lg:py-6">
      <aside className="flex flex-col gap-5 lg:sticky lg:top-6 lg:h-[calc(100dvh-3rem)]">
        <Link href="/admin"><Logo /></Link>
        <p className="flex items-center gap-2 font-bold">Platform admin <Badge tone="warning">{ctx.role}</Badge></p>
        <AppNav items={[
          { href: '/admin', label: 'Overview' },
          { href: '/admin/tenants', label: 'Customers' },
          ...(ctx.role === 'superadmin' ? [{ href: '/admin/import', label: 'Master import' }] : []),
          { href: '/admin/agents', label: 'Sales agents' },
          { href: '/admin/leads', label: 'Leads' },
          { href: '/admin/announcements', label: 'Announcements' },
          { href: '/admin/audit', label: 'Audit log' },
          { href: '/admin/system', label: 'System health' },
        ]} />
        <form action="/auth/signout" method="post" className="mt-auto"><button className="text-sm font-semibold text-muted hover:text-ink">Log out ({ctx.user.email})</button></form>
      </aside>
      <main id="main" className="flex min-w-0 flex-col gap-6 pb-16">{children}</main>
    </div>
  );
}
