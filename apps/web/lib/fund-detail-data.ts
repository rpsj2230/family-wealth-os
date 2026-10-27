import type { FundRangeKey, FundTaxPanel } from '@fwos/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import { columnExists, pageAll } from '@fwos/data';
import type { ReplacedRow } from '@/components/invest/ReplacedLines';
import { loadContext } from './data';
import { buildFundDetail, NAV_POINTS, type FundDetail } from './fund-detail-model';
import { buildFundTax } from './fund-tax';
import { loadInvestmentView, type FundRow, type InvestmentView } from './investments';

/** Everything the fund page adds for a mutual fund: the fund as the Investments page sees it, and the numbers behind its graphs. */
export async function loadFundDetail(
  assetId: string,
  range: FundRangeKey,
): Promise<{
  fund: FundRow;
  view: InvestmentView;
  today: string;
  holdingMonths: number | null;
  detail: FundDetail;
  /** exit load, short and long term units and the harvest advice for this fund */
  tax: FundTaxPanel;
  /** lines a fund statement replaced: kept out of every figure, listed on the Transactions tab */
  replaced: ReplacedRow[];
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
  // nothing is set aside until the database update that adds the column has run
  const setAside = !(await columnExists(
    supabase as unknown as SupabaseClient,
    'mf_transactions',
    'superseded_on',
  ))
    ? []
    : await pageAll<Record<string, unknown>>((from, to) =>
        supabase
          .from('mf_transactions')
          .select('id, txn_on, kind, amount, units, source, superseded_on, superseded_statement_on')
          .eq('asset_id', assetId)
          .not('superseded_on', 'is', null)
          .order('txn_on')
          .order('id')
          .range(from, to),
      );
  const replaced: ReplacedRow[] = setAside.map((r) => ({
    id: r.id as string,
    date: r.txn_on as string,
    kind: r.kind as string,
    amount: Number(r.amount),
    units: Number(r.units),
    source: (r.source as string | null) ?? 'manual',
    statementOn: (r.superseded_statement_on as string | null) ?? null,
    replacedOn: (r.superseded_on as string | null) ?? null,
  }));
  return {
    replaced,
    fund,
    view,
    today: view.today,
    holdingMonths: view.holdingMonths,
    tax: buildFundTax(view, fund),
    detail: buildFundDetail({
      fund,
      navs,
      today: view.today,
      range,
      holdingMonths: view.holdingMonths,
      config: view.config,
      maxPoints: NAV_POINTS,
      benchmark: view.benchmark,
    }),
  };
}
