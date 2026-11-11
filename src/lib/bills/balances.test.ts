import { describe, expect, it } from 'vitest';
import { parseLines, byMonth, filterBalances, monthCheck, openTotals, withPayments, type BalanceRow } from './balances';

const row = (id: string, o: Partial<BalanceRow> = {}): BalanceRow => ({
  id, direction: 'owed_to_me', location_id: 'A', other_party: 'JLO Brandon', entry_date: '2026-10-20', due_date: '2026-11-05',
  count_month: '2026-10-01', amount_cents: 10000, lines: [], reference: null, note: null, ...o,
});
const today = '2026-11-11';

describe('location balances', () => {
  const bs = withPayments(
    [row('a'), row('b', { direction: 'i_owe', other_party: 'Warehouse', amount_cents: 4000, due_date: '2026-11-14' }), row('c', { count_month: '2026-11-01', due_date: null })],
    [{ id: 'p1', balance_id: 'a', paid_on: '2026-11-01', amount_cents: 6000, method: 'zelle', reference: null }, { id: 'p2', balance_id: 'c', paid_on: '2026-11-02', amount_cents: 10000, method: 'cash', reference: null }],
    today,
  );
  it('paid, left and status', () => {
    expect(bs.map((b) => [b.id, b.paid, b.left, b.status])).toEqual([['a', 6000, 4000, 'late'], ['b', 0, 4000, 'soon'], ['c', 10000, 0, 'settled']]);
  });
  it('month-end check by the month a balance counts in', () => {
    expect(monthCheck(bs, '2026-10')).toEqual({ owedToMe: { due: 10000, done: 6000, left: 4000, count: 1, open: 1 }, iOwe: { due: 4000, done: 0, left: 4000, count: 1, open: 1 }, net: 0 });
    expect(monthCheck(bs, '2026-11').owedToMe).toEqual({ due: 10000, done: 10000, left: 0, count: 1, open: 0 });
  });
  it('open totals, months and filters', () => {
    expect(openTotals(bs)).toEqual({ owedToMe: 4000, iOwe: 4000 });
    expect(byMonth(bs).get('2026-10')).toEqual({ in: 10000, out: 4000 });
    expect(filterBalances(bs, { dir: 'all', show: 'open', party: '' }).map((b) => b.id)).toEqual(['a', 'b']);
    expect(filterBalances(bs, { dir: 'i_owe', show: 'all', party: 'ware' }).map((b) => b.id)).toEqual(['b']);
    expect(filterBalances(bs, { dir: 'all', show: 'settled', party: '' }).map((b) => b.id)).toEqual(['c']);
  });
});

describe('line items', () => {
  const amt = (s: string) => { const n = Number(s.replace(/[$,()]/g, '')); return Number.isFinite(n) ? Math.round(n * 100) * (s.startsWith('(') ? -1 : 1) : null; };
  it('reads a description then an amount per line', () => {
    expect(parseLines('Wigs 120.00\nEdge control, 2 boxes  $18.50\n\n', amt)).toEqual({ lines: [{ description: 'Wigs', amount_cents: 12000 }, { description: 'Edge control, 2 boxes', amount_cents: 1850 }], error: null });
    expect(parseLines('just words', amt).error).toMatch(/Line 1/);
    expect(parseLines('', amt)).toEqual({ lines: [], error: null });
  });
});
