/**
 * Request time for Server Components. They render once per request (Cache
 * Components is off), so reading the clock here is deterministic per response.
 */
export function requestNow(): number {
  return Date.now();
}
