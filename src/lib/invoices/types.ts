/** File types and size the invoices bucket accepts (the bucket and the database enforce the same). */
export const INVOICE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'] as const;
export type InvoiceType = (typeof INVOICE_TYPES)[number];
export const INVOICE_MAX_BYTES = 10 * 1024 * 1024;

/** The browser sometimes leaves HEIC/PDF types empty; fall back to the extension. */
export function invoiceType(file: { name: string; type: string }): InvoiceType | null {
  const t = file.type.toLowerCase();
  if ((INVOICE_TYPES as readonly string[]).includes(t)) return t as InvoiceType;
  if (t === 'image/jpg') return 'image/jpeg';
  const ext = file.name.toLowerCase().split('.').pop();
  return ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', pdf: 'application/pdf' } as Record<string, InvoiceType>)[ext ?? ''] ?? null;
}
