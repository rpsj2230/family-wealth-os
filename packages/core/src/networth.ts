import type { FundSplit, SavingsDetail } from './position';
import { sumExact } from './money';
import type { CurrentValueEstimate, EstimateTotals } from './estimate';
import { sumEstimates } from './estimate';

export type AssetType =
  | 'bank_account'
  | 'fixed_deposit'
  | 'mutual_fund'
  | 'stock'
  | 'receivable'
  | 'policy'
  | 'property'
  | 'ulip'
  | 'nps'
  | 'third_party_held'
  | 'other';

export type Liquidity = 'liquid' | 'investable' | 'retirement' | 'illiquid';

export interface ValuedAsset {
  assetId: string;
  ownerId: string;
  type: AssetType;
  status: string;
  name: string;
  /** null = no usable valuation yet. Such assets are reported as missing, never counted as zero. */
  estimate: CurrentValueEstimate | null;
  /** valued and shown, but left out of net worth by a setting (property, when Settings says not to count it) */
  notCounted?: 'setting';
  /** how the central engine reached the value (valuation.ts), for the "how it is worked out" table of a detail page */
  detail?: {
    savings: SavingsDetail | null;
    fund: FundSplit | null;
  };
}

export type ExclusionReason =
  | 'status_not_counted' // matured/renewed/closed/unconfirmed
  | 'insurance_cover_not_wealth' // pure insurance policies never count
  | 'not_counted_setting' // property, when Settings says not to count it
  | 'no_valuation';

export interface NetWorthResult {
  total: number;
  byOwner: Record<string, number>;
  byType: Partial<Record<AssetType, number>>;
  byLiquidity: Record<Liquidity, number>;
  /** liquid + investable: what could fund spending without selling a home or touching retirement lock-ins */
  investableFinancial: number;
  counted: number;
  excluded: { assetId: string; name: string; reason: ExclusionReason; amount: number | null }[];
  estimateTotals: EstimateTotals;
}

const LIQUIDITY: Record<AssetType, Liquidity | null> = {
  bank_account: 'liquid',
  fixed_deposit: 'liquid',
  mutual_fund: 'investable',
  stock: 'investable',
  nps: 'retirement',
  ulip: 'retirement',
  receivable: 'illiquid',
  property: 'illiquid',
  third_party_held: 'illiquid',
  other: 'illiquid',
  policy: null, // insurance coverage is never wealth
};

/** How reachable a kind of holding is; null for a kind that is never wealth (insurance cover). */
export const liquidityOf = (type: AssetType): Liquidity | null => LIQUIDITY[type];

/** Statuses whose value is still part of wealth. Matured-but-unconfirmed FDs are excluded until confirmed. */
const COUNTED_STATUS = new Set(['active', 'stopped']);

/** Whether a holding is part of net worth today: a kind that is wealth, in a counted status, with a value. */
export function isCounted(a: ValuedAsset): boolean {
  return (
    LIQUIDITY[a.type] !== null && COUNTED_STATUS.has(a.status) && a.estimate !== null && !a.notCounted
  );
}

/**
 * Net worth from each asset's current-value estimate.
 *  - every asset appears once (duplicate ids are a programming error and throw)
 *  - excluded assets are listed with a reason rather than silently dropped
 *  - an asset with no valuation is reported as `no_valuation`, never as zero
 */
export function aggregateNetWorth(assets: ValuedAsset[]): NetWorthResult {
  const seen = new Set<string>();
  const byOwner: Record<string, number[]> = {};
  const byType: Partial<Record<AssetType, number[]>> = {};
  const byLiq: Record<Liquidity, number[]> = {
    liquid: [],
    investable: [],
    retirement: [],
    illiquid: [],
  };
  const all: number[] = [];
  const counted: CurrentValueEstimate[] = [];
  const excluded: NetWorthResult['excluded'] = [];

  for (const a of assets) {
    if (seen.has(a.assetId)) throw new Error(`duplicate asset in net-worth input: ${a.assetId}`);
    seen.add(a.assetId);
    const liq = LIQUIDITY[a.type];
    if (liq === null) {
      excluded.push({
        assetId: a.assetId,
        name: a.name,
        reason: 'insurance_cover_not_wealth',
        amount: null,
      });
      continue;
    }
    if (a.notCounted) {
      excluded.push({
        assetId: a.assetId,
        name: a.name,
        reason: 'not_counted_setting',
        amount: a.estimate?.estimatedAmount ?? null,
      });
      continue;
    }
    if (!COUNTED_STATUS.has(a.status)) {
      excluded.push({
        assetId: a.assetId,
        name: a.name,
        reason: 'status_not_counted',
        amount: a.estimate?.estimatedAmount ?? null,
      });
      continue;
    }
    if (!a.estimate) {
      excluded.push({ assetId: a.assetId, name: a.name, reason: 'no_valuation', amount: null });
      continue;
    }
    const v = a.estimate.estimatedAmount;
    all.push(v);
    (byOwner[a.ownerId] ??= []).push(v);
    (byType[a.type] ??= []).push(v);
    byLiq[liq].push(v);
    counted.push(a.estimate);
  }

  const liquidity = {
    liquid: sumExact(byLiq.liquid),
    investable: sumExact(byLiq.investable),
    retirement: sumExact(byLiq.retirement),
    illiquid: sumExact(byLiq.illiquid),
  };
  return {
    total: sumExact(all),
    byOwner: Object.fromEntries(Object.entries(byOwner).map(([k, v]) => [k, sumExact(v)])),
    byType: Object.fromEntries(
      Object.entries(byType).map(([k, v]) => [k, sumExact(v)]),
    ) as NetWorthResult['byType'],
    byLiquidity: liquidity,
    investableFinancial: sumExact([liquidity.liquid, liquidity.investable]),
    counted: counted.length,
    excluded,
    estimateTotals: sumEstimates(counted),
  };
}
