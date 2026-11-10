import { describe, expect, it } from 'vitest';
import {
  billPayment, cardDeposit, cashDeposit, costOfGoodsSold, dailySales, expenseBill, finalize, inventoryBill,
  ownerDraw, PostingError, profitInputsFromBalances, salesTaxPayment, toAccountLines, type AccountRole, type RoleLine,
} from './postings';

/** Applies entries to role balances (debit-normal), like a mini ledger. */
function ledger(...entries: RoleLine[][]) {
  const bal: Partial<Record<AccountRole, number>> = {};
  for (const e of entries) for (const l of e) bal[l.role] = (bal[l.role] ?? 0) + l.debitCents - l.creditCents;
  return bal;
}

describe('posting rules', () => {
  it('records a register day with tax as a liability and discounts as contra-revenue', () => {
    const lines = dailySales({ grossSalesCents: 100_000, discountsCents: 5_000, salesTaxCents: 7_125, cashCents: 40_000, cardCents: 62_125 });
    const bal = ledger(lines);
    expect(bal.sales).toBe(-100_000);
    expect(bal.sales_discounts).toBe(5_000);
    expect(bal.sales_tax_payable).toBe(-7_125);
    expect(bal.card_clearing).toBe(62_125);
  });

  it('refuses a day whose tenders do not match', () => {
    expect(() => dailySales({ grossSalesCents: 100, discountsCents: 0, salesTaxCents: 7, cashCents: 100, cardCents: 0 })).toThrow(PostingError);
  });

  it('treats inventory purchases as an asset and bill payments as non-expenses (prototype fix)', () => {
    const bal = ledger(inventoryBill(50_000), billPayment(50_000));
    expect(bal.inventory).toBe(50_000);
    expect(bal.accounts_payable).toBe(0);
    expect(bal.bank).toBe(-50_000);
    const p = profitInputsFromBalances(bal);
    expect(p.cogsCents).toBe(0); // buying stock is not cost of goods sold
    expect(Object.values(p.operatingExpensesCents).every((v) => v === 0)).toBe(true);
  });

  it('recognises COGS only when goods sell', () => {
    const bal = ledger(inventoryBill(50_000), costOfGoodsSold(18_000));
    expect(bal.inventory).toBe(32_000);
    expect(profitInputsFromBalances(bal).cogsCents).toBe(18_000);
  });

  it('keeps owner draws and sales-tax payments out of expenses (prototype fix)', () => {
    const day = dailySales({ grossSalesCents: 10_000, discountsCents: 0, salesTaxCents: 700, cashCents: 10_700, cardCents: 0 });
    const bal = ledger(day, cashDeposit(10_700), salesTaxPayment(700), ownerDraw(5_000));
    expect(bal.sales_tax_payable).toBe(0);
    expect(bal.owner_draws).toBe(5_000);
    const p = profitInputsFromBalances(bal);
    expect(p.netSalesCents).toBe(10_000);
    expect(Object.values(p.operatingExpensesCents).reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('splits card deposits into bank and processing fees', () => {
    const bal = ledger(cardDeposit(62_125, 1_801));
    expect(bal.bank).toBe(60_324);
    expect(bal.card_fees).toBe(1_801);
    expect(bal.card_clearing).toBe(-62_125);
  });

  it('feeds operating expenses into profit by role', () => {
    const p = profitInputsFromBalances(ledger(expenseBill('rent', 640_000), expenseBill('utilities', 91_000)));
    expect(p.operatingExpensesCents.rent).toBe(640_000);
    expect(p.operatingExpensesCents.utilities).toBe(91_000);
  });

  it('validates amounts and balance', () => {
    expect(() => billPayment(-1)).toThrow(PostingError);
    expect(() => billPayment(10.5)).toThrow(PostingError);
    expect(() => finalize([{ role: 'bank', debitCents: 5, creditCents: 0 }, { role: 'sales', debitCents: 0, creditCents: 4 }])).toThrow(/does not balance/);
    expect(() => cardDeposit(10, 11)).toThrow(PostingError);
  });

  it('maps roles to account ids and reports a missing account', () => {
    expect(toAccountLines(billPayment(100), { accounts_payable: 'a1', bank: 'b1' })).toEqual([
      { account_id: 'a1', debit_cents: 100, credit_cents: 0, memo: 'Bill paid' },
      { account_id: 'b1', debit_cents: 0, credit_cents: 100, memo: 'Payment' },
    ]);
    expect(() => toAccountLines(billPayment(100), { bank: 'b1' })).toThrow(/accounts_payable/);
  });
});
