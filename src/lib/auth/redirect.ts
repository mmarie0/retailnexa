/**
 * Only allow same-site relative redirects (prevents open redirects via ?next=).
 * The check is applied to the *normalised* URL: dot segments such as
 * "/.//evil.com" collapse to "//evil.com", a protocol-relative URL.
 */
export function safeNext(next: unknown, fallback = '/app'): string {
  if (typeof next !== 'string' || next.length > 2048) return fallback;
  if (!next.startsWith('/') || /[\r\n\t\\]/.test(next)) return fallback;
  let u: URL;
  try {
    u = new URL(next, 'https://x.invalid');
  } catch {
    return fallback;
  }
  if (u.origin !== 'https://x.invalid') return fallback;
  const path = u.pathname;
  if (!path.startsWith('/') || path.startsWith('//')) return fallback;
  return path + u.search;
}
