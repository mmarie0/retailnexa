/**
 * Parses a user-typed dollar amount ("1,234.5", "$12", "0.99") into integer cents.
 * Returns null for anything that isn't a plain non-negative amount with at most 2 decimals.
 * Never goes through floating point.
 */
export function parseDollarsToCents(input: string | null | undefined): number | null {
  if (input == null) return null;
  const s = input.trim().replace(/^\$/, '').replace(/,/g, '');
  // At most 2 significant decimals; trailing zeros are fine ("12.500" = $12.50, #94).
  const m = /^(\d{1,10})(?:\.(\d{0,2})0*)?$/.exec(s) ?? /^()\.(\d{1,2})0*$/.exec(s);
  if (!m) return null;
  const whole = m[1] ? Number(m[1]) : 0;
  const frac = Number((m[2] ?? '').padEnd(2, '0') || '0');
  const cents = whole * 100 + frac;
  return Number.isSafeInteger(cents) ? cents : null;
}

/** Formats cents as a plain editable amount, e.g. 123456 → "1234.56". */
export function centsToInput(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const a = Math.abs(cents);
  return `${sign}${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`;
}
