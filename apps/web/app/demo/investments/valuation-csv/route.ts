import { DEFAULT_CONFIG } from '@fwos/core';
import { demoView, DEMO_PEOPLE } from '@/lib/demo-funds';
import { fundsPosition } from '@/lib/fund-holdings';
import { valuationCsv } from '@/lib/valuation-csv';

export const dynamic = 'force-dynamic';

/** The public sample's Value by period as a CSV file: invented funds, nothing private is read. */
export function GET(request: Request) {
  const url = new URL(request.url);
  const q = (k: string) => url.searchParams.get(k);
  return valuationCsv(
    fundsPosition(demoView(null, 'all')),
    { g: q('g'), range: q('range'), from: q('from'), to: q('to'), p: q('p') },
    {
      recent: DEFAULT_CONFIG.funds.valuationPeriods,
      financialQuarters: DEFAULT_CONFIG.funds.financialQuarters,
    },
    (id) => DEMO_PEOPLE.some((p) => p.id === id),
  );
}
