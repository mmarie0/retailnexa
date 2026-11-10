import { describe, expect, it } from 'vitest';
import { parseCsv, detectDelimiter } from './csv';
import { guessMapping, parseAmount, parseDate, rowsToSalesDays } from './import';

describe('parseCsv', () => {
  it('handles quotes, escaped quotes, embedded commas/newlines, CRLF and BOM', () => {
    const rows = parseCsv('﻿a,b,c\r\n"1,000.00","say ""hi""","line1\nline2"\r\n\r\nx,,z');
    expect(rows).toEqual([['a', 'b', 'c'], ['1,000.00', 'say "hi"', 'line1\nline2'], ['x', '', 'z']]);
  });
  it('detects tab and semicolon files', () => {
    expect(detectDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t');
    expect(parseCsv('a;b\n1;2')).toEqual([['a', 'b'], ['1', '2']]);
  });
});

describe('parseAmount / parseDate', () => {
  it.each([['$1,234.56', 123456], ['(12.00)', -1200], ['-3', -300], ['', 0], ['7.5', 750]])('%s', (s, c) =>
    expect(parseAmount(s)).toBe(c));
  it('rejects junk', () => { expect(parseAmount('abc')).toBeNull(); expect(parseAmount('1.2.3')).toBeNull(); });
  it('never drops a third decimal (#27 L2)', () => {
    expect(parseAmount('12.345')).toBeNull();
    expect(parseAmount('0.999')).toBeNull();
    expect(parseAmount('1.005')).toBeNull();
    expect(parseAmount('12.500')).toBe(1250);
    expect(parseAmount('3.10')).toBe(310);
  });
  it.each([['2026-11-06', '2026-11-06'], ['11/6/2026', '2026-11-06'], ['11/06/26', '2026-11-06'], ['11/06/2026 11:59 PM', '2026-11-06']])('%s', (s, d) =>
    expect(parseDate(s)).toBe(d));
  it('rejects impossible dates', () => { expect(parseDate('02/30/2026')).toBeNull(); expect(parseDate('nope')).toBeNull(); });
});

describe('guessMapping', () => {
  it('maps common POS headers, preferring exact matches and using each column once', () => {
    const m = guessMapping(['Date', 'Register Name', 'Gross Sales', 'Discount', 'Sales Tax', 'Cash', 'Credit Card', 'Gift Card', 'Transactions', 'Net Sales']);
    expect(m).toEqual({ date: 0, register: 1, gross: 2, discounts: 3, tax: 4, cash: 5, card: 6, credit: 7, transactions: 8 });
  });
});

describe('rowsToSalesDays', () => {
  const headers = ['Date', 'Register', 'Gross Sales', 'Discounts', 'Tax', 'Cash', 'Card'];
  const map = guessMapping(headers);

  it('converts valid rows and treats negative discounts as reductions', () => {
    const { days, errors } = rowsToSalesDays([['11/06/2026', 'Register 1', '$1,000.00', '-50.00', '71.25', '300.00', '721.25']], map);
    expect(errors).toEqual([]);
    expect(days[0]).toMatchObject({ businessDate: '2026-11-06', register: 'Register 1', grossCents: 100000, discountsCents: 5000, taxCents: 7125, cashCents: 30000, cardCents: 72125 });
  });

  it('reports rows whose payments don’t add up, bad dates, and duplicates — with file line numbers', () => {
    const { days, errors } = rowsToSalesDays([
      ['2026-11-06', 'R1', '100', '0', '7', '50', '50'],
      ['13/45/2026', 'R1', '100', '0', '0', '100', '0'],
      ['2026-11-07', 'R1', '10', '0', '0', '10', '0'],
      ['2026-11-07', 'r1', '10', '0', '0', '10', '0'],
    ], map);
    expect(days).toHaveLength(1);
    expect(errors.map((e) => e.line)).toEqual([2, 3, 5]);
    expect(errors[0].message).toMatch(/don’t equal/);
  });

  it('defaults the register when no column is mapped', () => {
    const { days } = rowsToSalesDays([['2026-11-06', '5', '5']], { date: 0, gross: 1, cash: 2 });
    expect(days[0].register).toBe('All registers');
  });
});
