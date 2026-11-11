/**
 * Location balances (#106), copied from the owner's RetailNexa app: what other
 * stores owe this store and what it owes them. Pure; money in integer cents.
 */
export type Direction = 'owed_to_me' | 'i_owe';
export interface BalanceRow {
  id: string; direction: Direction; location_id: string; other_party: string; entry_date: string; due_date: string | null;
  count_month: string; amount_cents: number; lines: { description: string; amount_cents: number }[]; reference: string | null; note: string | null;
}
export interface BalancePayment { id: string; balance_id: string; paid_on: string; amount_cents: number; method: string; reference: string | null }
export type Status = 'settled' | 'late' | 'soon' | 'open';
export interface Balance extends BalanceRow { paid: number; left: number; status: Status; payments: BalancePayment[] }

export const METHODS = { cash: 'Cash', check: 'Check', ach: 'Bank transfer (ACH)', zelle: 'Zelle', card: 'Card', offset: 'Offset', other: 'Other' } as const;
export const DIRECTION_LABEL: Record<Direction, string> = { owed_to_me: 'They owe me', i_owe: 'I owe them' };

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Each balance with what's paid, what's left and a status dot (late = past due; soon = due within 5 days). */
export function withPayments(rows: BalanceRow[], payments: BalancePayment[], today: string): Balance[] {
  const by = new Map<string, BalancePayment[]>();
  for (const p of payments) by.set(p.balance_id, [...(by.get(p.balance_id) ?? []), { ...p, amount_cents: Number(p.amount_cents) }]);
  return rows.map((r) => {
    const ps = (by.get(r.id) ?? []).sort((a, b) => a.paid_on.localeCompare(b.paid_on));
    const amount = Number(r.amount_cents), paid = ps.reduce((a, p) => a + p.amount_cents, 0), left = Math.max(0, amount - paid);
    const status: Status = left === 0 ? 'settled' : r.due_date && r.due_date < today ? 'late' : r.due_date && r.due_date <= addDays(today, 5) ? 'soon' : 'open';
    return { ...r, amount_cents: amount, paid, left, status, payments: ps };
  });
}

/** Month-end check for a month (by the month each balance counts in): Due / Done / Left, both ways. */
export function monthCheck(balances: Balance[], ym: string) {
  const one = (dir: Direction) => {
    const xs = balances.filter((b) => b.direction === dir && b.count_month.startsWith(ym));
    const due = xs.reduce((a, b) => a + b.amount_cents, 0), done = xs.reduce((a, b) => a + Math.min(b.paid, b.amount_cents), 0);
    return { due, done, left: due - done, count: xs.length, open: xs.filter((b) => b.left > 0).length };
  };
  const owedToMe = one('owed_to_me'), iOwe = one('i_owe');
  return { owedToMe, iOwe, net: owedToMe.left - iOwe.left };
}

/** What's still open, each way, across all months (for the profit calculator and Overview). */
export function openTotals(balances: Balance[]) {
  let owedToMe = 0, iOwe = 0;
  for (const b of balances) if (b.direction === 'owed_to_me') owedToMe += b.left; else iOwe += b.left;
  return { owedToMe, iOwe };
}

/** In / out per month for profit: what other stores owe counts as revenue, what this store owes as a cost. */
export function byMonth(balances: Balance[]): Map<string, { in: number; out: number }> {
  const m = new Map<string, { in: number; out: number }>();
  for (const b of balances) {
    const ym = b.count_month.slice(0, 7), v = m.get(ym) ?? { in: 0, out: 0 };
    if (b.direction === 'owed_to_me') v.in += b.amount_cents; else v.out += b.amount_cents;
    m.set(ym, v);
  }
  return m;
}

export interface Filters { dir: Direction | 'all'; show: 'open' | 'all' | 'settled'; party: string }
export function filterBalances(balances: Balance[], f: Filters): Balance[] {
  const q = f.party.trim().toLowerCase();
  return balances
    .filter((b) => (f.dir === 'all' || b.direction === f.dir) && (f.show === 'all' || (f.show === 'open' ? b.left > 0 : b.left === 0)) && (!q || b.other_party.toLowerCase().includes(q)))
    .sort((a, b) => (a.left > 0 ? 0 : 1) - (b.left > 0 ? 0 : 1) || (a.due_date ?? a.entry_date).localeCompare(b.due_date ?? b.entry_date));
}

/** Line items typed one per line, amount last: "Wigs 120.00", "Edge control, 2 boxes  $18.50". */
export function parseLines(text: string, parse: (s: string) => number | null): { lines: { description: string; amount_cents: number }[]; error: string | null } {
  const lines: { description: string; amount_cents: number }[] = [];
  const rows = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (rows.length > 50) return { lines: [], error: 'Up to 50 lines.' };
  for (const [i, l] of rows.entries()) {
    const m = /^(.*?)[\s,:-]+(\(?-?\$?[\d,]+(?:\.\d{1,2})?\)?)$/.exec(l);
    const cents = m ? parse(m[2]) : null;
    const desc = m?.[1].replace(/[\s,:-]+$/, '').trim() ?? '';
    if (!m || cents === null || !desc) return { lines: [], error: `Line ${i + 1}: write a description, then the amount (like “Wigs 120.00”).` };
    lines.push({ description: desc.slice(0, 120), amount_cents: cents });
  }
  return { lines, error: null };
}
