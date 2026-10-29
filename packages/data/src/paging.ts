/**
 * The API returns at most 1,000 rows per request whatever limit is asked for, so anything that can be larger (a fund's transaction
 * ledger, years of prices, every recorded value) must be read in pages. `build` makes the query for one page.
 *
 * The first page is read alone (most reads fit in it); when it is full, the next pages are asked for `parallel` at a time instead
 * of one after another, so a read of several thousand rows costs two or three waits instead of one per page. The query must be
 * ordered for the pages to be stable; the rows come back in page order.
 */
export async function pageAll<T>(
  build: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  pageSize = 1000,
  maxRows = 200_000,
  parallel = 4,
): Promise<T[]> {
  const read = async (from: number) => {
    const r = await build(from, from + pageSize - 1);
    if (r.error) throw new Error(r.error.message);
    return (r.data ?? []) as T[];
  };
  const first = await read(0);
  const out: T[] = [...first];
  if (first.length < pageSize) return out;
  for (let from = pageSize; from < maxRows; from += pageSize * parallel) {
    const starts = Array.from({ length: parallel }, (_, i) => from + i * pageSize).filter(
      (s) => s < maxRows,
    );
    const pages = await Promise.all(starts.map(read));
    for (const rows of pages) {
      out.push(...rows);
      if (rows.length < pageSize) return out;
    }
  }
  return out;
}
