export const fmtDate = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });

export type BillStatus = 'draft' | 'approved' | 'paid' | 'void';
export const STATUS_LABEL: Record<BillStatus, string> = { draft: 'Draft', approved: 'Unpaid', paid: 'Paid', void: 'Void' };
export const STATUS_TONE: Record<BillStatus, 'neutral' | 'info' | 'good' | 'warning' | 'danger'> = {
  draft: 'neutral', approved: 'info', paid: 'good', void: 'warning',
};

/** Days past due on `today` (YYYY-MM-DD, business-local), or 0. */
export function daysOverdue(dueDate: string, today: string): number {
  const ms = Date.parse(`${today}T00:00:00Z`) - Date.parse(`${dueDate}T00:00:00Z`);
  return ms > 0 ? Math.round(ms / 86_400_000) : 0;
}
