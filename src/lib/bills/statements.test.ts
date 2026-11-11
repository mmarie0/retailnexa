import { describe, expect, it } from 'vitest';
import { matchStatement, notOnStatement, numKey, parseStatementSheet, type BillLite, type StatementLine } from './statements';

const bills: BillLite[] = [
  { id: 'b1', bill_number: 'INV-00123', bill_date: '2026-10-02', total_cents: 50000, status: 'approved' },
  { id: 'b2', bill_number: '555', bill_date: '2026-10-10', total_cents: 20000, status: 'approved' },
  { id: 'b3', bill_number: 'X9', bill_date: '2026-10-15', total_cents: 7500, status: 'approved' },
  { id: 'b4', bill_number: 'V1', bill_date: '2026-10-16', total_cents: 1, status: 'void' },
  { id: 'b5', bill_number: '777', bill_date: '2026-10-20', total_cents: 900, status: 'draft' },
];
const ln = (id: string, o: Partial<StatementLine>): StatementLine => ({ id, line_date: '2026-10-02', reference: null, description: null, amount_cents: 100, bill_id: null, dismissed: false, ...o });

describe('vendor statement matching', () => {
  it('numbers compare loosely', () => {
    expect(['INV-00123', '#123', 'inv123', '0123', 'A-12'].map(numKey)).toEqual(['123', '123', '123', '123', 'a12']);
  });
  it('linked, by number, by amount; flags missing, differing amounts, credits and set-aside lines', () => {
    const r = matchStatement([
      ln('l1', { reference: '123', amount_cents: 50000 }),
      ln('l2', { reference: '555', amount_cents: 21000 }),
      ln('l3', { line_date: '2026-10-12', amount_cents: 7500 }),
      ln('l4', { reference: '999', amount_cents: 4000 }),
      ln('l5', { reference: 'PMT', amount_cents: -30000 }),
      ln('l6', { reference: '1000', amount_cents: 5, dismissed: true }),
      ln('l7', { reference: 'whatever', amount_cents: 900, bill_id: 'b5' }),
    ], bills);
    expect(r.lines.map((m) => [m.id, m.status, m.bill?.id ?? null, m.how])).toEqual([
      ['l1', 'matched', 'b1', 'number'], ['l2', 'amount_differs', 'b2', 'number'], ['l3', 'matched', 'b3', 'amount'],
      ['l4', 'missing', null, null], ['l5', 'credit', null, null], ['l6', 'set_aside', null, null], ['l7', 'matched', 'b5', 'linked'],
    ]);
    expect(r.totals.missing).toBe(4000);
    expect(notOnStatement(r.lines, [...bills, { id: 'b6', bill_number: '8', bill_date: '2026-10-25', total_cents: 1, status: 'approved' }], '2026-10-01', '2026-10-31').map((b) => b.id)).toEqual(['b6']);
  });
  it('an amount match needs exactly one bill within 7 days', () => {
    const two: BillLite[] = [{ id: 'a', bill_number: '1', bill_date: '2026-10-01', total_cents: 10, status: 'approved' }, { id: 'b', bill_number: '2', bill_date: '2026-10-03', total_cents: 10, status: 'approved' }];
    expect(matchStatement([ln('x', { amount_cents: 10 })], two).lines[0].status).toBe('missing');
  });
});

describe('statement sheets', () => {
  it('Amount, or Charges and Credits; skips totals', () => {
    expect(parseStatementSheet([['Date', 'Invoice #', 'Description', 'Amount'], ['10/02/2026', 'INV-00123', 'Wigs', '$500.00'], ['10/05/2026', 'PMT 88', 'Payment', '(300.00)'], ['', 'Total', '', '200']])).toEqual({
      lines: [{ line_date: '2026-10-02', reference: 'INV-00123', description: 'Wigs', amount_cents: 50000 }, { line_date: '2026-10-05', reference: 'PMT 88', description: 'Payment', amount_cents: -30000 }], errors: [],
    });
    expect(parseStatementSheet([['Doc Date', 'Document', 'Charges', 'Credits'], ['2026-10-01', '555', '200.00', ''], ['2026-10-02', 'CM1', '', '25']]).lines.map((l) => l.amount_cents)).toEqual([20000, -2500]);
    expect(parseStatementSheet([['Date', 'Ref', 'Amount'], ['nope', '1', '5'], ['2026-10-01', '2', 'abc']]).errors.map((e) => e.line)).toEqual([2, 3]);
    expect(parseStatementSheet([['Date', 'Ref']]).errors[0].message).toMatch(/Amount/);
  });
});
