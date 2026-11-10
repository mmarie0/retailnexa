import 'server-only';
import Stripe from 'stripe';
import { stripeEnv } from '@/lib/env';

let client: Stripe | null = null;

export function getStripe(): Stripe {
  if (!client) {
    client = new Stripe(stripeEnv().secretKey, {
      maxNetworkRetries: 2,
      appInfo: { name: 'RetailNexa' },
    });
  }
  return client;
}
