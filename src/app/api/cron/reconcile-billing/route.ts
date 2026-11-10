import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { cronSecret, isStripeConfigured, isSupabaseConfigured } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase/admin';
import { liveWebhookDeps } from '@/lib/billing/deps';
import { syncFromStripe } from '@/lib/billing/webhook';

export const runtime = 'nodejs';
export const maxDuration = 300;

function authorized(request: Request) {
  const secret = cronSecret();
  const got = request.headers.get('authorization') ?? '';
  const want = `Bearer ${secret}`;
  return !!secret && got.length === want.length && timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

/**
 * Daily safety net (Vercel Cron): re-syncs subscriptions not refreshed in 20h
 * from Stripe, in case a webhook was missed. Read-only towards Stripe.
 */
export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!isStripeConfigured() || !isSupabaseConfigured()) return NextResponse.json({ error: 'not configured' }, { status: 503 });

  const db = createAdminClient();
  const cutoff = new Date(Date.now() - 20 * 3600_000).toISOString();
  const { data, error } = await db
    .from('subscriptions')
    .select('stripe_subscription_id')
    .lt('stripe_synced_at', cutoff)
    .not('status', 'in', '(canceled,incomplete_expired)')
    .limit(500);
  if (error) return NextResponse.json({ error: 'query failed' }, { status: 500 });

  const deps = liveWebhookDeps();
  let synced = 0;
  const failures: string[] = [];
  for (const row of data ?? []) {
    try {
      await syncFromStripe(deps, row.stripe_subscription_id, null);
      synced++;
    } catch (e) {
      failures.push(row.stripe_subscription_id);
      console.error('[cron reconcile] failed', row.stripe_subscription_id, e);
    }
  }
  return NextResponse.json({ checked: data?.length ?? 0, synced, failed: failures.length });
}
