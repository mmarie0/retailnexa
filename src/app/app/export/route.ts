import { NextResponse } from 'next/server';
import { can, getOrgContext, getSupabase } from '@/lib/auth/context';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Tenant data export. Reads with the user's own client (RLS applies), so the
 * export can never include another tenant's rows.
 */
export async function GET() {
  const ctx = await getOrgContext();
  if (!can(ctx, 'data.export') || !ctx.access.canExport) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const supabase = await getSupabase();
  const org = ctx.org.id;
  const [organization, locations, memberships, subscription, subscriptionEvents, audit] = await Promise.all([
    supabase.from('organizations').select('id, name, legal_name, business_type, timezone, currency, phone, website, created_at').eq('id', org).single(),
    supabase.from('locations').select('*').eq('organization_id', org),
    supabase.from('memberships').select('id, user_id, role, status, created_at').eq('organization_id', org),
    supabase.from('subscriptions').select('status, products, extra_locations, trial_start, trial_end, current_period_start, current_period_end, cancel_at_period_end, canceled_at, ended_at').eq('organization_id', org).maybeSingle(),
    supabase.from('subscription_events').select('kind, from_status, to_status, created_at').eq('organization_id', org).order('created_at'),
    can(ctx, 'audit.view')
      ? supabase.from('audit_logs').select('created_at, actor_user_id, actor_type, action, target_type, target_id, metadata').eq('organization_id', org).order('created_at').limit(10000)
      : Promise.resolve({ data: [], error: null }),
  ]);
  for (const r of [organization, locations, memberships, subscription, subscriptionEvents, audit]) if (r.error) return NextResponse.json({ error: 'export failed' }, { status: 500 });

  const ids = (memberships.data ?? []).map((m) => m.user_id);
  const { data: profiles } = ids.length ? await supabase.from('profiles').select('id, email, full_name').in('id', ids) : { data: [] };

  await createAdminClient().from('audit_logs').insert({ organization_id: org, actor_user_id: ctx.user.id, actor_type: 'user', action: 'data.exported', metadata: { format: 'json' } });

  const body = JSON.stringify({
    format: 'retailnexa-export', version: 1, exported_at: new Date().toISOString(),
    organization: organization.data, locations: locations.data,
    team: (memberships.data ?? []).map((m) => ({ ...m, ...(profiles ?? []).find((p) => p.id === m.user_id) })),
    subscription: subscription.data, subscription_events: subscriptionEvents.data, audit_log: audit.data,
  }, null, 2);
  const safeName = ctx.org.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 40) || 'business';
  return new NextResponse(body, {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="retailnexa-${safeName}-${new Date().toISOString().slice(0, 10)}.json"`,
      'cache-control': 'no-store',
    },
  });
}
