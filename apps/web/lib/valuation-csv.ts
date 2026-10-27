import {
  parseGranularity,
  parseValuationRange,
  valuationCsvRows,
  valuationHistory,
  type PositionInput,
} from '@fwos/core';
import { toCsv } from './listing';

/**
 * The Value by period table as a download, for the same choices as the page (weeks, months, quarters or years, the range, one
 * person): the file and the page cannot differ. Dates are ISO and numbers are plain, so a spreadsheet can sum them.
 */
export function valuationCsv(
  position: PositionInput,
  q: {
    g?: string | null;
    range?: string | null;
    from?: string | null;
    to?: string | null;
    p?: string | null;
  },
  settings: { recent: number; financialQuarters: boolean },
  validOwner: (id: string) => boolean,
): Response {
  const h = valuationHistory({
    position,
    granularity: parseGranularity(q.g ?? undefined),
    range: parseValuationRange(q.range ?? undefined, q.from ?? undefined, q.to ?? undefined),
    owner: q.p && validOwner(q.p) ? q.p : null,
    recent: settings.recent,
    financialQuarters: settings.financialQuarters,
  });
  return new Response(toCsv(valuationCsvRows(h)), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="portfolio-value-by-${h.granularity}.csv"`,
      'cache-control': 'no-store',
    },
  });
}
