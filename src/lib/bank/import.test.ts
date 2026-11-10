import { describe, expect, it } from 'vitest';
import { guessBankMapping, rowsToBankLines } from './import';

describe('guessBankMapping', () => {
  it('maps signed-amount exports', () => {
    expect(guessBankMapping(['Posting Date', 'Description', 'Amount', 'Type', 'Balance'])).toEqual({ date: 0, description: 1, amount: 2 });
  });
  it('maps debit/credit exports', () => {
    expect(guessBankMapping(['Date', 'Details', 'Withdrawals', 'Deposits'])).toEqual({ date: 0, description: 1, moneyOut: 2, moneyIn: 3 });
  });
});

describe('rowsToBankLines', () => {
  it('reads signed amounts, numbers repeated identical lines, and reports bad rows', () => {
    const { lines, errors } = rowsToBankLines([
      ['11/04/2026', 'STRIPE TRANSFER', '971.00'],
      ['11/07/2026', 'ATM  WITHDRAWAL', '-20.00'],
      ['11/07/2026', 'ATM WITHDRAWAL', '-20.00'],
      ['nope', 'X', '1'],
      ['11/08/2026', 'ZERO', '0.00'],
    ], { date: 0, description: 1, amount: 2 });
    expect(lines.map((l) => [l.date, l.amountCents, l.occurrence])).toEqual([['2026-11-04', 97100, 1], ['2026-11-07', -2000, 1], ['2026-11-07', -2000, 2]]);
    expect(errors.map((e) => e.line)).toEqual([5, 6]);
  });
  it('combines debit/credit columns and can flip the sign', () => {
    const rows = [['2026-11-06', 'FEE', '15.00', ''], ['2026-11-05', 'DEPOSIT', '', '500.00']];
    const m = { date: 0, description: 1, moneyOut: 2, moneyIn: 3 };
    expect(rowsToBankLines(rows, m).lines.map((l) => l.amountCents)).toEqual([-1500, 50000]);
    expect(rowsToBankLines(rows, m, { flipSign: true }).lines.map((l) => l.amountCents)).toEqual([1500, -50000]);
  });
});
