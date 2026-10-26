/**
 * Every tunable number lives here as a default and is overridden from Settings (stored per household). Nothing in the app
 * should repeat these numbers: it reads them from the configuration it is given. Values from Settings are checked and clamped,
 * so a typo can never produce a nonsense limit.
 */
import { RULES, fyBoundsOf, type TaxRuleSet } from './tax';
import { LIQUIDITY_KINDS, type LiquidityKind } from './liquidity-kinds';
export { effectiveRules, fyBoundsOf, type EffectiveRules } from './tax';

export interface AppConfig {
  deposits: {
    /** deposit insurance cover per ownership name per bank (DICGC): each name as written, and joint names in each order, is insured separately; change it when the limit changes */
    insuranceLimit: number;
    /** days before maturity at which an alert escalates, smallest first */
    maturityAlertDays: number[];
  };
  reminders: {
    policyDays: number;
    taskDays: number;
    /** a deposit maturing within this many days is flagged "soon" on Accounts, Deposits and the daily summary */
    maturitySoonDays: number;
    /** month and day of the harvest reminder before the financial year ends */
    harvestMonth: number;
    harvestDay: number;
  };
  estimates: {
    /** a balance counts as out of date after this many days unless an account has its own window */
    freshnessDays: number;
    /** assumed yearly interest on savings balances until an account has its own rate */
    savingsRate: number;
    /** tax deducted at source assumed on interest until an account has its own rate */
    interestTdsRate: number;
    /** add instalments of active SIPs since the last recorded value to a fund's estimate */
    includeSip: boolean;
  };
  rates: {
    /** an offer not checked within this many days is shown as old */
    staleDays: number;
    /** only suggest a move when the after-tax rate is better by at least this much (0.0025 = 0.25 points) */
    minRateGap: number;
    /** only suggest a move worth at least this much extra interest a year */
    minAnnualGain: number;
    /** tax on NRO interest (deducted at source for non-residents); NRE interest is not taxed in India */
    nroTaxRate: number;
    /** tenure used when reinvesting a deposit that has no obvious term */
    defaultTenureMonths: number;
    /** look this far ahead for deposits that mature, to suggest where to renew */
    fdLookaheadDays: number;
    /** savings above this amount in a low-rate account is worth moving */
    savingsBuffer: number;
    /** New money: the longest deposit term any option may use, in months */
    maxTermMonths: number;
    /** New money: the longest term the balanced and safest options use, in months */
    balancedTermMonths: number;
    /** New money: the longest term the flexible option uses, in months */
    flexibleTermMonths: number;
    /** New money: the terms of the ladder, in months, one rung each */
    ladderTermsMonths: number[];
    /** New money: the most of the amount the balanced option puts in one bank (0.4 = 40%) */
    maxBankShare: number;
    /** New money: the most of the amount the safest option puts in one bank */
    safeBankShare: number;
    /** New money: the share kept in savings, available any time, by the balanced, ladder and safest options */
    liquidShare: number;
    /** New money: the share kept in savings by the flexible option */
    flexibleLiquidShare: number;
    /** New money: the part of the insurance limit left unused at a bank, for interest that will be added */
    insuranceBuffer: number;
    /** New money: the smallest amount worth putting in one deposit */
    minPiece: number;
  };
  refunds: {
    /** income per person per year up to which no Indian tax is due (the basic exemption); tax withheld on NRO interest is then refunded */
    incomeLimit: number;
    /** other taxable Indian income expected per person per year besides NRO deposit interest (rent, dividends, ...) */
    otherIncome: number;
  };
  liquidity: {
    /** kinds of money the "I need money" planner may use, in your order of preference (a kind left out is never used) */
    order: LiquidityKind[];
    /** 'cheapest' ranks by cost, 'fastest' by date, 'order' follows the preference order above */
    mode: 'cheapest' | 'fastest' | 'order';
    /** left in each savings account so it stays open and above its minimum balance */
    keepInBank: number;
    /** interest lost on breaking a deposit early, in points a year (0.01 = 1%), applied to the time it has run */
    fdPenaltyPoints: number;
    /** whether the bank lets you break part of a deposit; otherwise the whole deposit is used */
    fdPartialBreak: boolean;
    /** a deposit booked within this many days counts as recently added: breaking it loses little, so it ranks as its own kind of source */
    recentFdDays: number;
    /** days for a deposit break to reach your account */
    fdBreakDays: number;
    /** working days from selling a fund to money in the bank */
    mfSettlementDays: number;
    /** working days from selling shares to money in the bank */
    stockSettlementDays: number;
    /** days for a foreign-currency balance to be converted and credited */
    foreignCashDays: number;
    /** exit load on a fund sold within the long-term holding period (0.01 = 1%) */
    exitLoadPct: number;
    /** share of the value assumed to be gain when the cost is not recorded */
    assumedGainShare: number;
    /** days to sell a property and receive the money */
    propertySaleDays: number;
    /** brokerage, legal and other costs of selling a property (0.02 = 2%) */
    propertyCostPct: number;
    /** days to collect money lent out */
    receivableDays: number;
    /** deadlines shown as separate plans: 0 = today */
    scenarioDays: number[];
  };
  harvest: {
    /** smallest sale worth suggesting */
    minSellAmount: number;
    /** extra months beyond the long-term holding period before a position counts as long-term */
    holdingMarginMonths: number;
    /** leave out funds with an active SIP (their recent units may still be short-term) */
    skipActiveSip: boolean;
    /** assume an NRI: the fund house withholds tax on redemption */
    nri: boolean;
    /** exit load charged on units sold inside the window, as a fraction, and the window in days from each purchase (0 = none) */
    exitLoadPct: number;
    exitLoadDays: number;
    /** securities transaction tax on selling equity fund units, and stamp duty on buying them, as fractions */
    sttPct: number;
    stampDutyPct: number;
    /** days kept clear before 31 March: an order after the cut-off or on a holiday is priced on the next working day */
    orderBufferDays: number;
  };
  /** what Home compares and flags */
  home: {
    /** the "this month" change on Home compares with the value this many days ago */
    changeDays: number;
    /** Coming up on Home looks this many days ahead */
    upcomingDays: number;
    /** Home flags a bank that holds more than this share of the money kept in banks (0.4 = 40%) */
    bankShareWatch: number;
  };
  /** how the mutual-fund statistics and graphs are cut */
  funds: {
    /** an annual figure (CAGR, XIRR over time) is shown only after money has been invested this many months */
    annualiseAfterMonths: number;
    /** how many of the largest funds make up "concentration" */
    concentrationTop: number;
    /** months shown in the SIP calendar */
    calendarMonths: number;
    /** months shown in the monthly-contribution bars */
    contributionMonths: number;
    /** allocation graphs show this many slices and fold the rest into "Other" */
    maxSlices: number;
    /** a price older than this many days before a purchase is not used to estimate that purchase's units */
    navGapDays: number;
    /** a fund is flagged as lagging or leading when its return differs from the household's by more than this (0.05 = 5 points) */
    outlierPoints: number;
  };
}

export const DEFAULT_CONFIG: AppConfig = {
  deposits: { insuranceLimit: 500_000, maturityAlertDays: [7, 15, 30, 60, 90] },
  reminders: { policyDays: 45, taskDays: 7, maturitySoonDays: 30, harvestMonth: 3, harvestDay: 15 },
  estimates: { freshnessDays: 35, savingsRate: 0.03, interestTdsRate: 0, includeSip: true },
  rates: {
    staleDays: 30,
    minRateGap: 0.0025,
    minAnnualGain: 5000,
    nroTaxRate: 0.3,
    defaultTenureMonths: 12,
    fdLookaheadDays: 180,
    savingsBuffer: 100_000,
    maxTermMonths: 60,
    balancedTermMonths: 24,
    flexibleTermMonths: 12,
    ladderTermsMonths: [6, 12, 24, 36],
    maxBankShare: 0.4,
    safeBankShare: 0.25,
    liquidShare: 0.15,
    flexibleLiquidShare: 0.5,
    insuranceBuffer: 0.1,
    minPiece: 25_000,
  },
  refunds: { incomeLimit: 400_000, otherIncome: 0 },
  liquidity: {
    order: [
      'cash',
      'fd_maturing',
      'fd_recent',
      'mf',
      'fd_break',
      'stock',
      'receivable',
      'property',
    ],
    mode: 'cheapest',
    keepInBank: 10_000,
    fdPenaltyPoints: 0.01,
    fdPartialBreak: false,
    recentFdDays: 90,
    fdBreakDays: 1,
    mfSettlementDays: 3,
    stockSettlementDays: 2,
    foreignCashDays: 2,
    exitLoadPct: 0.01,
    assumedGainShare: 0.3,
    propertySaleDays: 120,
    propertyCostPct: 0.02,
    receivableDays: 30,
    scenarioDays: [0, 3, 14, 45, 120],
  },
  harvest: {
    minSellAmount: 1000,
    holdingMarginMonths: 1,
    skipActiveSip: true,
    nri: true,
    exitLoadPct: 0.01,
    exitLoadDays: 365,
    sttPct: 0.00001,
    stampDutyPct: 0.00005,
    orderBufferDays: 6,
  },
  home: { changeDays: 30, upcomingDays: 120, bankShareWatch: 0.4 },
  funds: {
    annualiseAfterMonths: 12,
    concentrationTop: 3,
    calendarMonths: 24,
    contributionMonths: 24,
    maxSlices: 7,
    navGapDays: 10,
    outlierPoints: 0.05,
  },
};

const num = (v: unknown, d: number, lo: number, hi: number) =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : d;
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** Reads the saved JSON defensively: anything missing or out of range falls back to the default. */
/**
 * An order saved before "recently added deposits" existed has no place for them, which would mean they are never used.
 * They take the place right after deposits that mature in time (or just before early breaks), so nothing changes silently.
 */
function withRecentDeposits(order: LiquidityKind[]): LiquidityKind[] {
  if (order.includes('fd_recent') || !order.includes('fd_break')) return order;
  const out = [...order];
  const at = out.includes('fd_maturing') ? out.indexOf('fd_maturing') + 1 : out.indexOf('fd_break');
  out.splice(at, 0, 'fd_recent');
  return out;
}

export function configFromJson(raw: unknown): AppConfig {
  const d = DEFAULT_CONFIG;
  const r = obj(raw);
  const dep = obj(r.deposits);
  const rem = obj(r.reminders);
  const est = obj(r.estimates);
  const har = obj(r.harvest);
  const rat = obj(r.rates);
  const liq = obj(r.liquidity);
  const ref = obj(r.refunds);
  const fun = obj(r.funds);
  const hom = obj(r.home);
  const days = Array.isArray(dep.maturityAlertDays)
    ? [
        ...new Set(
          dep.maturityAlertDays.filter(
            (x): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 1 && x <= 365,
          ),
        ),
      ]
        .sort((a, b) => a - b)
        .slice(0, 8)
    : [];
  return {
    deposits: {
      insuranceLimit: num(dep.insuranceLimit, d.deposits.insuranceLimit, 1, 1e9),
      maturityAlertDays: days.length > 0 ? days : d.deposits.maturityAlertDays,
    },
    reminders: {
      policyDays: num(rem.policyDays, d.reminders.policyDays, 0, 365),
      taskDays: num(rem.taskDays, d.reminders.taskDays, 0, 365),
      maturitySoonDays: Math.round(num(rem.maturitySoonDays, d.reminders.maturitySoonDays, 1, 365)),
      harvestMonth: Math.round(num(rem.harvestMonth, d.reminders.harvestMonth, 1, 12)),
      harvestDay: Math.round(num(rem.harvestDay, d.reminders.harvestDay, 1, 28)),
    },
    estimates: {
      freshnessDays: Math.round(num(est.freshnessDays, d.estimates.freshnessDays, 1, 365)),
      savingsRate: num(est.savingsRate, d.estimates.savingsRate, 0, 0.5),
      interestTdsRate: num(est.interestTdsRate, d.estimates.interestTdsRate, 0, 0.5),
      includeSip: bool(est.includeSip, d.estimates.includeSip),
    },
    rates: {
      staleDays: Math.round(num(rat.staleDays, d.rates.staleDays, 1, 365)),
      minRateGap: num(rat.minRateGap, d.rates.minRateGap, 0, 0.1),
      minAnnualGain: num(rat.minAnnualGain, d.rates.minAnnualGain, 0, 1e9),
      nroTaxRate: num(rat.nroTaxRate, d.rates.nroTaxRate, 0, 0.6),
      defaultTenureMonths: Math.round(
        num(rat.defaultTenureMonths, d.rates.defaultTenureMonths, 1, 120),
      ),
      fdLookaheadDays: Math.round(num(rat.fdLookaheadDays, d.rates.fdLookaheadDays, 1, 730)),
      savingsBuffer: num(rat.savingsBuffer, d.rates.savingsBuffer, 0, 1e9),
      maxTermMonths: Math.round(num(rat.maxTermMonths, d.rates.maxTermMonths, 1, 120)),
      balancedTermMonths: Math.round(
        num(rat.balancedTermMonths, d.rates.balancedTermMonths, 1, 120),
      ),
      flexibleTermMonths: Math.round(
        num(rat.flexibleTermMonths, d.rates.flexibleTermMonths, 1, 120),
      ),
      ladderTermsMonths: (() => {
        const t = Array.isArray(rat.ladderTermsMonths)
          ? (rat.ladderTermsMonths as unknown[])
              .map(Number)
              .filter((x) => Number.isInteger(x) && x >= 1 && x <= 120)
          : [];
        return t.length > 0 ? [...new Set(t)].sort((a, b) => a - b) : d.rates.ladderTermsMonths;
      })(),
      maxBankShare: num(rat.maxBankShare, d.rates.maxBankShare, 0.05, 1),
      safeBankShare: num(rat.safeBankShare, d.rates.safeBankShare, 0.05, 1),
      liquidShare: num(rat.liquidShare, d.rates.liquidShare, 0, 1),
      flexibleLiquidShare: num(rat.flexibleLiquidShare, d.rates.flexibleLiquidShare, 0, 1),
      insuranceBuffer: num(rat.insuranceBuffer, d.rates.insuranceBuffer, 0, 0.5),
      minPiece: num(rat.minPiece, d.rates.minPiece, 0, 1e9),
    },
    refunds: {
      incomeLimit: num(ref.incomeLimit, d.refunds.incomeLimit, 0, 1e9),
      otherIncome: num(ref.otherIncome, d.refunds.otherIncome, 0, 1e9),
    },
    liquidity: {
      order: Array.isArray(liq.order)
        ? withRecentDeposits([
            ...new Set(
              liq.order.filter((k): k is LiquidityKind =>
                (LIQUIDITY_KINDS as readonly unknown[]).includes(k),
              ),
            ),
          ])
        : d.liquidity.order,
      mode:
        liq.mode === 'cheapest' || liq.mode === 'fastest' || liq.mode === 'order'
          ? liq.mode
          : d.liquidity.mode,
      keepInBank: num(liq.keepInBank, d.liquidity.keepInBank, 0, 1e9),
      fdPenaltyPoints: num(liq.fdPenaltyPoints, d.liquidity.fdPenaltyPoints, 0, 0.1),
      fdPartialBreak: bool(liq.fdPartialBreak, d.liquidity.fdPartialBreak),
      recentFdDays: Math.round(num(liq.recentFdDays, d.liquidity.recentFdDays, 0, 365)),
      fdBreakDays: Math.round(num(liq.fdBreakDays, d.liquidity.fdBreakDays, 0, 30)),
      mfSettlementDays: Math.round(num(liq.mfSettlementDays, d.liquidity.mfSettlementDays, 0, 30)),
      stockSettlementDays: Math.round(
        num(liq.stockSettlementDays, d.liquidity.stockSettlementDays, 0, 30),
      ),
      foreignCashDays: Math.round(num(liq.foreignCashDays, d.liquidity.foreignCashDays, 0, 30)),
      exitLoadPct: num(liq.exitLoadPct, d.liquidity.exitLoadPct, 0, 0.1),
      assumedGainShare: num(liq.assumedGainShare, d.liquidity.assumedGainShare, 0, 1),
      propertySaleDays: Math.round(
        num(liq.propertySaleDays, d.liquidity.propertySaleDays, 1, 1095),
      ),
      propertyCostPct: num(liq.propertyCostPct, d.liquidity.propertyCostPct, 0, 0.3),
      receivableDays: Math.round(num(liq.receivableDays, d.liquidity.receivableDays, 0, 730)),
      scenarioDays: Array.isArray(liq.scenarioDays)
        ? [
            ...new Set(
              liq.scenarioDays.filter(
                (x): x is number =>
                  typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= 1095,
              ),
            ),
          ]
            .sort((a, b) => a - b)
            .slice(0, 8)
        : d.liquidity.scenarioDays,
    },
    harvest: {
      minSellAmount: num(har.minSellAmount, d.harvest.minSellAmount, 0, 1e9),
      holdingMarginMonths: Math.round(
        num(har.holdingMarginMonths, d.harvest.holdingMarginMonths, 0, 12),
      ),
      skipActiveSip: bool(har.skipActiveSip, d.harvest.skipActiveSip),
      nri: bool(har.nri, d.harvest.nri),
      exitLoadPct: num(har.exitLoadPct, d.harvest.exitLoadPct, 0, 0.1),
      exitLoadDays: Math.round(num(har.exitLoadDays, d.harvest.exitLoadDays, 0, 1095)),
      sttPct: num(har.sttPct, d.harvest.sttPct, 0, 0.01),
      stampDutyPct: num(har.stampDutyPct, d.harvest.stampDutyPct, 0, 0.01),
      orderBufferDays: Math.round(num(har.orderBufferDays, d.harvest.orderBufferDays, 0, 60)),
    },
    home: {
      changeDays: Math.round(num(hom.changeDays, d.home.changeDays, 7, 365)),
      upcomingDays: Math.round(num(hom.upcomingDays, d.home.upcomingDays, 7, 730)),
      bankShareWatch: num(hom.bankShareWatch, d.home.bankShareWatch, 0.05, 1),
    },
    funds: {
      annualiseAfterMonths: Math.round(
        num(fun.annualiseAfterMonths, d.funds.annualiseAfterMonths, 1, 120),
      ),
      concentrationTop: Math.round(num(fun.concentrationTop, d.funds.concentrationTop, 1, 20)),
      calendarMonths: Math.round(num(fun.calendarMonths, d.funds.calendarMonths, 6, 60)),
      contributionMonths: Math.round(
        num(fun.contributionMonths, d.funds.contributionMonths, 6, 120),
      ),
      maxSlices: Math.round(num(fun.maxSlices, d.funds.maxSlices, 2, 7)),
      navGapDays: Math.round(num(fun.navGapDays, d.funds.navGapDays, 1, 60)),
      outlierPoints: num(fun.outlierPoints, d.funds.outlierPoints, 0, 1),
    },
  };
}

/** A row of the tax_rules table. */
export interface TaxRuleRow {
  fy: string;
  holding_months_long: number;
  stcg_rate: number;
  ltcg_rate: number;
  ltcg_exemption: number;
  cess: number;
  verified: boolean;
  source_note: string | null;
}

/** Rules from Settings replace the built-in rule for the same year; years only in Settings are added. */
export function mergeRules(rows: TaxRuleRow[], base: TaxRuleSet[] = RULES): TaxRuleSet[] {
  const byFy = new Map(base.map((r) => [r.fy, r]));
  for (const row of rows) {
    const b = fyBoundsOf(row.fy);
    if (!b) continue;
    byFy.set(row.fy, {
      fy: row.fy,
      from: b.from,
      to: b.to,
      equity: {
        holdingMonthsLong: row.holding_months_long,
        stcgRate: Number(row.stcg_rate),
        ltcgRate: Number(row.ltcg_rate),
        ltcgExemption: Number(row.ltcg_exemption),
      },
      cess: Number(row.cess),
      verification: row.verified ? 'primary' : 'unverified',
      sources: [],
      notes: row.source_note ? [row.source_note] : ['Entered in Settings.'],
    });
  }
  return [...byFy.values()].sort((a, b) => a.fy.localeCompare(b.fy));
}
