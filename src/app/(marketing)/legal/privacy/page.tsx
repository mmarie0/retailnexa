import type { Metadata } from 'next';
import { LegalPage } from '@/components/marketing/legal-page';

export const metadata: Metadata = { title: 'Privacy policy' };

export default function Privacy() {
  return (
    <LegalPage title="Privacy policy" updated="November 9, 2026" sections={[
      { heading: 'What we collect', body: ['Account details (names, emails, business details), the business records you enter or import, and technical logs needed to keep the service secure and working. When you request a demo or contact us, we keep what you send in the form.'] },
      { heading: 'How we use it', body: ['To run your account, provide support you ask for, process payments through Stripe, keep the service secure, and send service messages about your account. We do not sell personal information.'] },
      { heading: 'Who can see your business records', body: ['Only people you invite, limited by the roles you assign. RetailNexa support staff cannot see your business records unless an owner grants time-limited support access, and every such access is recorded in your audit log.'] },
      { heading: 'Service providers', body: ['We use Supabase (database, authentication and file storage), Vercel (hosting) and Stripe (payments). Each processes data only to provide its service to us.'] },
      { heading: 'Retention', body: ['We keep your records while your account is open and for at least 12 months after a subscription ends, so you can export or reactivate. Owners can ask us to delete their data sooner.'] },
      { heading: 'Your choices', body: ['You can access, correct and export your data from the app, and contact us to delete it.'] },
    ]} />
  );
}
