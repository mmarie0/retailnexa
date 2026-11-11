/**
 * Read every row of a query in pages of 1,000 (the API returns at most 1,000
 * rows per read). Stops after `max` pages and says so, so callers can show
 * that a figure is incomplete instead of under-counting quietly (#168, #169).
 * The query must have a stable order.
 */
export async function pageAll<T>(read: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>, max = 20): Promise<T[] & { truncated: boolean }> {
  const out = [] as unknown as T[] & { truncated: boolean };
  out.truncated = false;
  for (let p = 0; p < max; p++) {
    const { data, error } = await read(p * 1000, p * 1000 + 999);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
  out.truncated = true;
  return out;
}
