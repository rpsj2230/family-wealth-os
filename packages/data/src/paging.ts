/**
 * The API returns at most 1,000 rows per request whatever limit is asked for, so anything that can be larger (a fund's transaction
 * ledger, years of prices, every recorded value) must be read in pages. `build` makes the query for one page.
 */
export async function pageAll<T>(
  build: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  pageSize = 1000,
  maxRows = 200_000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < maxRows; from += pageSize) {
    const r = await build(from, from + pageSize - 1);
    if (r.error) throw new Error(r.error.message);
    const rows = (r.data ?? []) as T[];
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}
