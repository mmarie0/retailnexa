import type { Metadata } from 'next';
import { can, getOrgContext } from '@/lib/auth/context';
import { Notice } from '@/components/ui';
import { ComingSoon } from '../_soon';

export const metadata: Metadata = { title: 'Staff' };

export default async function StaffPage() {
  const ctx = await getOrgContext();
  if (!(['employees.view', 'schedule.view', 'payroll.view'] as const).some((p) => can(ctx, p))) return <Notice tone="warning">Staff pages are for owners and managers.</Notice>;
  return (
    <ComingSoon title="Staff" tracking="parity #102" intro="Employees, schedules, payroll, paystubs and labor %, the same as in your RetailNexa app."
      items={['Employees: current and former, pay type, rate and payment method', 'Weekly schedule: print, copy last week, schedule cost', 'Payroll: pay runs, advances, overtime and lunch rules, employer tax', 'Paystub PDFs with your business header', 'Labor % against your target, by weekday and day']} />
  );
}
