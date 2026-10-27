/**
 * The "?" explainers of Tax (the allowance meter, the funds to sell, the losses, the costs, the refunds and the simulator), of the
 * Monthly update (how many banks are up to date, what current means), of New money (the five ways to place a sum, the market
 * comparison, the insurance room) and of the Rates pages (how fresh the rates are). Pure: each takes the numbers its page already holds.
 */
import { explain, exDate, exInr, exPct, exPlural, exSigned, type ExplainSet } from './explain';

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

// ------------------------------------------------------------------------------------------------
// Tax
// ------------------------------------------------------------------------------------------------
export interface TaxExplainInput {
  fy: string;
  today: string;
  deadline: string;
  daysLeft: number;
  orderBy: string;
  status: 'ok' | 'rules_missing';
  rulesVerified: boolean;
  rulesCarriedForward: boolean;
  people: {
    name: string;
    meter: { allowance: number; used: number; plan: number; free: number };
    sell: { fund: string; worth: number; gain: number; estimated: boolean }[];
    losses: {
      fund: string;
      loss: number;
      shortLoss: number;
      longLoss: number;
      estimated: boolean;
    }[];
  }[];
  costs: { stt: number; stampDuty: number; exitLoad: number; total: number };
  refunds: {
    count: number;
    open: number;
    expectedGain: number;
    expectedRefund: number;
    received: number;
    incomeLimit: number;
  };
  links: { settings: string; investments: string; filing: string; import: string };
}

export function buildTaxExplain(i: TaxExplainInput): ExplainSet<'tax'> {
  const ruleLevel =
    i.status === 'rules_missing'
      ? ('missing' as const)
      : i.rulesCarriedForward || !i.rulesVerified
        ? ('partly_estimated' as const)
        : ('complete' as const);
  const ruleText =
    i.status === 'rules_missing'
      ? 'The tax rules for this year are not entered, so no allowance can be worked out.'
      : i.rulesCarriedForward
        ? 'This year’s tax numbers are not entered: last year’s rules are assumed to apply.'
        : !i.rulesVerified
          ? 'The rates are entered but not yet marked verified.'
          : 'The rules for this year are entered and verified.';
  const sells = i.people.flatMap((p) => p.sell);
  const estSells = sells.filter((s) => s.estimated).length;
  const losses = i.people.flatMap((p) => p.losses);
  const ruleInput = {
    label: i.fy ? `Tax rules for FY ${i.fy}` : 'Tax rules',
    value:
      i.status === 'rules_missing'
        ? 'not entered'
        : i.rulesCarriedForward
          ? 'last year’s'
          : i.rulesVerified
            ? 'verified'
            : 'not verified',
    basis: (i.status === 'rules_missing'
      ? 'missing'
      : i.rulesCarriedForward || !i.rulesVerified
        ? 'estimated'
        : 'recorded') as 'missing' | 'estimated' | 'recorded',
    note: 'a Setting (Tax rules)',
  };

  return {
    'tax.allowance': explain({
      id: 'tax.allowance',
      title: 'Free allowance',
      what: 'How much long-term gain each person can still book this financial year without paying tax, and how this plan uses it.',
      how:
        i.people.length === 0
          ? 'No fund holdings found yet.'
          : i.people
              .map(
                (p) =>
                  `${p.name}: allowance ${exInr(p.meter.allowance)} − used this year ${exInr(p.meter.used)} − this plan ${exInr(p.meter.plan)} = still free ${exInr(p.meter.free)}`,
              )
              .join('; ') + '.',
      inputs: [
        ruleInput,
        ...i.people.map((p) => ({
          label: `${p.name}: gains already booked this year`,
          value: exInr(p.meter.used),
          basis: 'statement' as const,
          from: `${i.fy.slice(0, 4)}-04-01`,
          to: i.today,
          note: 'long-term gains from the sales on fund statements, oldest units sold first',
        })),
      ],
      level: ruleLevel,
      completeness: `${ruleText} “Used” rests on the sales that are on fund statements; a sale not imported is not counted.`,
      notes: ['The allowance is the exemption in the tax rules, not a number fixed in the app.'],
      fix: { label: 'Open the tax rules in Settings', href: i.links.settings },
      also: [{ label: 'Import fund statements', href: i.links.import }],
    }),
    'tax.sell': explain({
      id: 'tax.sell',
      title: 'Funds to sell',
      exact: exInr(sum(sells.map((s) => s.gain))),
      what: 'The funds and units whose sale locks in gain inside the free allowance, with what they are worth and the gain.',
      how:
        sells.length === 0
          ? 'Nothing is ready to sell for this year’s allowance.'
          : `Oldest units are sold first: for each fund, units × the latest price = worth about (${exInr(sum(sells.map((s) => s.worth)))} in all); worth − the cost of those units = the gain locked in (${exInr(sum(sells.map((s) => s.gain)))} in all), kept within each person’s free allowance. You then put the sale amount back into the fund.`,
      inputs: [
        {
          label: 'Units from fund statements (exact)',
          value: String(sells.length - estSells),
          basis: 'statement',
          count: { n: sells.length - estSells, of: sells.length, noun: 'sells' },
        },
        {
          label: 'Units from estimated lots',
          value: String(estSells),
          basis: estSells > 0 ? 'estimated' : 'statement',
          count: { n: estSells, of: sells.length, noun: 'sells' },
        },
        ruleInput,
      ],
      level:
        sells.length === 0
          ? 'missing'
          : estSells === 0
            ? ruleLevel
            : estSells === sells.length
              ? 'estimated'
              : 'partly_estimated',
      completeness:
        sells.length === 0
          ? 'No sale is suggested.'
          : estSells > 0
            ? `${estSells} of ${exPlural(sells.length, 'suggestion')} rest on purchases estimated from the SIP plan, not read from a statement; the gain is only as good as that estimate.`
            : `Every suggestion is from purchases on a fund statement. ${ruleText}`,
      notes: ['Nothing is sold for you. Prices move, so check the gain on the day.'],
      fix: { label: 'Open the funds', href: i.links.investments },
    }),
    'tax.losses': explain({
      id: 'tax.losses',
      title: 'Losses you can book',
      exact: losses.length > 0 ? exInr(sum(losses.map((l) => l.loss))) : undefined,
      what: 'Funds held at a loss whose sale would book a loss that can be set off against gains.',
      how:
        losses.length === 0
          ? 'No fund is held at a loss that is worth booking.'
          : `For each fund: the cost of the oldest units − what they are worth = the loss (${exInr(sum(losses.map((l) => l.loss)))} in all: short-term ${exInr(sum(losses.map((l) => l.shortLoss)))}, long-term ${exInr(sum(losses.map((l) => l.longLoss)))}). It is set against gains in the order the tax rules set.`,
      inputs: [
        {
          label: 'Funds with a loss',
          value: String(losses.length),
          basis: losses.some((l) => l.estimated) ? 'estimated' : 'statement',
          count: { n: losses.length, noun: 'funds' },
        },
        ruleInput,
      ],
      level:
        losses.length === 0
          ? 'complete'
          : losses.some((l) => l.estimated)
            ? 'partly_estimated'
            : ruleLevel,
      completeness: losses.some((l) => l.estimated)
        ? 'Some losses rest on lots estimated from the SIP plan.'
        : ruleText,
      notes: ['A loss can be carried forward only if the return is filed on time.'],
    }),
    'tax.costs': explain({
      id: 'tax.costs',
      title: 'Costs to expect',
      exact: exInr(i.costs.total),
      what: 'What the suggested sales and re-purchases will cost: stamp duty, STT and any exit load.',
      how: `Stamp duty ${exInr(i.costs.stampDuty)} + securities transaction tax ${exInr(i.costs.stt)} + exit load ${exInr(i.costs.exitLoad)} = ${exInr(i.costs.total)}, from the rates in Settings applied to each sale and purchase.`,
      inputs: [
        {
          label: 'Rates for stamp duty, STT and exit load',
          value: 'from Settings',
          basis: 'recorded',
        },
      ],
      level: 'partly_estimated',
      completeness:
        'An estimate from the rates in Settings and the amounts planned; the fund house’s statement of the sale has the real charges.',
      notes: ['Nothing is sold for you.'],
      fix: { label: 'Open the tax rules in Settings', href: i.links.settings },
    }),
    'tax.refunds': explain({
      id: 'tax.refunds',
      title: 'Tax refunds to claim',
      exact: exInr(i.refunds.expectedRefund),
      what: 'For a non-resident, the tax withheld when funds are sold (and on NRO interest) that can be claimed back at filing.',
      how: `${exPlural(i.refunds.count, 'record')}: expected gain ${exInr(i.refunds.expectedGain)}, expected refund ${exInr(i.refunds.expectedRefund)}, received so far ${exInr(i.refunds.received)}. A refund is expected in full while each person’s taxable Indian income stays under ${exInr(i.refunds.incomeLimit)}.`,
      inputs: [
        {
          label: 'Expected refund',
          value: exInr(i.refunds.expectedRefund),
          basis: 'estimated',
          count: { n: i.refunds.count, noun: 'records' },
        },
        { label: 'Received', value: exInr(i.refunds.received), basis: 'recorded' },
        {
          label: 'Income limit',
          value: exInr(i.refunds.incomeLimit),
          basis: 'recorded',
          note: 'a Setting',
        },
      ],
      level: i.refunds.count === 0 ? 'missing' : 'estimated',
      completeness:
        i.refunds.count === 0
          ? 'Nothing to claim yet: a record appears when a harvest is planned.'
          : 'Expected amounts are planned figures. After you sell, enter what was actually withheld from the contract note.',
      notes: [
        'Over the income limit the refund depends on the tax actually due; none is expected until you check with an adviser.',
      ],
      fix: { label: 'Filing papers', href: i.links.filing },
    }),
    'tax.simulator': explain({
      id: 'tax.simulator',
      title: 'The tax simulator',
      what: 'What one sale would cost in tax, worked out from the units, prices and gains already booked that you type in.',
      how: 'For the units sold (oldest first): sale value − cost = gain, split short-term or long-term by each purchase date; gains already booked this year and losses carried forward are set off first; the allowance covers the long-term gain up to its limit; the rest is taxed at the rates for that financial year, plus cess, the exit load and (for a non-resident) the tax withheld.',
      inputs: [
        { label: 'Units, dates and costs', value: 'typed by you', basis: 'recorded' },
        { label: 'Price per unit', value: 'typed by you', basis: 'recorded' },
        ruleInput,
      ],
      level: 'partly_estimated',
      completeness:
        'It is only as exact as what you type; nothing is read from a statement here. The rates are the rules in Settings for the sale date’s financial year.',
      notes: ['This is not tax advice.'],
      fix: { label: 'Open the tax rules in Settings', href: i.links.settings },
    }),
  };
}

// ------------------------------------------------------------------------------------------------
// Monthly update
// ------------------------------------------------------------------------------------------------
export interface MonthlyExplainInput {
  today: string;
  month: string;
  summary: {
    banks: number;
    current: number;
    waiting: number;
    attention: number;
    balances: number;
    balancesCurrent: number;
    depositsToConfirm: number;
    newestUpdate: string | null;
  };
  freshnessDays: number;
  links: { inbox: string; accounts: string };
}

export function buildMonthlyExplain(i: MonthlyExplainInput): ExplainSet<'monthly'> {
  const s = i.summary;
  const days = i.freshnessDays;
  return {
    'monthly.status': explain({
      id: 'monthly.status',
      title: `Banks up to date for ${i.month}`,
      what: 'How many banks have all their balances recorded recently, and what still needs you.',
      how: `${s.current} of ${exPlural(s.banks, 'bank')} are up to date: every balance of the bank was recorded within ${exPlural(days, 'day')}. ${s.waiting} wait for a new balance and ${s.attention} need attention. ${exPlural(s.depositsToConfirm, 'matured deposit')} ${s.depositsToConfirm === 1 ? 'is' : 'are'} to confirm.`,
      inputs: [
        {
          label: 'Balances current',
          value: `${s.balancesCurrent} of ${s.balances}`,
          basis: 'recorded',
          to: s.newestUpdate,
          count: { n: s.balancesCurrent, of: s.balances, noun: 'balances' },
        },
        {
          label: 'Newest balance recorded',
          value: exDate(s.newestUpdate),
          basis: s.newestUpdate ? 'recorded' : 'missing',
          to: s.newestUpdate,
        },
        {
          label: 'Refresh window',
          value: `${days} days`,
          basis: 'recorded',
          note: 'a Setting (Estimates, freshness days)',
        },
      ],
      level: s.waiting + s.attention === 0 ? 'complete' : 'partly_estimated',
      completeness:
        s.waiting + s.attention === 0
          ? 'Every balance is inside its refresh window.'
          : `${s.waiting + s.attention} bank(s) have a balance older than ${exPlural(days, 'day')} or unconfirmed, so figures on the other pages move it forward by an estimate.`,
      notes: ['A balance imported from email stays unverified until you confirm it in the inbox.'],
      fix: { label: 'Bank email inbox', href: i.links.inbox },
    }),
    'monthly.freshness': explain({
      id: 'monthly.freshness',
      title: 'How current a balance is',
      what: 'The word beside each balance that says how old it is and whether anyone confirmed it.',
      how: `Current = recorded within ${exPlural(days, 'day')}. Older than expected = past that but within twice it (${exPlural(days * 2, 'day')}). Stale = older still. Imported, unverified = read from an email or file and not yet confirmed. Calculated = a deposit worked out from its terms. No value yet = nothing recorded.`,
      inputs: [
        { label: 'Refresh window', value: `${days} days`, basis: 'recorded', note: 'a Setting' },
        {
          label: 'Newest balance',
          value: exDate(i.summary.newestUpdate),
          basis: i.summary.newestUpdate ? 'recorded' : 'missing',
          to: i.summary.newestUpdate,
        },
      ],
      level: 'complete',
      completeness:
        'The words follow the dates and sources recorded with each balance; nothing is guessed.',
      notes: [],
    }),
  };
}

// ------------------------------------------------------------------------------------------------
// New money and Rates
// ------------------------------------------------------------------------------------------------
export interface NewMoneyExplainInput {
  today: string;
  offers: {
    count: number;
    newest: string | null;
    oldest: string | null;
    stale: number;
    staleDays: number;
  };
  limit: number;
  baselineRate: number;
  amount: number;
  kind: 'NRE' | 'NRO';
  pick: {
    title: string;
    totalAnnual: number;
    uplift: number;
    blendedNet: number;
    topShare: number;
    liquidNow: number;
    longestTerm: number;
    banks: number;
  } | null;
  suggestions: { count: number; totalGain: number };
  room: { names: number; over: number; outside: number };
  links: { rates: string; deposits: string };
}

export function buildNewMoneyExplain(i: NewMoneyExplainInput): ExplainSet<'newmoney'> {
  const o = i.offers;
  const ageLevel =
    o.count === 0
      ? ('missing' as const)
      : o.stale > 0
        ? ('partly_estimated' as const)
        : ('complete' as const);
  const ageNote =
    o.count === 0
      ? 'No rate is on file: add rates on the Rates page.'
      : o.stale > 0
        ? `${o.stale} of ${o.count} rates were checked more than ${o.staleDays} days ago; confirm them before acting.`
        : `All ${o.count} rates were checked within ${o.staleDays} days.`;
  const rateInput = {
    label: 'Rates on file',
    value: String(o.count),
    basis: 'statement' as const,
    from: o.oldest,
    to: o.newest,
    count: { n: o.count, noun: 'rates' },
    note: 'read from the banks’ pages or typed in',
  };
  const p = i.pick;
  return {
    'newmoney.options': explain({
      id: 'newmoney.options',
      title: p ? `Recommended: ${p.title}` : 'Five ways to place it',
      exact: p ? exInr(p.totalAnnual) : undefined,
      what: 'How a sum could be split over savings and fixed deposits, with the interest each way earns after tax.',
      how: p
        ? `For ${exInr(i.amount)} as ${i.kind}: each line is amount × rate (after tax for NRO) = interest a year; they add to ${exInr(p.totalAnnual)} a year, ${exSigned(p.uplift)} more than plain savings at ${exPct(i.baselineRate, 2)}. Average rate ${exPct(p.blendedNet, 2)}; the largest bank holds ${exPct(p.topShare, 0)} of it; ${exInr(p.liquidNow)} is free any time; the longest lock is ${p.longestTerm ? `${p.longestTerm} months` : 'none'}; ${exPlural(p.banks, 'bank')}.`
        : 'Type an amount to see the options.',
      inputs: [
        rateInput,
        {
          label: 'Deposit-insurance limit',
          value: exInr(i.limit),
          basis: 'recorded',
          note: 'a Setting; counted per person per bank',
        },
        {
          label: 'Plain-savings baseline',
          value: exPct(i.baselineRate, 2),
          basis: 'recorded',
          note: 'the assumed savings rate in Settings',
        },
      ],
      level: p ? ageLevel : 'missing',
      completeness: p ? ageNote : 'Missing: an amount.',
      notes: [
        'Rates move; the figure is for the rates on the dates shown, not a promise. NRE interest is not taxed in India; NRO interest is, at the rate in Settings.',
      ],
      fix: { label: 'See the rates', href: i.links.rates },
    }),
    'newmoney.better': explain({
      id: 'newmoney.better',
      title: 'Your money against the market',
      exact: i.suggestions.count > 0 ? exInr(i.suggestions.totalGain) : undefined,
      what: 'Holdings that earn clearly less than an offer elsewhere with insurance room, and the interest a year the move would add.',
      how:
        i.suggestions.count === 0
          ? 'No holding earns clearly less than a better offer that has insurance room.'
          : `For each holding: (best available rate after tax − its rate after tax) × its amount = the gain a year; ${exPlural(i.suggestions.count, 'suggestion')} add to ${exInr(i.suggestions.totalGain)} a year. A running deposit is never suggested to be broken early; moves are for maturity.`,
      inputs: [
        rateInput,
        {
          label: 'Deposit-insurance limit',
          value: exInr(i.limit),
          basis: 'recorded',
          note: 'a Setting',
        },
      ],
      level: ageLevel,
      completeness: ageNote,
      notes: ['Compared after tax: NRE interest is not taxed in India; NRO interest is.'],
      fix: { label: 'See the rates', href: i.links.rates },
    }),
    'newmoney.room': explain({
      id: 'newmoney.room',
      title: 'Insurance room',
      what: 'For each ownership name at each bank, how much sits there and how much of the deposit-insurance limit is left.',
      how: `Savings and deposits of a bank, with interest, added per ownership name; room = limit ${exInr(i.limit)} − that total. ${i.room.over} of ${exPlural(i.room.names, 'name')} are over the limit. A joint account counts under its names in the order written.${i.room.outside > 0 ? ` ${exPlural(i.room.outside, 'bank')} outside the scheme are listed apart as not covered.` : ''}`,
      inputs: [
        {
          label: 'Limit per bank and name',
          value: exInr(i.limit),
          basis: 'recorded',
          note: 'a Setting',
        },
        {
          label: 'Balances',
          value: `${i.room.names} names`,
          basis: 'estimated',
          to: i.today,
          note: 'last recorded balances moved forward by interest',
        },
      ],
      level: 'partly_estimated',
      completeness:
        'Balances are the last recorded ones moved forward at the account’s rate, so the totals are estimates.',
      notes: [],
      fix: { label: 'Open the cover check', href: i.links.deposits },
    }),
  };
}

export interface RatesExplainInput {
  today: string;
  offers: {
    count: number;
    newest: string | null;
    oldest: string | null;
    stale: number;
    staleDays: number;
  };
  unreadable: number;
  banks: number;
  links: { settings: string };
}

export function buildRatesExplain(i: RatesExplainInput): ExplainSet<'rates'> {
  const o = i.offers;
  const level =
    o.count === 0
      ? ('missing' as const)
      : o.stale > 0 || i.unreadable > 0
        ? ('partly_estimated' as const)
        : ('complete' as const);
  return {
    'rates.freshness': explain({
      id: 'rates.freshness',
      title: 'How fresh the rates are',
      what: 'How many rates are on file, when the newest was checked and how many are older than the limit.',
      how: `${exPlural(o.count, 'rate')} on file from ${exPlural(i.banks, 'bank')}; checked between ${exDate(o.oldest)} and ${exDate(o.newest)}. ${o.stale} ${o.stale === 1 ? 'is' : 'are'} older than ${exPlural(o.staleDays, 'day')} (a Setting).${i.unreadable > 0 ? ` ${exPlural(i.unreadable, 'bank page')} could not be read by the weekly refresh.` : ''}`,
      inputs: [
        {
          label: 'Rates on file',
          value: String(o.count),
          basis: 'statement',
          from: o.oldest,
          to: o.newest,
          count: { n: o.count, noun: 'rates' },
          note: 'read from the banks’ published pages, or typed in',
        },
        {
          label: 'Older than the limit',
          value: String(o.stale),
          basis: o.stale > 0 ? 'estimated' : 'statement',
          count: { n: o.stale, of: o.count, noun: 'rates' },
        },
        ...(i.unreadable > 0
          ? [
              {
                label: 'Bank pages not read',
                value: String(i.unreadable),
                basis: 'missing' as const,
              },
            ]
          : []),
      ],
      level,
      completeness:
        o.count === 0
          ? 'No rate is on file.'
          : level === 'complete'
            ? `Every rate was checked within ${exPlural(o.staleDays, 'day')}.`
            : 'Some rates are old or a bank page could not be read, so comparisons that use them may be out of date.',
      notes: [],
      fix: { label: 'Open Settings', href: i.links.settings },
    }),
    'rates.best': explain({
      id: 'rates.best',
      title: 'Best rate at each bank',
      what: 'The highest rate each bank offers for each kind of account and term, from the rates on file.',
      how: `For each bank, the rates on file (${exRangeText(o)}) are ranked and the highest is shown with the date it was checked. NRO rates are also shown after the tax in Settings.`,
      inputs: [
        {
          label: 'Rates on file',
          value: String(o.count),
          basis: 'statement',
          from: o.oldest,
          to: o.newest,
          count: { n: o.count, noun: 'rates' },
        },
      ],
      level,
      completeness:
        level === 'complete'
          ? 'All rates are recent.'
          : `${o.stale} rate(s) are older than ${exPlural(o.staleDays, 'day')}: confirm them on the bank’s own page before acting.`,
      notes: [
        'A rate from a bank’s page is the published rate; the rate you are given can differ with amount, term and customer.',
      ],
    }),
  };
}

const exRangeText = (o: { oldest: string | null; newest: string | null }) =>
  o.oldest && o.newest ? `checked ${exDate(o.oldest)} to ${exDate(o.newest)}` : 'no check date';
