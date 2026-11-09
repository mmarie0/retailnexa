/** Only allow same-site relative redirects (prevents open redirects via ?next=). */
export function safeNext(next: unknown, fallback = '/app'): string {
  if (typeof next !== 'string') return fallback;
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\') || /[\r\n]/.test(next)) return fallback;
  try {
    const u = new URL(next, 'https://x.invalid');
    if (u.origin !== 'https://x.invalid') return fallback;
    return u.pathname + u.search;
  } catch {
    return fallback;
  }
}
