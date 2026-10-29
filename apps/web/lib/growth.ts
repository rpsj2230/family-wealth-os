import {
  compareHoldings,
  moveFromSuggestion,
  type AppConfig,
  type AssetType,
  type RateHolding,
  type RateOffer,
  type WorkHoldingIn,
  type WorkKind,
  type WorkMove,
} from '@fwos/core';

/** One counted holding as this page needs it (from the portfolio, the accounts and the fund view). */
export interface GrowthAsset {
  id: string;
  name: string;
  ownerId: string;
  type: AssetType;
  currency: string;
  accountKind: 'NRE' | 'NRO' | null;
  bank: string | null;
  value: number;
  /** the account's own yearly rate, else the rate list's for its bank, kind and balance */
  ownRate: number | null;
  listedRate: number | null;
}

const KIND: Partial<Record<AssetType, WorkKind>> = {
  bank_account: 'cash',
  fixed_deposit: 'fd',
  mutual_fund: 'funds',
};

const TYPE_WORD: Record<AssetType, string> = {
  bank_account: 'Savings',
  fixed_deposit: 'Fixed deposit',
  mutual_fund: 'Mutual fund',
  stock: 'Shares',
  receivable: 'Money lent',
  policy: 'Policy',
  property: 'Property',
  ulip: 'ULIP',
  nps: 'NPS',
  third_party_held: 'Held by someone else',
  other: 'Other',
};

/**
 * The rate each holding earns now and where it comes from. Deposits: their own rate. Savings: the account's own rate, else the rate
 * list's, else the assumed rate in Settings. Funds: their own yearly return (XIRR), else the long-run return of the retirement plan.
 * Property, retirement accounts and other holdings: the growth assumed in Settings. Money lent and money held by someone else: nothing.
 * Interest on NRO money loses the tax deducted at source; NRE interest is tax-free; fund gains are taxed only when sold.
 */
export function workHoldings(args: {
  assets: GrowthAsset[];
  ownerName: Map<string, string>;
  rateHoldings: RateHolding[];
  funds: Map<string, { xirr: number | null; monthly: number }>;
  config: AppConfig;
  longRunEquity: number;
}): WorkHoldingIn[] {
  const { config } = args;
  const rh = new Map(args.rateHoldings.map((r) => [r.assetId, r]));
  return args.assets.map((a) => {
    const kind = KIND[a.type] ?? 'others';
    const nroTax = a.accountKind === 'NRO' ? config.rates.nroTaxRate : 0;
    let rate = 0;
    let basis = 'earns nothing';
    let taxRate = 0;
    let monthly = 0;
    if (a.type === 'fixed_deposit') {
      rate = rh.get(a.id)?.rate ?? a.ownRate ?? 0;
      basis = 'the deposit’s rate';
      taxRate = nroTax;
    } else if (a.type === 'bank_account') {
      if (a.currency !== 'INR') {
        rate = a.ownRate ?? 0;
        basis = a.ownRate
          ? 'the account’s own rate'
          : 'no interest recorded (money in another currency)';
      } else {
        rate = a.ownRate ?? a.listedRate ?? rh.get(a.id)?.rate ?? config.estimates.savingsRate;
        basis =
          a.ownRate !== null
            ? 'the account’s own rate'
            : a.listedRate !== null
              ? 'the rate list for this bank and balance'
              : 'the savings rate assumed in Settings';
        taxRate = nroTax;
      }
    } else if (a.type === 'mutual_fund') {
      const f = args.funds.get(a.id);
      monthly = f?.monthly ?? 0;
      if (f && f.xirr !== null) {
        rate = f.xirr;
        basis = 'its own yearly return (XIRR)';
      } else {
        rate = args.longRunEquity;
        basis = 'no return worked out yet: the long-run return of your plan';
      }
    } else if (a.type === 'property') {
      rate = config.estimates.assumedGrowthProperty;
      basis = 'the property growth assumed in Settings';
    } else if (a.type === 'nps' || a.type === 'ulip') {
      rate = config.estimates.assumedGrowthRetirement;
      basis = 'the retirement-account growth assumed in Settings';
    } else if (a.type === 'other' || a.type === 'stock') {
      rate = config.estimates.assumedGrowthOther;
      basis = 'the growth assumed in Settings';
    }
    return {
      id: a.id,
      name: a.name,
      ownerId: a.ownerId,
      owner: args.ownerName.get(a.ownerId) ?? 'Someone',
      kind,
      type: TYPE_WORD[a.type],
      bank: a.bank,
      value: a.value,
      rate,
      rateBasis: basis,
      taxRate,
      monthly,
    };
  });
}

/**
 * Better places for deposits and savings from the rates list: the same comparison the Rates page makes (another bank's savings rate,
 * a better deposit at maturity), and savings above the buffer in Settings placed in a deposit. Inside the insurance limit; one move per
 * holding, the one that adds most.
 */
export function workMoves(args: {
  rateHoldings: RateHolding[];
  offers: RateOffer[];
  config: AppConfig;
  today: string;
}): WorkMove[] {
  const { config } = args;
  const limit = config.deposits.insuranceLimit;
  const same = compareHoldings(args.rateHoldings, args.offers, config.rates, args.today, limit).map(
    (s) => moveFromSuggestion(s),
  );
  // savings above the buffer, compared with deposits
  const asDeposit: RateHolding[] = args.rateHoldings
    .filter((h) => h.product === 'savings' && h.current > config.rates.savingsBuffer)
    .map((h) => ({
      ...h,
      product: 'fd',
      current: h.current - config.rates.savingsBuffer,
      maturityOn: null,
      needsConfirmation: false,
    }));
  const toFd = compareHoldings(asDeposit, args.offers, config.rates, args.today, limit).map((s) =>
    moveFromSuggestion({ ...s, product: 'savings', toProduct: 'fd' }),
  );
  const best = new Map<string, WorkMove>();
  for (const m of [...same, ...toFd]) {
    const cur = best.get(m.holdingId);
    if (!cur || m.annualGain > cur.annualGain) best.set(m.holdingId, m);
  }
  return [...best.values()].sort((a, b) => b.annualGain - a.annualGain);
}
