import { describe, expect, it } from 'vitest';
import { parseDate } from './import';
import { htmlTableRows, looksLikeVelaSummary, parseVelaSummary } from './vela';

// Synthetic example from issue #39 (no real store data).
const CSV = `TRANSACTIONS,,,
,FIRST,,Mon 11/09/2026 10:00 AM
,LAST,,Mon 11/09/2026 7:45 PM
,COUNT,,10
,AVG SUBTOTAL,,95.00
TOTALS,,,
,SALES,,"1,000.00"
,DISCOUNT,,-20.00
,RETURNS,,-30.00
,SUBTOTAL,,950.00
,TAX,,66.50
,SALES TOTAL,,"1,016.50"
PAYMENTS,,,
,CASH,,
,SALES/REFUNDS,,316.50
,CREDIT CARD,,
,SALES,,710.00
,REFUNDS,,-10.00
,TOTAL,,700.00
SALES SUBTOTAL,,,
,HAIR,(7),600.00
,WIGS,(3),350.00
`;

const toHtml = (csv: string) => `<html><body><h3>SALES SUMMARY - 11/09/2026~11/09/2026</h3><table>${
  csv.trim().split('\n').map((l) => `<tr>${l.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((c) => `<td>${c.replace(/"/g, '').replace('&', '&amp;')}</td>`).join('')}</tr>`).join('')
}</table></body></html>`;

const expected = { businessDate: '2026-11-09', register: 'All registers', grossCents: 100_000, discountsCents: 5_000, taxCents: 6_650, cashCents: 31_650, cardCents: 70_000, creditCents: 0, transactions: 10 };

describe('Vela Sales Summary (#39)', () => {
  it('detects the format', () => {
    expect(looksLikeVelaSummary(CSV)).toBe(true);
    expect(looksLikeVelaSummary(toHtml(CSV))).toBe(true);
    expect(looksLikeVelaSummary('Date,Gross Sales,Cash\n2026-11-09,1,1')).toBe(false);
  });

  it('parses the CSV form into one balanced day', () => {
    const r = parseVelaSummary(CSV);
    expect(r.errors).toEqual([]);
    expect(r.day).toMatchObject(expected);
  });

  it('parses the HTML-in-.xls form, taking the date from the title', () => {
    expect(htmlTableRows(toHtml(CSV)).length).toBeGreaterThan(10);
    const r = parseVelaSummary(toHtml(CSV));
    expect(r.errors).toEqual([]);
    expect(r.day).toMatchObject(expected);
  });

  it('refuses multi-day exports, unbalanced payments and unknown tenders', () => {
    expect(parseVelaSummary(toHtml(CSV).replace('~11/09/2026', '~11/10/2026')).errors.join()).toMatch(/one day at a time/);
    expect(parseVelaSummary(CSV.replace(',TOTAL,,700.00', ',TOTAL,,690.00')).errors.join()).toMatch(/don’t equal/);
    const withCheck = CSV.replace('SALES SUBTOTAL,,,', ',CHECK,,\n,TOTAL,,5.00\nSALES SUBTOTAL,,,');
    expect(parseVelaSummary(withCheck).errors.join()).toMatch(/“CHECK” isn’t supported/);
  });

  it('counts store credit / gift cards as customer credit', () => {
    const csv = CSV.replace(',TOTAL,,700.00', ',TOTAL,,690.00').replace('SALES SUBTOTAL,,,', ',GIFT CARD,,\n,TOTAL,,10.00\nSALES SUBTOTAL,,,');
    const r = parseVelaSummary(csv);
    expect(r.errors).toEqual([]);
    expect(r.day).toMatchObject({ cardCents: 69_000, creditCents: 1_000 });
  });
});

describe('parseDate with time zones and weekdays (#40)', () => {
  it('converts UTC timestamps to the store day', () => {
    expect(parseDate('2026-11-06T04:59:00Z', 'America/New_York')).toBe('2026-11-05');
    expect(parseDate('2026-11-06T05:01:00Z', 'America/New_York')).toBe('2026-11-06');
    expect(parseDate('2026-11-06T04:59:00+00:00', 'America/New_York')).toBe('2026-11-05');
    expect(parseDate('2026-11-05 23:30:00-0500', 'America/Los_Angeles')).toBe('2026-11-05');
  });
  it('keeps local timestamps and accepts weekday prefixes', () => {
    expect(parseDate('11/05/2026 11:59 PM', 'America/New_York')).toBe('2026-11-05');
    expect(parseDate('Mon 11/09/2026 10:00 AM')).toBe('2026-11-09');
    expect(parseDate('Monday, 11/09/2026')).toBe('2026-11-09');
  });
});

describe('Vela payments grand total (#58)', () => {
  // Same numbers as #39, plus per-tender TOTAL rows and the grand TOTAL Vela writes at the end of PAYMENTS.
  const WITH_GRAND = CSV.replace(',SALES/REFUNDS,,316.50', ',SALES/REFUNDS,,316.50\n,TOTAL,,316.50')
    .replace(',TOTAL,,700.00', ',TOTAL,,700.00\n,TOTAL,,"1,016.50"');
  it('ignores the grand total instead of adding it to card', () => {
    const r = parseVelaSummary(WITH_GRAND);
    expect(r.errors).toEqual([]);
    expect(r.day).toMatchObject(expected);
    expect(r.warnings).toEqual([]);
  });
  it('also works in the HTML form', () => {
    expect(parseVelaSummary(toHtml(WITH_GRAND)).day).toMatchObject(expected);
  });
  it('warns when the grand total disagrees with the tenders', () => {
    const r = parseVelaSummary(WITH_GRAND.replace('"1,016.50"\nSALES SUBTOTAL', '"1,000.00"\nSALES SUBTOTAL'));
    expect(r.day).toMatchObject(expected);
    expect(r.warnings.join()).toMatch(/payments TOTAL/);
  });
});

