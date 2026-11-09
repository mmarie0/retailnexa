import type { Metadata } from 'next';
import { LegalPage } from '@/components/marketing/legal-page';

export const metadata: Metadata = { title: 'Terms of service' };

export default function Terms() {
  return (
    <LegalPage title="Terms of service" updated="November 9, 2026" sections={[
      { heading: 'Who these terms cover', body: ['These terms apply to businesses that create a RetailNexa account and to the people they invite. The person who creates the account confirms they are authorised to accept these terms for the business.'] },
      { heading: 'Your account and team', body: ['You are responsible for who you invite and the roles you give them, and for keeping login details secure. Tell us promptly if you suspect unauthorised access.'] },
      { heading: 'Your data', body: ['Your business records belong to you. We process them only to provide the service, as described in our privacy policy. You can export your data at any time.'] },
      { heading: 'Financial figures and estimates', body: ['RetailNexa calculates figures from the records you enter or import. Projections and AI-generated answers are estimates and are labelled as such. They are not tax, legal or accounting advice; consult a qualified professional.'] },
      { heading: 'Acceptable use', body: ['Do not use the service to break the law, to access other customers’ data, to interfere with the service, or to resell it without our written permission.'] },
      { heading: 'Subscriptions', body: ['Paid plans, trials and cancellations are covered by the subscription terms, which form part of these terms.'] },
      { heading: 'Suspension', body: ['We may suspend an account for non-payment, a security risk, or a serious breach of these terms. Suspended accounts can still export their data.'] },
      { heading: 'Changes', body: ['We will give at least 30 days’ notice of material changes to these terms by email to account owners.'] },
    ]} />
  );
}
