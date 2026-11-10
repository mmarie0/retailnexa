import type { Metadata } from 'next';
import { getOrgContext } from '@/lib/auth/context';
import { ComingSoon } from '../_soon';

export const metadata: Metadata = { title: 'Staff' };

export default async function StaffPage() {
  await getOrgContext();
  return (
    <ComingSoon title="Staff" tracking="parity #102" intro="Employees, schedules, payroll, paystubs and labor %, the same as in your RetailNexa app."
      items={['Employees: current and former, pay type, rate and payment method', 'Weekly schedule: print, copy last week, schedule cost', 'Payroll: pay runs, advances, overtime and lunch rules, employer tax', 'Paystub PDFs with your business header', 'Labor % against your target, by weekday and day']} />
  );
}
