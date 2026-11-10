/** Plain text for any exceljs cell value; error cells become empty, never "[object Object]". */
export function cellText(v: unknown): string {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    const o = v as { text?: unknown; result?: unknown; richText?: { text: string }[]; error?: unknown; hyperlink?: unknown };
    if (o.error !== undefined) return '';
    if (Array.isArray(o.richText)) return o.richText.map((t) => t.text).join('');
    if ('result' in o) return cellText(o.result);
    if (o.text !== undefined) return cellText(o.text);
    return '';
  }
  return String(v);
}
