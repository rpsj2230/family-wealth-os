import type { FundRangeKey } from '@fwos/core';
import { pageAll } from '@fwos/data';
import { loadContext } from './data';
import { buildFundDetail, NAV_POINTS, type FundDetail } from './fund-detail-model';
import { loadInvestmentView, type FundRow } from './investments';

/** Everything the fund page adds for a mutual fund: the fund as the Investments page sees it, and the numbers behind its graphs. */
export async function loadFundDetail(
  assetId: string,
  range: FundRangeKey,
): Promise<{
  fund: FundRow;
  today: string;
  holdingMonths: number | null;
  detail: FundDetail;
} | null> {
  const { supabase } = await loadContext();
  const view = await loadInvestmentView(supabase, undefined, null, range);
  const fund = view.groups.flatMap((g) => g.funds).find((f) => f.assetId === assetId);
  if (!fund) return null;
  const rows = fund.amfiCode
    ? await pageAll<{ nav_date: string; nav: number }>((from, to) =>
        supabase
          .from('mf_navs')
          .select('nav_date, nav')
          .eq('amfi_code', fund.amfiCode!)
          .order('nav_date')
          .range(from, to),
      )
    : [];
  const navs = rows.map((n) => ({ date: n.nav_date, nav: Number(n.nav) }));
  return {
    fund,
    today: view.today,
    holdingMonths: view.holdingMonths,
    detail: buildFundDetail({
      fund,
      navs,
      today: view.today,
      range,
      holdingMonths: view.holdingMonths,
      config: view.config,
      maxPoints: NAV_POINTS,
    }),
  };
}
