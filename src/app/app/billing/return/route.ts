import { NextResponse, type NextRequest } from 'next/server';
import { unstable_rethrow } from 'next/navigation';
import { getOrgContext, getSupabase } from '@/lib/auth/context';
import { getStripe } from '@/lib/billing/stripe';
import { liveWebhookDeps } from '@/lib/billing/deps';
import { syncFromStripe } from '@/lib/billing/webhook';

/**
 * Stripe Checkout success return. Verifies the session belongs to the caller's
 * active organization and syncs immediately so the user doesn't wait for the
 * webhook. Safe to call repeatedly (sync is idempotent).
 */
export async function GET(request: NextRequest) {
  const to = (q: string) => NextResponse.redirect(new URL(`/app/billing?checkout=${q}`, request.url), { status: 303 });
  const sessionId = request.nextUrl.searchParams.get('session_id');
  if (!sessionId || !/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return to('unknown');
  try {
    const ctx = await getOrgContext();
    const session = await getStripe().checkout.sessions.retrieve(sessionId);
    const supabase = await getSupabase();
    const { data: account } = await supabase.from('billing_accounts').select('stripe_customer_id').eq('organization_id', ctx.org.id).maybeSingle();
    const customer = typeof session.customer === 'string' ? session.customer : session.customer?.id;
    if (session.client_reference_id !== ctx.org.id || !account || account.stripe_customer_id !== customer) return to('unknown');
    if (session.status === 'complete' && session.subscription) {
      const subId = typeof session.subscription === 'string' ? session.subscription : session.subscription.id;
      await syncFromStripe(liveWebhookDeps(), subId, null, ctx.org.id);
      return to('success');
    }
    return to('pending');
  } catch (e) {
    unstable_rethrow(e);
    console.error('[billing return]', e);
    return to('pending');
  }
}
