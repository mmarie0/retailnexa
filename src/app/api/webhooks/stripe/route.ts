import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { getStripe } from '@/lib/billing/stripe';
import { liveWebhookDeps } from '@/lib/billing/deps';
import { handleStripeEvent } from '@/lib/billing/webhook';
import { isStripeConfigured, isSupabaseConfigured, stripeEnv } from '@/lib/env';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  if (!isStripeConfigured() || !isSupabaseConfigured()) {
    return NextResponse.json({ error: 'billing not configured' }, { status: 503 });
  }
  const signature = request.headers.get('stripe-signature');
  if (!signature) return NextResponse.json({ error: 'missing signature' }, { status: 400 });

  const body = await request.text(); // raw body is required for signature verification
  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(body, signature, stripeEnv().webhookSecret);
  } catch {
    return NextResponse.json({ error: 'invalid signature' }, { status: 400 });
  }

  try {
    const result = await handleStripeEvent(event, liveWebhookDeps());
    return NextResponse.json({ received: true, ...result });
  } catch (err) {
    console.error('[stripe webhook] processing failed', event.id, event.type, err);
    // 500 makes Stripe retry; the event is marked failed so the retry is re-processed.
    return NextResponse.json({ error: 'processing failed' }, { status: 500 });
  }
}
