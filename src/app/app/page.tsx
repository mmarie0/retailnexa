import type { Metadata } from 'next';
import Link from 'next/link';
import { can, getOrgContext, getSupabase } from '@/lib/auth/context';
import { Badge, Card, PageHeader } from '@/components/ui';
import { ROLE_LABELS } from '@/lib/auth/permissions';

export const metadata: Metadata = { title: 'Overview' };

export default async function OverviewPage() {
  const ctx = await getOrgContext();
  const supabase = await getSupabase();
  const [{ count: locations }, { count: members }, { data: announcements }] = await Promise.all([
    supabase.from('locations').select('id', { count: 'exact', head: true }).eq('organization_id', ctx.org.id).eq('is_active', true),
    can(ctx, 'members.view')
      ? supabase.from('memberships').select('id', { count: 'exact', head: true }).eq('organization_id', ctx.org.id).eq('status', 'active')
      : Promise.resolve({ count: null }),
    supabase.from('announcements').select('id, title, body, severity, audience').order('starts_at', { ascending: false }).limit(3),
  ]);

  const steps = [
    { done: !!ctx.subscription, label: 'Choose a plan and start your trial', href: '/app/billing', show: can(ctx, 'billing.manage') },
    { done: (locations ?? 0) > 0, label: `Add your locations (${locations ?? 0} so far)`, href: '/app/settings/locations', show: can(ctx, 'locations.manage') },
    { done: (members ?? 0) > 1, label: 'Invite your team', href: '/app/settings/team', show: can(ctx, 'members.manage') },
    { done: false, label: 'Review what each role can see', href: '/help/roles-and-permissions', show: can(ctx, 'roles.manage') },
  ].filter((s) => s.show);
  const visibleAnnouncements = (announcements ?? []).filter((a) => !a.audience || a.audience === ctx.org.businessType || ctx.org.businessType === 'both');

  return (
    <>
      <PageHeader title={`Welcome to ${ctx.org.name}`} description={`You’re signed in as ${ROLE_LABELS[ctx.org.role]}.`} />
      {visibleAnnouncements.map((a) => (
        <Card key={a.id} className={a.severity === 'critical' ? 'border-late' : a.severity === 'warning' ? 'border-soon' : ''}>
          <p className="font-bold">{a.title}</p><p className="mt-1 text-muted">{a.body}</p>
        </Card>
      ))}
      {steps.length > 0 && (
        <Card>
          <h2 className="text-lg font-bold">Get set up</h2>
          <ol className="mt-3 flex flex-col gap-2">
            {steps.map((s) => (
              <li key={s.label} className="flex items-center justify-between gap-3 rounded-xl bg-soft px-4 py-3">
                <Link href={s.href} className="font-semibold hover:underline">{s.label}</Link>
                {s.done ? <Badge tone="good">Done</Badge> : <Badge>To do</Badge>}
              </li>
            ))}
          </ol>
        </Card>
      )}
      <Card>
        <h2 className="text-lg font-bold">What’s next for RetailNexa</h2>
        <p className="mt-1 text-muted">Your account, team, locations and billing are ready. Sales reports, bills and vendors, inventory and bookkeeping arrive in the next releases and will appear in the menu when they’re available to you.</p>
      </Card>
    </>
  );
}
