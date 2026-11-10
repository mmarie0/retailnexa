/**
 * Request time for Server Components. They render once per request (Cache
 * Components is off), so reading the clock here is deterministic per response.
 */
export function requestNow(): number {
  return Date.now();
}

/** Today's calendar date (YYYY-MM-DD) in an IANA time zone; falls back to UTC for unknown zones. */
export function todayIn(timeZone: string | null | undefined, now: number = requestNow()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timeZone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  } catch {
    return new Date(now).toISOString().slice(0, 10);
  }
}
