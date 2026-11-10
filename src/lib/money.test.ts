import { describe, expect, it } from 'vitest';
import { centsToInput, parseDollarsToCents } from './money';

describe('parseDollarsToCents', () => {
  it('accepts trailing zeros but never drops a significant third decimal (#94)', () => {
    expect(parseDollarsToCents('12.500')).toBe(1250);
    expect(parseDollarsToCents('.500')).toBe(50);
    expect(parseDollarsToCents('12.345')).toBeNull();
    expect(parseDollarsToCents('0.999')).toBeNull();
    expect(parseDollarsToCents('1.005')).toBeNull();
  });
  it.each([
    ['0', 0], ['12', 1200], ['12.3', 1230], ['12.34', 1234], ['$1,234.56', 123456], [' 7. ', 700], ['.5', 50], ['0.01', 1],
    ['0.29', 29], ['1.10', 110],
  ])('%s → %d', (input, cents) => expect(parseDollarsToCents(input)).toBe(cents));

  it.each(['', '-1', '1.234', 'abc', '1e3', '12..3', '$', '.', '12345678901', null, undefined])('rejects %s', (input) =>
    expect(parseDollarsToCents(input as string)).toBeNull());
});

describe('centsToInput', () => {
  it('round-trips', () => {
    for (const c of [0, 1, 29, 110, 123456]) expect(parseDollarsToCents(centsToInput(c))).toBe(c);
    expect(centsToInput(-150)).toBe('-1.50');
  });
});
