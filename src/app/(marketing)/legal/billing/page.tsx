import type { Metadata } from 'next';
import { LegalPage } from '@/components/marketing/legal-page';
import { TRIAL_DAYS } from '@/lib/billing/plans';

export const metadata: Metadata = { title: 'Subscription terms' };

export default function BillingTerms() {
  return (
    <LegalPage title="Subscription and free trial terms" updated="November 9, 2026" sections={[
      { heading: 'Free trial', body: [
        `New accounts get one ${TRIAL_DAYS}-day free trial per business. A valid payment method is required to start it. We do not charge the subscription fee when you sign up.`,
        `When the trial ends, your subscription starts automatically and the first monthly payment is charged to your payment method, unless you cancel before the trial ends.`,
      ] },
      { heading: 'Billing', body: [
        'Subscriptions are billed monthly in advance through Stripe, our payment processor. Prices are shown on the pricing page and exclude applicable taxes.',
        'Card details are collected and stored by Stripe. RetailNexa never receives or stores full card numbers.',
        'If a payment fails, Stripe will retry it. You keep full access for 7 days after a failed payment; after that your account becomes read-only until payment succeeds.',
      ] },
      { heading: 'Cancelling', body: [
        'Owners can cancel at any time from the billing page. Cancellation takes effect at the end of the current billing period, and you keep access until then. Fees already paid are not refunded except where required by law.',
        'Cancelling does not delete your records. After your subscription ends your account is read-only, and you can export your data or reactivate at any time.',
      ] },
      { heading: 'Data retention after cancellation', body: [
        'We keep the records of a cancelled account for at least 12 months after the subscription ends. Before any deletion we will contact the account owner. You can ask us to delete your data sooner by contacting support.',
      ] },
    ]} />
  );
}
