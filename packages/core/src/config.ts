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
    /** deposit insurance cover per depositor per bank (DICGC); change it when the limit changes */
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
  },
  refunds: { incomeLimit: 400_000, otherIncome: 0 },
  liquidity: {
    order: ['cash', 'fd_maturing', 'mf', 'fd_break', 'stock', 'receivable', 'property'],
    mode: 'cheapest',
    keepInBank: 10_000,
    fdPenaltyPoints: 0.01,
    fdPartialBreak: false,
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
  harvest: { minSellAmount: 1000, holdingMarginMonths: 1, skipActiveSip: true, nri: true },
};

const num = (v: unknown, d: number, lo: number, hi: number) =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : d;
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** Reads the saved JSON defensively: anything missing or out of range falls back to the default. */
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
    },
    refunds: {
      incomeLimit: num(ref.incomeLimit, d.refunds.incomeLimit, 0, 1e9),
      otherIncome: num(ref.otherIncome, d.refunds.otherIncome, 0, 1e9),
    },
    liquidity: {
      order: Array.isArray(liq.order)
        ? [
            ...new Set(
              liq.order.filter((k): k is LiquidityKind =>
                (LIQUIDITY_KINDS as readonly unknown[]).includes(k),
              ),
            ),
          ]
        : d.liquidity.order,
      mode:
        liq.mode === 'cheapest' || liq.mode === 'fastest' || liq.mode === 'order'
          ? liq.mode
          : d.liquidity.mode,
      keepInBank: num(liq.keepInBank, d.liquidity.keepInBank, 0, 1e9),
      fdPenaltyPoints: num(liq.fdPenaltyPoints, d.liquidity.fdPenaltyPoints, 0, 0.1),
      fdPartialBreak: bool(liq.fdPartialBreak, d.liquidity.fdPartialBreak),
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
