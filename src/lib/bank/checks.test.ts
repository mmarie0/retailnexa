import { describe, expect, it } from 'vitest';
import { calendarMonth, checkNumber, checkRegister, matchCardDeposits } from './checks';

describe('check register', () => {
  const pays = [
    { id: 'p1', paid_on: '2026-10-01', amount_cents: 50000, reference: '1001', payee: 'Outre', journal_entry_id: 'j1' },
    { id: 'p2', paid_on: '2026-10-20', amount_cents: 20000, reference: 'Check #1002'.replace('Check #', 'Check '), payee: 'Sensationnel', journal_entry_id: 'j2' },
    { id: 'p3', paid_on: '2026-10-21', amount_cents: 999, reference: 'ACH-77', payee: 'Power', journal_entry_id: 'j3' },
    { id: 'p4', paid_on: '2026-10-22', amount_cents: 1, reference: '1003', payee: 'Voided', journal_entry_id: 'j4' },
  ];
  const lines = [{ id: 'l1', posted_on: '2026-10-05', description: 'CHECK 1001', amount_cents: -50000, status: 'matched', journal_entry_id: 'j1' }];
  it('check numbers', () => {
    expect(['1001', '#1002', 'Check 1003', 'chk 99999', 'ACH-1', '12', null].map(checkNumber)).toEqual(['1001', '1002', '1003', '99999', null, null, null]);
  });
  it('cleared vs outstanding; voided left out; checks only', () => {
    const r = checkRegister(pays, new Set(['p4']), lines, '2026-11-11', true);
    expect(r.map((c) => [c.id, c.number, c.clearedOn, c.days, c.stale])).toEqual([['p2', '1002', null, 22, true], ['p1', '1001', '2026-10-05', 4, false]]);
    expect(checkRegister(pays, new Set(), lines, '2026-11-11', false)).toHaveLength(4);
  });
  it('calendar puts checks and withdrawals on their days', () => {
    const cal = calendarMonth('2026-10', checkRegister(pays, new Set(), lines, '2026-11-11', false), lines);
    expect(cal.lead).toBe(4); // Oct 1 2026 is a Thursday
    expect(cal.days).toHaveLength(31);
    expect(cal.days[0]).toMatchObject({ checkCents: 50000, outCents: 0 });
    expect(cal.days[4]).toMatchObject({ outCents: 50000 });
  });
});

describe('card deposits', () => {
  const days = [{ date: '2026-11-01', cardCents: 100000 }, { date: '2026-11-02', cardCents: 50000 }, { date: '2026-11-03', cardCents: 80000 }, { date: '2026-11-04', cardCents: 0 }];
  it('matches 1–3 day windows 1–5 days back near 97.5%, uses each day once, flags missing days', () => {
    const r = matchCardDeposits(days, [
      { id: 'd1', date: '2026-11-03', amountCents: 146_250, description: 'MERCHANT DEP' }, // Nov 1+2 = 150,000 × 97.5%
      { id: 'd2', date: '2026-11-04', amountCents: 5_000, description: 'CASH DEP' },
    ], '2026-11-11');
    expect(r.matches.map((m) => [m.deposit.id, m.from, m.to, m.expectedCents, m.feePct])).toEqual([['d1', '2026-11-01', '2026-11-02', 150000, 2.5]]);
    expect(r.other.map((d) => d.id)).toEqual(['d2']);
    expect(r.missing).toEqual([{ date: '2026-11-03', cardCents: 80000 }]);
    expect(r.feePct).toBe(2.5);
  });
  it('a deposit over 100.5% or under 93% does not fit; recent days aren’t missing yet', () => {
    const r = matchCardDeposits([{ date: '2026-11-08', cardCents: 100000 }], [{ id: 'x', date: '2026-11-09', amountCents: 100_600, description: '' }], '2026-11-11');
    expect(r.matches).toEqual([]);
    expect(r.missing).toEqual([]);
  });
});
