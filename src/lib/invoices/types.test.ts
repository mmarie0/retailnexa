import { describe, expect, it } from 'vitest';
import { invoiceType } from './types';

describe('invoiceType', () => {
  it('accepts photos and PDFs by type or extension, nothing else', () => {
    expect(invoiceType({ name: 'a.jpg', type: 'image/jpeg' })).toBe('image/jpeg');
    expect(invoiceType({ name: 'IMG_1.HEIC', type: '' })).toBe('image/heic');
    expect(invoiceType({ name: 'inv.pdf', type: '' })).toBe('application/pdf');
    expect(invoiceType({ name: 'x.jpg', type: 'image/jpg' })).toBe('image/jpeg');
    expect(invoiceType({ name: 'page.html', type: 'text/html' })).toBeNull();
    expect(invoiceType({ name: 'evil.pdf.exe', type: '' })).toBeNull();
  });
});
