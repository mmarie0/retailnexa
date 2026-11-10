/** Accounts-payable aging: open approved bills bucketed by days past due on an as-of date. */
export const AGING_BUCKETS = ['current', '1-30', '31-60', '61-90', '90+'] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];
export interface OpenBill { vendorId: string; vendorName: string; dueDate: string; openCents: number }
export interface AgingRow { vendorId: string; vendorName: string; buckets: Record<AgingBucket, number>; total: number }

export function bucketFor(dueDate: string, asOf: string): AgingBucket {
  const days = Math.round((Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${dueDate}T00:00:00Z`)) / 86_400_000);
  if (days <= 0) return 'current';
  if (days <= 30) return '1-30';
  if (days <= 60) return '31-60';
  if (days <= 90) return '61-90';
  return '90+';
}

const empty = (): Record<AgingBucket, number> => ({ current: 0, '1-30': 0, '31-60': 0, '61-90': 0, '90+': 0 });

export function agingReport(bills: OpenBill[], asOf: string) {
  const byVendor = new Map<string, AgingRow>();
  const totals = empty();
  for (const b of bills) {
    if (b.openCents <= 0) continue;
    const k = bucketFor(b.dueDate, asOf);
    const row = byVendor.get(b.vendorId) ?? { vendorId: b.vendorId, vendorName: b.vendorName, buckets: empty(), total: 0 };
    row.buckets[k] += b.openCents;
    row.total += b.openCents;
    totals[k] += b.openCents;
    byVendor.set(b.vendorId, row);
  }
  const rows = [...byVendor.values()].sort((a, b) => b.total - a.total || a.vendorName.localeCompare(b.vendorName));
  return { rows, totals, total: rows.reduce((a, r) => a + r.total, 0) };
}

export interface BillAsOfInput {
  billDate: string;
  totalCents: number;
  /** True once approved (posted to AP on the bill date). */
  posted: boolean;
  /** Business date the bill's void reversal was posted, if voided. */
  voidedOn: string | null;
  payments: { paidOn: string; amountCents: number; voided: boolean }[];
}

/**
 * What was still owed on a bill at the end of `asOf`, matching Accounts payable
 * on the balance sheet for that date (#37): only posted bills dated on/before
 * as-of, not yet voided by then, less non-voided payments dated on/before as-of.
 * (Voided payments are reversed on their own payment date, so they never count.)
 */
export function openAsOf(b: BillAsOfInput, asOf: string): number {
  if (!b.posted || b.billDate > asOf) return 0;
  if (b.voidedOn && b.voidedOn <= asOf) return 0;
  const paid = b.payments.filter((p) => !p.voided && p.paidOn <= asOf).reduce((a, p) => a + p.amountCents, 0);
  return Math.max(0, b.totalCents - paid);
}
