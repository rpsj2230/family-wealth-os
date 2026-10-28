/**
 * Every tunable number lives here as a default and is overridden from Settings (stored per household). Nothing in the app
 * should repeat these numbers: it reads them from the configuration it is given. Values from Settings are checked and clamped,
 * so a typo can never produce a nonsense limit.
 */
import { RULES, fyBoundsOf, type TaxRuleSet } from './tax';
import { parsePriceLine } from './ai-cost';
import { LIQUIDITY_KINDS, type LiquidityKind } from './liquidity-kinds';
export { effectiveRules, fyBoundsOf, type EffectiveRules } from './tax';

export interface AppConfig {
  deposits: {
    /** deposit insurance cover per ownership name per bank (DICGC): each name as written, and joint names in each order, is insured separately; change it when the limit changes */
    insuranceLimit: number;
    /** days before maturity at which an alert escalates, smallest first */
    maturityAlertDays: number[];
    /**
     * a deposit that matured more than this many days ago is hidden from the lists (Accounts, Monthly update), whatever its status;
     * a confirmed matured, renewed or closed deposit is hidden at once. A deposit whose date has passed is not counted anywhere.
     */
    hideMaturedAfterDays: number;
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
    /** a fund statement or transactions file shows a SIP (new, resumed or changed) only when at least this many similar instalments came in a row, one cadence apart */
    sipMinInstalments: number;
    /** Import history: a monthly tab with a deposit that starts more than this many days after the month it is named for is flagged (probably a copy of a later month) */
    historyStartsAfterDays: number;
    /** Import history: a line that sits where an account's balance in the neighbouring tabs is far from it is not matched to that account when its value is more than this many times higher or lower (and the difference is more than the floor) */
    historyJumpFactor: number;
    /** Import history: a difference of less than this many rupees is never called a jump */
    historyJumpFloor: number;
    /** Import history: of two accounts a line could be, the one whose neighbouring balances are at least this many times closer is taken as likely */
    historyTieRatio: number;
    /** a savings account whose recorded balances grow at a rate this far (0.02 = 2 points) from the rate it is valued at is flagged: "earning about X% (from your records)" */
    observedRateGap: number;
    /** yearly growth assumed for holdings with no price or rate to follow, as fractions (0 = none, the value recorded is held flat): property, pension accounts (NPS, ULIP) and everything else recorded by hand */
    assumedGrowthProperty: number;
    assumedGrowthRetirement: number;
    assumedGrowthOther: number;
    /** the history rebuilt by the app agrees with the workbook's Summary totals when within this share of the total (0.01 = 1%) */
    reconcileTolerance: number;
    /** a bank's savings slabs apply to each part of the balance (incremental) rather than the whole balance at one slab's rate, unless the bank says otherwise */
    savingsSlabIncremental: boolean;
    /** savings interest is credited every this many months (3 = quarterly, as Indian banks do); until then it is accrued */
    savingsCreditMonths: number;
    /** a new balance within this many rupees of the estimate is explained; a larger difference is "not yet explained" until you classify it */
    unexplainedTolerance: number;
    /** two balance changes of the same sum in opposite directions this many days apart or less are offered as one transfer */
    transferPairDays: number;
  };
  /** the family's own money and its profit (capital.ts) */
  capital: {
    /** the day the family's own money is measured from (ISO date); empty: the first day with records for the holdings on file */
    openingDate: string;
    /** Explain movements > Earlier months: a month whose unexplained money is below this many rupees is not listed */
    reviewMinimum: number;
    /** two months this many months apart or less whose unexplained amounts cancel out are one transfer recorded in two months */
    reviewPairMonths: number;
    /**
     * Money trail: from this day, money moved from one person's account to another's is counted for clubbing; what each person held
     * before it is theirs (ISO date). Empty: nothing is counted yet.
     */
    ownershipFrom: string;
  };
  /** bank statements read line by line (statement-classify.ts) */
  statements: {
    /** words in a line's narration that mark rent from your tenant (their name, a standing reference): counted as earnings */
    rentWords: string[];
    /** words that mark money sent from abroad (a remittance from Singapore): counted as your own money coming in */
    remittanceWords: string[];
    /** a line no rule places is asked about when it is this many rupees or more; a smaller one counts as spending (out) or a small credit (in) */
    reviewAbove: number;
    /** days between a bank debit and the fund allotment the CAS shows (a SIP is debited a day or more before units are allotted) */
    fundMatchDays: number;
  };
  inbox: {
    /** your own mailboxes that forward the banks' mail to the app: the bank is recognised by the original sender inside the forward */
    trustedForwarders: string[];
    /**
     * the time zone your Gmail shows times in, as hours from UTC: a forwarded alert's original time is written in it ("Date: Wed, 28 Oct,
     * 2026, 15:28"), and it orders two alerts of the same day
     */
    forwardUtcOffsetHours: number;
  };
  rates: {
    /** an offer not checked within this many days is shown as old (rates are read once a month, so this is longer than a month) */
    staleDays: number;
    /** the day of the month the bank rate pages are read; in a month without that day, the last day */
    syncDay: number;
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
    /** the most you will ever put with one bank in savings or a deposit: rates that apply only above this amount are not read, stored or shown */
    maxAmount: number;
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
    /** months after which units of an international, gold or fund-of-funds fund are long-term (they have no tax-free allowance) */
    otherLongMonths: number;
  };
  /** what the AI costs: the prices it is charged at, to turn the logged tokens into money */
  ai: {
    /** rupees per US dollar, to show the cost in rupees as well */
    usdInr: number;
    /** one line per model: "model = input / output / cache read / cache write", in dollars per million tokens (see core ai-cost) */
    prices: string[];
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
  /** what the daily summary e-mail shows */
  digest: {
    /** a goal whose projection beats its cost by more than this share is "ahead" rather than "on track" (0.1 = 10%) */
    aheadMargin: number;
    /** the most items listed under "Needs you" */
    needsYouMax: number;
    /** the most movers and maturities listed under "What changed" */
    changesMax: number;
    /** possible market paths run for the retirement success chance in the e-mail; 0 leaves the chance out */
    monteCarloRuns: number;
  };
  /** how the mutual-fund statistics and graphs are cut */
  funds: {
    /** the date from which the transactions of every fund should be on file (ISO date): a person whose earliest transaction is later is asked for an earlier statement */
    historyFrom: string;
    /** the units a ledger may be out by (rounding on a statement) before it counts as not adding up */
    unitTolerance: number;
    /** the rupees a ledger may be out by before the money does not count as adding up */
    moneyTolerance: number;
    /** an annual figure (CAGR, XIRR over time) is shown only after money has been invested this many months */
    annualiseAfterMonths: number;
    /** a fund's NAV older than this many days is flagged as stale (NAVs are published on business days) */
    navStaleDays: number;
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
    /** the yearly return assumed to be free of risk (a short government bill), for the Sharpe and Sortino ratios */
    riskFreeRate: number;
    /** months of returns behind volatility, Sharpe and Sortino, and the fewest that make them worth showing */
    riskMonths: number;
    riskMinMonths: number;
    /** holding windows, in years, for rolling returns, and the fewest windows worth summarising */
    rollingYears: number[];
    rollingMinWindows: number;
    /** the AMFI scheme code of the index fund used as the benchmark proxy ('' = none) */
    benchmarkCode: string;
    /** the horizons of "if you carry on like this", the highest yearly return it may assume and the band around it */
    projectionYears: number[];
    projectionCap: number;
    projectionSpread: number;
    /** the ages, in months, where the "how old are the units" buckets end */
    ageBucketsMonths: number[];
    /** transaction lines shown before "Show more", the next instalments listed, and the funds named as movers */
    ledgerPageSize: number;
    upcomingSips: number;
    moversShown: number;
    /** weeks of weekly profit and loss kept, buckets shown in the profit and loss chart, and funds in a fund-against-fund comparison */
    weeksShown: number;
    plRows: number;
    compareFunds: number;
    /** Investments > Value by period: how many periods "recent" shows (the longer choice is twice this) */
    valuationPeriods: number;
    /** quarters follow the financial year (April to June is Q1); off: calendar quarters (January to March is Q1) */
    financialQuarters: boolean;
    /** Investments > Match funds: how many schemes are listed for a fund, and how many a name search returns */
    matchChoices: number;
    matchSearchResults: number;
    /** Home's note "fund gains are approximate until you import your fund statements" shows while more funds than this have no transaction ledger (0 = any) */
    noLedgerNoteAbove: number;
    /** a fund with no ledger has its units rebuilt from its SIP plan; the plan's money in may differ from the amount invested by this share before it is adjusted (0.02 = 2%) */
    planTolerance: number;
  };
  /** the Google Sheet sync: which month the sheet is for, where its register sits and how the safety copy is named */
  sheetSync: {
    /** the time zone in which "this month" is decided (an IANA name such as Asia/Singapore) */
    timeZone: string;
    /** the first and last row of the register in a month tab (the plans block sits below it); the sync looks for the real end and uses this only when it cannot find it */
    firstRow: number;
    lastRow: number;
    /** added to a month tab's name for the hidden safety copy made before its data is replaced */
    backupSuffix: string;
  };
  /** reading the fund statements that CAMS, KFintech, NSDL and CDSL e-mail you, from your whole Gmail, with no AI */
  statementMail: {
    /** the daily scan is on */
    enabled: boolean;
    /** who the statements may come from: a domain (camsonline.com, which also covers its sub-domains) or one full address, one per entry */
    senders: string[];
    /** the first scan looks back this many days, so last year's statements are picked up */
    firstDays: number;
    /** every later scan looks back this many days (messages already read are skipped, so overlap is harmless) */
    regularDays: number;
    /** a PDF larger than this many megabytes is not downloaded */
    maxMb: number;
    /** at most this many statements are imported in one scan; the rest wait for the next one */
    maxPerRun: number;
    /** the scheduled job does not scan again within this many hours (pressing Scan now overrides it) */
    minGapHours: number;
    /** a requested full statement that has not arrived after this many days is flagged and leaves a task */
    requestWaitDays: number;
  };
}

export const DEFAULT_CONFIG: AppConfig = {
  deposits: {
    insuranceLimit: 500_000,
    maturityAlertDays: [7, 15, 30, 60, 90],
    hideMaturedAfterDays: 60,
  },
  reminders: { policyDays: 45, taskDays: 7, maturitySoonDays: 30, harvestMonth: 3, harvestDay: 15 },
  estimates: {
    freshnessDays: 35,
    savingsRate: 0.03,
    interestTdsRate: 0,
    includeSip: true,
    sipMinInstalments: 3,
    historyStartsAfterDays: 62,
    historyJumpFactor: 50,
    historyJumpFloor: 100_000,
    historyTieRatio: 3,
    observedRateGap: 0.02,
    assumedGrowthProperty: 0,
    assumedGrowthRetirement: 0,
    assumedGrowthOther: 0,
    reconcileTolerance: 0.01,
    savingsSlabIncremental: false,
    savingsCreditMonths: 3,
    unexplainedTolerance: 500,
    transferPairDays: 3,
  },
  capital: { openingDate: '', reviewMinimum: 25_000, reviewPairMonths: 2, ownershipFrom: '' },
  statements: {
    rentWords: [],
    remittanceWords: [
      'inward remittance',
      'inward remit',
      'foreign inward',
      'fira',
      'swift',
      'irm',
      'wise',
      'remitly',
      'instarem',
      'western union',
      'singapore',
      'sgd',
    ],
    reviewAbove: 10_000,
    fundMatchDays: 5,
  },
  inbox: { trustedForwarders: [], forwardUtcOffsetHours: 8 },
  rates: {
    staleDays: 45,
    syncDay: 30,
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
    maxAmount: 10_000_000,
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
    otherLongMonths: 24,
  },
  ai: {
    usdInr: 88,
    prices: [
      // Claude Haiku 5.5 (the default reader), for prompts up to 100,000 tokens; the cache prices are the usual tenth and quarter-more
      'claude-haiku-5-5 = 0.10 / 0.50 / 0.01 / 0.125',
      // OpenRouter's free models cost nothing
      '*:free = 0 / 0 / 0 / 0',
    ],
  },
  home: { changeDays: 30, upcomingDays: 120, bankShareWatch: 0.4 },
  digest: { aheadMargin: 0.1, needsYouMax: 5, changesMax: 3, monteCarloRuns: 2000 },
  funds: {
    historyFrom: '2021-01-01',
    unitTolerance: 0.001,
    moneyTolerance: 1,
    annualiseAfterMonths: 12,
    navStaleDays: 4,
    concentrationTop: 3,
    calendarMonths: 24,
    contributionMonths: 24,
    maxSlices: 7,
    navGapDays: 10,
    outlierPoints: 0.05,
    riskFreeRate: 0.06,
    riskMonths: 36,
    riskMinMonths: 24,
    rollingYears: [1, 3],
    rollingMinWindows: 12,
    benchmarkCode: '120716',
    projectionYears: [1, 3, 5, 10],
    projectionCap: 0.2,
    projectionSpread: 0.03,
    ageBucketsMonths: [3, 12, 36],
    ledgerPageSize: 100,
    upcomingSips: 5,
    moversShown: 3,
    weeksShown: 26,
    plRows: 24,
    compareFunds: 4,
    valuationPeriods: 12,
    financialQuarters: true,
    matchChoices: 3,
    matchSearchResults: 10,
    noLedgerNoteAbove: 0,
    planTolerance: 0.02,
  },
  sheetSync: {
    timeZone: 'Asia/Singapore',
    firstRow: 3,
    lastRow: 113,
    backupSuffix: ' - before sync',
  },
  statementMail: {
    enabled: true,
    // Where CAS e-mails come from (checked 27 Oct 2026, see packages/ingest/src/statement-mail.ts): CAMS donotreply@camsonline.com,
    // KFintech samfS@kfintech.com, NSDL NSDL-CAS@nsdl.co.in, CDSL eCAS@cdslstatement.com; MF Central and the older Karvy and CDSL
    // domains are listed as well. A domain also covers its sub-domains. Edit the list in Settings.
    senders: [
      'camsonline.com',
      'kfintech.com',
      'karvy.com',
      'nsdl.co.in',
      'nsdl.com',
      'cdslstatement.com',
      'cdslindia.com',
      'mfcentral.com',
    ],
    firstDays: 400,
    regularDays: 35,
    maxMb: 15,
    maxPerRun: 40,
    minGapHours: 20,
    requestWaitDays: 2,
  },
};

/**
 * One allowed sender as written in Settings: a domain ("camsonline.com", "@camsonline.com" and "*.camsonline.com" all mean the
 * domain and its sub-domains) or one full address. Lower case; null when it is neither.
 */
export function cleanSender(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const x = raw.trim().toLowerCase().replace(/^\*\./, '').replace(/^@/, '');
  if (/^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(x)) return x;
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(x)) return x;
  return null;
}

const num = (v: unknown, d: number, lo: number, hi: number) =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : d;
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
/** A saved list of whole numbers in a range: duplicates dropped, sorted, at most `max` kept; the default when nothing valid is saved. */
const ints = (v: unknown, d: number[], lo: number, hi: number, max: number): number[] => {
  const list = Array.isArray(v)
    ? [
        ...new Set(
          v.filter(
            (x): x is number => typeof x === 'number' && Number.isInteger(x) && x >= lo && x <= hi,
          ),
        ),
      ]
        .sort((a, b) => a - b)
        .slice(0, max)
    : [];
  return list.length > 0 ? list : d;
};
/** An IANA time zone name this runtime knows (Asia/Singapore), or the default. */
const zone = (v: unknown, d: string): string => {
  if (typeof v !== 'string' || v.length > 64) return d;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: v });
    return v;
  } catch {
    return d;
  }
};
/** The safety copy's suffix: short, plain characters only (a tab name cannot hold every character). */
const tabSuffix = (v: unknown, d: string): string =>
  typeof v === 'string' && /^[A-Za-z0-9 ._()-]{3,40}$/.test(v) ? v : d;
/** A real calendar date written 2021-01-01, or the default. */
const isoDate = (v: unknown, d: string): string => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return d;
  const t = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === v ? v : d;
};
/** A list of words or short phrases (lower case, trimmed, no repeats); a missing list keeps the default, an empty one stays empty. */
const words = (v: unknown, d: string[]): string[] =>
  Array.isArray(v)
    ? [
        ...new Set(
          v
            .map((x) => String(x).trim().toLowerCase().replace(/\s+/g, ' '))
            .filter((x) => x.length >= 2 && x.length <= 60),
        ),
      ].slice(0, 60)
    : d;
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
  const dig = obj(r.digest);
  const aiSec = obj(r.ai);
  const sheet = obj(r.sheetSync);
  const stm = obj(r.statementMail);
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
      hideMaturedAfterDays: Math.round(
        num(dep.hideMaturedAfterDays, d.deposits.hideMaturedAfterDays, 1, 3650),
      ),
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
      sipMinInstalments: Math.round(
        num(est.sipMinInstalments, d.estimates.sipMinInstalments, 2, 12),
      ),
      historyStartsAfterDays: Math.round(
        num(est.historyStartsAfterDays, d.estimates.historyStartsAfterDays, 0, 400),
      ),
      historyJumpFactor: num(est.historyJumpFactor, d.estimates.historyJumpFactor, 2, 10_000),
      historyJumpFloor: num(est.historyJumpFloor, d.estimates.historyJumpFloor, 0, 1_000_000_000),
      historyTieRatio: num(est.historyTieRatio, d.estimates.historyTieRatio, 1, 100),
      observedRateGap: num(est.observedRateGap, d.estimates.observedRateGap, 0, 0.5),
      assumedGrowthProperty: num(
        est.assumedGrowthProperty,
        d.estimates.assumedGrowthProperty,
        -0.2,
        0.5,
      ),
      assumedGrowthRetirement: num(
        est.assumedGrowthRetirement,
        d.estimates.assumedGrowthRetirement,
        -0.2,
        0.5,
      ),
      assumedGrowthOther: num(est.assumedGrowthOther, d.estimates.assumedGrowthOther, -0.2, 0.5),
      reconcileTolerance: num(est.reconcileTolerance, d.estimates.reconcileTolerance, 0, 1),
      savingsSlabIncremental: bool(est.savingsSlabIncremental, d.estimates.savingsSlabIncremental),
      savingsCreditMonths: [1, 3, 6, 12].includes(Number(est.savingsCreditMonths))
        ? Number(est.savingsCreditMonths)
        : d.estimates.savingsCreditMonths,
      unexplainedTolerance: num(est.unexplainedTolerance, d.estimates.unexplainedTolerance, 0, 1e7),
      transferPairDays: Math.round(num(est.transferPairDays, d.estimates.transferPairDays, 0, 31)),
    },
    capital: {
      openingDate: (() => {
        const v = obj(r.capital).openingDate;
        return v === '' || v === null || v === undefined ? '' : isoDate(v, d.capital.openingDate);
      })(),
      reviewMinimum: num(obj(r.capital).reviewMinimum, d.capital.reviewMinimum, 0, 1e9),
      reviewPairMonths: Math.round(
        num(obj(r.capital).reviewPairMonths, d.capital.reviewPairMonths, 0, 12),
      ),
      ownershipFrom: (() => {
        const v = obj(r.capital).ownershipFrom;
        return v === '' || v === null || v === undefined ? '' : isoDate(v, d.capital.ownershipFrom);
      })(),
    },
    statements: {
      rentWords: words(obj(r.statements).rentWords, d.statements.rentWords),
      remittanceWords: words(obj(r.statements).remittanceWords, d.statements.remittanceWords),
      reviewAbove: num(obj(r.statements).reviewAbove, d.statements.reviewAbove, 0, 1e9),
      fundMatchDays: Math.round(
        num(obj(r.statements).fundMatchDays, d.statements.fundMatchDays, 0, 31),
      ),
    },
    inbox: {
      trustedForwarders: (() => {
        const raw = obj(r.inbox).trustedForwarders;
        const list = Array.isArray(raw)
          ? raw
              .map((x) => String(x).trim().toLowerCase())
              .filter((x) => /^[^@\s,]+@[^@\s,]+\.[^@\s,]+$/.test(x))
          : [];
        return [...new Set(list)].slice(0, 10);
      })(),
      // whole or half hours (India is 5.5)
      forwardUtcOffsetHours:
        Math.round(
          num(obj(r.inbox).forwardUtcOffsetHours, d.inbox.forwardUtcOffsetHours, -12, 14) * 4,
        ) / 4,
    },
    rates: {
      staleDays: Math.round(num(rat.staleDays, d.rates.staleDays, 1, 365)),
      syncDay: Math.round(num(rat.syncDay, d.rates.syncDay, 1, 31)),
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
      maxAmount: num(rat.maxAmount, d.rates.maxAmount, 100_000, 1e11),
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
      otherLongMonths: Math.round(num(har.otherLongMonths, d.harvest.otherLongMonths, 1, 120)),
    },
    ai: {
      usdInr: num(aiSec.usdInr, d.ai.usdInr, 1, 1000),
      prices: (() => {
        const lines = Array.isArray(aiSec.prices)
          ? (aiSec.prices as unknown[])
              .filter((x): x is string => typeof x === 'string')
              .map((x) => x.trim())
              .filter((x) => x !== '' && !('error' in parsePriceLine(x)))
          : [];
        return lines.length > 0 ? lines.slice(0, 40) : d.ai.prices;
      })(),
    },
    home: {
      changeDays: Math.round(num(hom.changeDays, d.home.changeDays, 7, 365)),
      upcomingDays: Math.round(num(hom.upcomingDays, d.home.upcomingDays, 7, 730)),
      bankShareWatch: num(hom.bankShareWatch, d.home.bankShareWatch, 0.05, 1),
    },
    digest: {
      aheadMargin: num(dig.aheadMargin, d.digest.aheadMargin, 0, 1),
      needsYouMax: Math.round(num(dig.needsYouMax, d.digest.needsYouMax, 1, 10)),
      changesMax: Math.round(num(dig.changesMax, d.digest.changesMax, 1, 8)),
      monteCarloRuns: Math.round(num(dig.monteCarloRuns, d.digest.monteCarloRuns, 0, 5000)),
    },
    funds: {
      historyFrom: isoDate(fun.historyFrom, d.funds.historyFrom),
      unitTolerance: num(fun.unitTolerance, d.funds.unitTolerance, 0, 1),
      moneyTolerance: num(fun.moneyTolerance, d.funds.moneyTolerance, 0, 1000),
      navStaleDays: Math.round(num(fun.navStaleDays, d.funds.navStaleDays, 1, 60)),
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
      riskFreeRate: num(fun.riskFreeRate, d.funds.riskFreeRate, 0, 0.3),
      riskMonths: Math.round(num(fun.riskMonths, d.funds.riskMonths, 6, 120)),
      riskMinMonths: Math.round(num(fun.riskMinMonths, d.funds.riskMinMonths, 6, 120)),
      rollingYears: ints(fun.rollingYears, d.funds.rollingYears, 1, 20, 4),
      rollingMinWindows: Math.round(num(fun.rollingMinWindows, d.funds.rollingMinWindows, 1, 600)),
      benchmarkCode:
        typeof fun.benchmarkCode === 'string' && /^\d{0,10}$/.test(fun.benchmarkCode.trim())
          ? fun.benchmarkCode.trim()
          : d.funds.benchmarkCode,
      projectionYears: ints(fun.projectionYears, d.funds.projectionYears, 1, 40, 6),
      projectionCap: num(fun.projectionCap, d.funds.projectionCap, 0, 0.4),
      projectionSpread: num(fun.projectionSpread, d.funds.projectionSpread, 0, 0.2),
      ageBucketsMonths: ints(fun.ageBucketsMonths, d.funds.ageBucketsMonths, 1, 600, 6),
      ledgerPageSize: Math.round(num(fun.ledgerPageSize, d.funds.ledgerPageSize, 10, 2000)),
      upcomingSips: Math.round(num(fun.upcomingSips, d.funds.upcomingSips, 1, 30)),
      moversShown: Math.round(num(fun.moversShown, d.funds.moversShown, 1, 10)),
      weeksShown: Math.round(num(fun.weeksShown, d.funds.weeksShown, 4, 104)),
      plRows: Math.round(num(fun.plRows, d.funds.plRows, 4, 120)),
      compareFunds: Math.round(num(fun.compareFunds, d.funds.compareFunds, 2, 8)),
      valuationPeriods: Math.round(num(fun.valuationPeriods, d.funds.valuationPeriods, 2, 60)),
      financialQuarters: bool(fun.financialQuarters, d.funds.financialQuarters),
      matchChoices: Math.round(num(fun.matchChoices, d.funds.matchChoices, 2, 6)),
      matchSearchResults: Math.round(
        num(fun.matchSearchResults, d.funds.matchSearchResults, 3, 30),
      ),
      noLedgerNoteAbove: Math.round(num(fun.noLedgerNoteAbove, d.funds.noLedgerNoteAbove, 0, 1000)),
      planTolerance: num(fun.planTolerance, d.funds.planTolerance, 0, 0.5),
    },
    sheetSync: (() => {
      const first = Math.round(num(sheet.firstRow, d.sheetSync.firstRow, 1, 500));
      return {
        timeZone: zone(sheet.timeZone, d.sheetSync.timeZone),
        firstRow: first,
        lastRow: Math.max(first, Math.round(num(sheet.lastRow, d.sheetSync.lastRow, 1, 2000))),
        backupSuffix: tabSuffix(sheet.backupSuffix, d.sheetSync.backupSuffix),
      };
    })(),
    statementMail: {
      enabled: bool(stm.enabled, d.statementMail.enabled),
      senders: (() => {
        const list = Array.isArray(stm.senders)
          ? [
              ...new Set(
                (stm.senders as unknown[]).map(cleanSender).filter((x): x is string => !!x),
              ),
            ]
          : [];
        return list.length > 0 ? list.slice(0, 40) : d.statementMail.senders;
      })(),
      firstDays: Math.round(num(stm.firstDays, d.statementMail.firstDays, 1, 1500)),
      regularDays: Math.round(num(stm.regularDays, d.statementMail.regularDays, 1, 400)),
      maxMb: num(stm.maxMb, d.statementMail.maxMb, 1, 40),
      maxPerRun: Math.round(num(stm.maxPerRun, d.statementMail.maxPerRun, 1, 200)),
      minGapHours: Math.round(num(stm.minGapHours, d.statementMail.minGapHours, 1, 168)),
      requestWaitDays: Math.round(num(stm.requestWaitDays, d.statementMail.requestWaitDays, 1, 60)),
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
