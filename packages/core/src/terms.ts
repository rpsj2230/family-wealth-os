/**
 * The money words: one list for every page, table header, download, email line, "?" text and the user guide, so one idea never has
 * two names and a label never disagrees with its "?". Each term has the label shown and the one-sentence hint behind its "?".
 *
 * Two pictures of money, never mixed:
 *  - family level: Own money + Lifetime profit = Net worth, with XIRR on own money;
 *  - holdings: Invested + Profit = Current value, with the Overall return (Profit ÷ Invested) and XIRR for each kind of holding.
 *
 * Every percentage says what kind it is: "overall" (total growth), "a year" (a yearly rate), "for a period", or "of …" (a share).
 * Only returns and changes carry + or − and a colour; shares and rates never do (see PERCENT_KIND).
 * Pure: no I/O.
 */

export interface MoneyTerm {
  label: string;
  hint: string;
}

const t = (label: string, hint: string): MoneyTerm => ({ label, hint });

export const TERMS = {
  // family level
  netWorth: t(
    'Net worth',
    'Everything the family owns today at its current value, less anything owed. Property is not counted unless Settings says so.',
  ),
  ownMoney: t(
    'Own money',
    'Money that came into the family from outside (transfers from abroad, salary, gifts, and what you held on the first day of records), less money taken out to spend. Interest and profit are never part of it.',
  ),
  lifetimeProfit: t(
    'Lifetime profit',
    'Everything your own money has earned since records began: Net worth − Own money.',
  ),
  xirrOwn: t(
    'XIRR on own money',
    'The yearly rate the family’s own money has earned since records began, counting when each rupee came in and went out. Savings and time waiting in savings are included.',
  ),
  overallOwn: t(
    'Overall return on own money',
    'Lifetime profit as a share of Own money: total growth, however long it took. Not a yearly rate.',
  ),
  earningRate: t(
    'Earning rate now',
    'What all your money earns a year at today’s rates: deposits and funds at their XIRR, savings at the rate earned this year, money lent at 0%.',
  ),
  // holdings
  currentValue: t('Current value', 'What it is worth today.'),
  invested: t(
    'Invested',
    'What the deposits and fund units you hold today cost. Units you sold are not in it. A deposit renewed with its interest counts at its new amount.',
  ),
  investedPrincipal: t(
    'Invested (principal)',
    'The amount each running deposit was booked with. A deposit renewed with its interest counts at its new amount, so earlier interest can be inside it.',
  ),
  balance: t('Balance', 'The last balance the bank showed, with its date.'),
  profit: t(
    'Profit',
    'What your holdings have gained on top of what they cost: Current value − Invested.',
  ),
  profitInterest: t(
    'Profit (interest earned)',
    'The interest the deposits have earned and still hold: Current value − Invested. Interest already paid out is Booked profit.',
  ),
  overall: t(
    'Overall return',
    'Profit as a share of Invested: total growth, however long it took. Not a yearly rate.',
  ),
  xirr: t(
    'XIRR',
    'Your profit as a yearly rate, counting when each rupee went in and came out. Comparable with an FD rate.',
  ),
  booked: t(
    'Booked profit',
    'Profit already taken: gains on fund units sold, and interest paid out to your account.',
  ),
  totalProfit: t('Total profit', 'Profit + Booked profit.'),
  todayChange: t(
    'Today’s change',
    'How much the value moved since the previous day. Money you added or took out is not counted.',
  ),
  earned: t(
    'Earned',
    'Profit made in the period shown, with money added or taken out left out. Profit from sales in the period is included.',
  ),
  earnedFy: t(
    'Earned this FY',
    'Profit made since 1 April, with money added or taken out left out: interest, fund gains, exchange-rate moves and other income.',
  ),
  added: t('Added', 'Money that went in during the period.'),
  withdrawn: t('Withdrawn', 'Money that came out during the period.'),
  // deposits and savings
  maturityValue: t(
    'Maturity value',
    'What the deposit pays on its maturity date: the bank’s figure, otherwise worked out from its terms.',
  ),
  interestToCome: t('Interest still to come', 'Maturity value − Current value.'),
  totalInterest: t(
    'Total interest',
    'Maturity value − Invested: all the interest over the deposit’s term.',
  ),
  interestEarned: t(
    'Interest earned',
    'Interest for the period shown, whether credited, paid out or still building up.',
  ),
  interestRate: t(
    'Interest rate',
    'The yearly rate on the deposit’s or account’s contract, from the bank.',
  ),
  rateEarned: t(
    'Rate earned',
    'Interest earned this financial year as a yearly rate on today’s balance.',
  ),
  averageRate: t(
    'Average interest rate',
    'The rates of all the deposits (or accounts) shown, weighted by how much is in each.',
  ),
  rateAfterTax: t(
    'Rate after tax',
    'The interest rate after Indian tax: NRE interest is tax-free, NRO interest is taxed at the rate in Settings.',
  ),
  available30: t(
    'Available within 30 days',
    'Savings and cash plus deposits maturing in the next 30 days.',
  ),
  maturing90: t(
    'Maturing in 90 days',
    'The principal of deposits that mature in the next 90 days.',
  ),
  aboveInsured: t(
    'Above the insured limit',
    'Deposits and balances over the insured limit per bank per name, which deposit insurance does not cover.',
  ),
  nreNro: t(
    'NRE · NRO',
    'Bank money in NRE accounts (interest tax-free) and NRO accounts (interest taxed in India).',
  ),
  // funds
  units: t('Units', 'The fund units you hold.'),
  nav: t('NAV', 'The price of one unit.'),
  averageCost: t('Average cost', 'Invested ÷ Units.'),
  fundReturn: t(
    'Fund return',
    'How the fund’s NAV moved over the period: the fund’s own performance, not yours.',
  ),
  benchmark: t(
    'Benchmark',
    'The index the fund is measured against, from its scheme documents. Named under each chart.',
  ),
  sip: t(
    'SIP status',
    'The monthly instalment and its status: Running, Paused until a date, Stopped, or None.',
  ),
  longTermShare: t(
    'Long-term share',
    'The share of the equity value held long enough to be taxed as long-term.',
  ),
} as const satisfies Record<string, MoneyTerm>;

export type TermKey = keyof typeof TERMS;

/** The label of a term. */
export const termLabel = (k: TermKey): string => TERMS[k].label;
/** The "?" hint of a term. */
export const termHint = (k: TermKey): string => TERMS[k].hint;

/** The kind of a percentage, and the words after it. */
export const PERCENT_KIND = {
  overall: 'overall',
  yearly: 'a year',
  period: 'for the period',
  share: 'of',
} as const;

/**
 * Words that are no longer used anywhere a person reads (their replacement in brackets): "put in" (Invested / Added), "worth today"
 * and "value now" (Current value), "gain" and "growth" (Profit), CAGR (XIRR). The Tax page keeps the Income Tax words (capital gains).
 * A test fails when one of these appears in a page's text.
 */
export const RETIRED_WORDS = [
  /\bput in\b/i,
  /\bworth today\b/i,
  /\bvalue now\b/i,
  /\bvalue today\b/i,
  /\bamount invested now\b/i,
  /\bown money brought in\b/i,
  /\bCAGR\b/,
  /\bis growth\b/i,
] as const;
