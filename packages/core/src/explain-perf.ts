/**
 * The "?" explainers of the Investments Performance tab: the returns by period, profit and loss by period, the month grid, growth
 * of 100, drawdown, risk, rolling returns, the what-if against the index fund, the value-and-money-put-in change figures, the
 * monthly contributions and the pace projection. Pure: the page passes the performance object it already built plus a few dates
 * and counts; every figure is explained from that object, never recomputed.
 */
import {
  explain,
  exDate,
  exInr,
  exPct,
  exPlural,
  exRange,
  exSigned,
  exSignedPct,
  type Explain,
  type ExplainBasis,
  type ExplainInput,
  type ExplainLevel,
  type ExplainSet,
} from './explain';
import type { PortfolioPerformance } from './portfolio-performance';
import type { Hero } from './invest-overview';
import type { PeriodChange } from './fund-timeline';

export interface PerfExplainInput {
  performance: PortfolioPerformance;
  cfg: {
    annualiseAfterMonths: number;
    gapDays: number;
    riskFree: number;
    riskMonths: number;
    riskMinMonths: number;
    rollingMinWindows: number;
    plRows: number;
    weeksShown: number;
    contributionMonths: number;
  };
  /** the benchmark proxy, when its prices are loaded */
  benchmark: { name: string | null; from: string | null; to: string | null } | null;
  /** the profit-and-loss view: the kind of period, how many rows, the dates it spans and whether any bucket is estimated */
  pl: {
    kindLabel: string;
    rows: number;
    from: string | null;
    to: string | null;
    estimated: boolean;
    allEstimated: boolean;
    mode: string;
  };
  /** the year kind on the month grid */
  heat: 'financial' | 'calendar';
  growth: {
    rangeWords: string;
    change: PeriodChange | null;
    startsLate: boolean;
    statementFunds: number;
    totalFunds: number;
    contributionMonths: number;
    contributionTotal: number;
  };
  pace: {
    rate: number;
    assumed: boolean;
    spread: number;
    cap: number;
    years: { years: number; expected: number; low: number; high: number }[];
  };
}

export interface PerfContext {
  today: string;
  scope: string;
  hero: Hero;
  links: {
    dataCheck: string;
    import: string;
    match: string;
    performance: string;
    breakdown: string;
  };
  coverage: { total: number; unreconciled: number; noStatement: number; withStatement: number };
}

type PerfIds =
  | 'invest.returns'
  | 'invest.pl'
  | 'invest.monthGrid'
  | 'invest.growth100'
  | 'invest.drawdown'
  | 'invest.risk'
  | 'invest.rolling'
  | 'invest.whatIf'
  | 'invest.chgValue'
  | 'invest.chgChange'
  | 'invest.chgNewMoney'
  | 'invest.chgMarket'
  | 'invest.contrib'
  | 'invest.pace';

export type PerfExplainSet = Pick<ExplainSet<'investments'>, PerfIds>;

/** How much of the value rests on cash flows worked out from a start date and SIP, as a level and a sentence. */
function estimateState(p: PortfolioPerformance): {
  level: ExplainLevel;
  text: string;
  basis: ExplainBasis;
} {
  const share = p.estimatedShare;
  if (share <= 0)
    return {
      level: 'complete',
      text: 'Every fund’s cash flows are read from a fund statement.',
      basis: 'statement',
    };
  const pc = `${Math.round(share * 100)}%`;
  const since = p.estimatedSince
    ? ` Figures from ${exDate(p.estimatedSince)} onward rest on them.`
    : '';
  return {
    level: share >= 0.999 ? 'estimated' : 'partly_estimated',
    text: `${pc} of today’s value is in funds with no fund statement: their monthly money put in is worked out from the start date and SIP, so the figures that use it are estimated.${since}`,
    basis: 'estimated',
  };
}

const flowFix = (c: PerfContext) =>
  c.coverage.unreconciled > 0 || c.coverage.noStatement > 0
    ? { label: 'See which funds need a statement (data check)', href: c.links.dataCheck }
    : undefined;

export function buildPerfExplain(i: PerfExplainInput, c: PerfContext): PerfExplainSet {
  const p = i.performance;
  const prof = p.profile;
  const est = estimateState(p);
  const from = prof.from;
  const to = prof.to ?? c.today;
  const hasBench = !!i.benchmark && p.versus.some((x) => x.v.benchmark !== null);
  const inputsIndex: ExplainInput[] = [
    {
      label: 'Value of the funds on common dates',
      value: `${exRange(from, to)}`,
      basis: 'calculated' as const,
      from,
      to,
      note: 'month ends, the start of each period and today',
    },
    {
      label: 'Cash flows (money in and out)',
      value: exPlural(c.coverage.withStatement, 'fund') + ' from statements',
      basis: 'statement' as const,
      count: { n: c.coverage.withStatement, of: c.coverage.total, noun: 'funds' },
    },
    ...(c.coverage.noStatement > 0
      ? [
          {
            label: 'Cash flows worked out from start date and SIP',
            value: exPlural(c.coverage.noStatement, 'fund'),
            basis: 'estimated' as const,
            from: p.estimatedSince,
            to: c.today,
            count: { n: c.coverage.noStatement, of: c.coverage.total, noun: 'funds' },
          },
        ]
      : []),
  ];

  // ---- returns by period
  const rows = prof.trailing.filter((t) => t.r);
  const longest = rows[rows.length - 1];
  const returns = explain({
    id: 'invest.returns',
    title: 'Return over time',
    what: 'How the funds themselves did over each period, whatever the dates you put money in (a time-weighted return).',
    how: `For each period: the index value today ÷ the index value on the period’s first day − 1. The index chains the return between each pair of dates after taking money put in or out of the value, so adding money does not lift it. From a year it is turned into a rate per year (after ${i.cfg.annualiseAfterMonths} months); under that it is the plain change.${
      longest?.r
        ? ` For example ${longest.def.label}: ${exSignedPct(longest.r.absolute, 1)} from ${exDate(longest.r.from)} to ${exDate(longest.r.to)}.`
        : ''
    }`,
    inputs: [
      ...inputsIndex,
      ...(hasBench
        ? [
            {
              label: `Benchmark (proxy): ${i.benchmark!.name ?? 'index fund'}`,
              value: 'index fund price',
              basis: 'statement' as const,
              from: i.benchmark!.from,
              to: i.benchmark!.to,
            },
          ]
        : []),
      ...(rows.length < prof.trailing.length
        ? [
            {
              label: 'Periods the history does not reach',
              value: String(prof.trailing.length - rows.length),
              basis: 'missing' as const,
              note: 'shown as a dash',
            },
          ]
        : []),
    ],
    level: rows.length === 0 ? 'missing' : est.level,
    completeness: rows.length === 0 ? 'Missing: at least two dated values are needed.' : est.text,
    notes: [
      'This is not the annual return in the headline (XIRR), which depends on when you paid in; this table shows how the funds did.',
      hasBench
        ? 'The benchmark is the price of an index fund that follows the Nifty 50, a stand-in for the index itself; it carries the fund’s small costs.'
        : 'No benchmark is loaded yet; set the benchmark fund code in Settings and the daily job fetches its prices.',
      `A price older than ${i.cfg.gapDays} days is not used to start a period.`,
    ],
    fix: flowFix(c),
  });

  // ---- profit and loss by period
  const pl = explain({
    id: 'invest.pl',
    title: 'Profit and loss by period',
    what: `The rupees and per cent the funds made or lost in each ${i.pl.kindLabel}.`,
    how: `For each ${i.pl.kindLabel}: value at its end − value at its start − net money put in = profit (deposits are not profit and withdrawals are not a loss). The % is the time-weighted return of that period. ${i.pl.rows} periods are shown, from ${exDate(i.pl.from)} to ${exDate(i.pl.to)}; the running total adds the rupees.`,
    inputs: [
      ...inputsIndex,
      ...(i.pl.mode !== 'none'
        ? [
            {
              label: 'Comparison',
              value: i.pl.mode,
              basis: 'calculated' as const,
              note: 'each series is worked out the same way for that person or fund',
            },
          ]
        : []),
    ],
    level:
      i.pl.rows === 0
        ? 'missing'
        : i.pl.estimated
          ? i.pl.allEstimated
            ? 'estimated'
            : 'partly_estimated'
          : est.level === 'complete'
            ? 'complete'
            : est.level,
    completeness:
      i.pl.rows === 0
        ? 'Not enough history yet for this view.'
        : i.pl.estimated
          ? `${i.pl.allEstimated ? 'Every period' : 'Some periods'} include cash flows worked out from a start date and SIP. ${est.text}`
          : est.text,
    notes: [
      'The first and the current period may be partial; they are marked.',
      `Weekly rows show the last ${i.cfg.weeksShown} weeks.`,
    ],
    fix: flowFix(c),
  });

  // ---- month grid
  const monthGrid = explain({
    id: 'invest.monthGrid',
    title: 'Month by month',
    what: `The return of the funds in each calendar month, with the total for each ${i.heat === 'financial' ? 'financial year (April to March)' : 'calendar year'}.`,
    how: `Each cell: the last value of the month ÷ the last value of the month before − 1, on the time-weighted index (${exRange(from, to)}). The year total joins its months (1 + r₁) × (1 + r₂) … − 1. The first and the current month are partial and marked.`,
    inputs: inputsIndex,
    level: prof.months.length === 0 ? 'missing' : est.level,
    completeness: prof.months.length === 0 ? 'Missing: at least two months of values.' : est.text,
    notes: ['Best and worst only compare whole months and whole years.'],
    fix: flowFix(c),
  });

  // ---- growth of 100
  const growth100 = explain({
    id: 'invest.growth100',
    title: 'Growth of 100',
    what: `What 100 rupees put in on ${exDate(from)} would be worth now, following the funds${hasBench ? ' and following the benchmark' : ''}.`,
    how: `The time-weighted index starts at 100 on ${exDate(from)} and is multiplied by each period’s return (value moves only, money added or taken out is removed). It is 100 × (1 + the return since ${exDate(from)}). ${hasBench ? 'The benchmark line is its price rebased to 100 on the same day.' : ''}`,
    inputs: inputsIndex,
    level: p.index.length < 2 ? 'missing' : est.level,
    completeness:
      p.index.length < 2 ? 'The line appears once there are two months of history.' : est.text,
    notes: [hasBench ? 'The benchmark is a proxy, not the index.' : 'No benchmark is loaded yet.'],
    fix: flowFix(c),
  });

  // ---- drawdown
  const dd = prof.drawdown;
  const drawdown = explain({
    id: 'invest.drawdown',
    title: 'Fall from the highest point',
    what: 'How far below its previous highest value the funds’ index is, now and at its worst.',
    how: dd.max
      ? `At each date: index ÷ the highest index so far − 1. The deepest fall was ${exPct(Math.abs(dd.max.depth), 1)} from the high of ${exDate(dd.max.peakOn)} to the low of ${exDate(dd.max.troughOn)}${dd.max.recoveredOn ? `, regained on ${exDate(dd.max.recoveredOn)}` : ', not yet regained'}. Now: ${dd.current ? `${exPct(Math.abs(dd.current.depth), 1)} below the high of ${exDate(dd.current.peakOn)}` : '–'}.`
      : 'No fall below a previous high yet, or too little history.',
    inputs: inputsIndex,
    level: dd.points.length === 0 ? 'missing' : est.level,
    completeness: dd.points.length === 0 ? 'Missing: at least two values.' : est.text,
    notes: ['It uses the time-weighted index, so money you put in during a fall does not hide it.'],
    fix: flowFix(c),
  });

  // ---- risk
  const rk = prof.risk;
  const risk = explain({
    id: 'invest.risk',
    title: 'Risk',
    what: 'How bumpy the monthly returns have been (volatility) and the return for the risk taken (Sharpe and Sortino).',
    how: rk
      ? `Over the last ${rk.months} whole months: volatility = spread (sample standard deviation) of monthly returns × √12 = ${exPct(rk.volatility ?? 0, 1)} a year; Sharpe = (return ${exPct(rk.annualReturn, 1)} − risk-free ${exPct(rk.riskFree, 1)}) ÷ volatility = ${rk.sharpe === null ? '–' : rk.sharpe.toFixed(2)}; Sortino uses only the shortfall below the risk-free rate = ${rk.sortino === null ? '–' : rk.sortino.toFixed(2)}.`
      : `Not worked out: it needs at least ${i.cfg.riskMinMonths} whole months of returns.`,
    inputs: [
      ...inputsIndex,
      {
        label: 'Risk-free rate used',
        value: exPct(i.cfg.riskFree, 1),
        basis: 'recorded',
        note: 'an assumption set in Settings',
      },
      {
        label: 'Months used',
        value: rk ? String(rk.months) : '0',
        basis: rk ? 'calculated' : 'missing',
        note: `at most the last ${i.cfg.riskMonths}`,
      },
    ],
    level: rk ? est.level : 'missing',
    completeness: rk
      ? est.text
      : `Missing: fewer than ${i.cfg.riskMinMonths} whole months of history.`,
    notes: ['A short history says little about risk; treat these as a rough guide.'],
    fix: flowFix(c),
  });

  // ---- rolling
  const roll = prof.rolling.find((r) => r.windows > 0) ?? prof.rolling[0];
  const rolling = explain({
    id: 'invest.rolling',
    title: 'Rolling returns',
    what: 'What any holding period of a set length would have earned, whichever month you started.',
    how:
      roll && roll.windows > 0
        ? `For every window of ${roll.windowMonths} months ending at a month end: index then ÷ index at the start − 1 (as a rate per year from a year). ${roll.windows} windows${roll.median !== null ? `: median ${exPct(roll.median, 1)}, best ${roll.max ? exPct(roll.max.ret, 1) : '–'}, worst ${roll.min ? exPct(roll.min.ret, 1) : '–'}, ${roll.positiveShare === null ? '–' : exPct(roll.positiveShare, 0)} of windows ended above zero` : ''}.`
        : 'Not worked out: the history is shorter than the shortest window.',
    inputs: [
      ...inputsIndex,
      ...prof.rolling.map((r) => ({
        label: `${r.windowMonths / 12 >= 1 ? `${r.windowMonths / 12} year` : `${r.windowMonths} month`} windows`,
        value: String(r.windows),
        basis: (r.windows >= i.cfg.rollingMinWindows ? 'calculated' : 'missing') as ExplainBasis,
        note:
          r.windows >= i.cfg.rollingMinWindows
            ? undefined
            : `fewer than ${i.cfg.rollingMinWindows} windows, so no summary`,
      })),
    ],
    level: roll && roll.windows > 0 ? est.level : 'missing',
    completeness:
      roll && roll.windows > 0
        ? est.text
        : 'Missing: not enough months of history for even the shortest window.',
    notes: ['Windows overlap, so they are not independent observations.'],
    fix: flowFix(c),
  });

  // ---- what-if
  const w = p.whatIf;
  const whatIf = w
    ? explain({
        id: 'invest.whatIf',
        title: 'The same money in the index fund',
        what: 'What your same payments, on the same days, would be worth if each had gone into the index fund instead.',
        how: `Every purchase is put into ${i.benchmark?.name ?? 'the index fund'} at that day’s price and every sale taken out; what is left is valued at the latest price: ${exInr(w.value)} against ${exInr(c.hero.value)} in your funds. Net money in ${exInr(w.netIn)}; gain ${exSigned(w.gain)}${w.xirr !== null ? `; the index fund’s annual return on those flows ${exSignedPct(w.xirr, 1)}` : ''}.`,
        inputs: [
          {
            label: 'Your payments in and out',
            value: exInr(w.netIn),
            basis: est.basis,
            from,
            to: c.today,
          },
          {
            label: 'Index fund price (proxy)',
            value: i.benchmark?.name ?? 'index fund',
            basis: 'statement',
            from: i.benchmark?.from,
            to: i.benchmark?.to,
          },
          ...(w.skipped > 0
            ? [
                {
                  label: 'Payments before the index fund’s first price (left out)',
                  value: String(w.skipped),
                  basis: 'missing' as const,
                  note: `${Math.round(w.coverage * 100)}% of the money put in is covered`,
                },
              ]
            : []),
        ],
        level: w.skipped > 0 ? 'partly_estimated' : est.level,
        completeness:
          w.skipped > 0
            ? `${w.skipped} payments are earlier than the benchmark’s history and are left out; ${Math.round(w.coverage * 100)}% of the money is covered. ${est.text}`
            : est.text,
        notes: ['It ignores tax, exit loads and the fund’s own small costs.'],
        fix: flowFix(c),
      })
    : explain({
        id: 'invest.whatIf',
        title: 'The same money in the index fund',
        what: 'What your same payments would be worth in the index fund.',
        how: 'Not worked out: the index fund’s prices are not loaded, or there are no payments.',
        inputs: [{ label: 'Benchmark prices', value: 'not loaded', basis: 'missing' }],
        level: 'missing',
        completeness:
          'Missing: set the benchmark fund code in Settings; the daily job fetches its prices.',
      });

  // ---- value change over the chosen range
  const ch = i.growth.change;
  const chInputs = (what: string): ExplainInput[] => [
    {
      label: what,
      value: ch ? `${exRange(ch.from, ch.to)}` : '–',
      basis: (ch ? 'calculated' : 'missing') as ExplainBasis,
      from: ch?.from,
      to: ch?.to,
    },
    {
      label: 'Funds with a statement',
      value: `${i.growth.statementFunds} of ${i.growth.totalFunds}`,
      basis: 'statement' as const,
      count: { n: i.growth.statementFunds, of: i.growth.totalFunds, noun: 'funds' },
    },
  ];
  const growthLevel: ExplainLevel =
    i.growth.statementFunds === i.growth.totalFunds
      ? 'complete'
      : i.growth.statementFunds === 0
        ? 'estimated'
        : 'partly_estimated';
  const growthText = `${i.growth.statementFunds} of ${exPlural(i.growth.totalFunds, 'fund')} have a fund statement; the rest follow the values you recorded.${i.growth.startsLate ? ' History starts later than this range.' : ''}`;
  const chgValue = explain({
    id: 'invest.chgValue',
    title: 'Value now',
    exact: exInr(c.hero.value),
    what: 'What all the funds shown are worth today.',
    how: `Units × latest price for each fund, added = ${exInr(c.hero.value)} as of ${exDate(c.today)}. See the headline value for the price dates.`,
    inputs: [
      {
        label: 'Current value',
        value: exInr(c.hero.value),
        basis: 'calculated',
        to: c.today,
        count: { n: c.coverage.total, noun: 'funds' },
      },
    ],
    level: c.coverage.unreconciled > 0 ? 'partly_estimated' : 'complete',
    completeness:
      c.coverage.unreconciled > 0
        ? `${c.coverage.unreconciled} of ${exPlural(c.coverage.total, 'fund')} have a history that does not add up, so their units may be off.`
        : 'Every fund’s history adds up.',
    notes: [],
    fix: flowFix(c),
  });
  const chgChange = explain({
    id: 'invest.chgChange',
    title: `Change in ${i.growth.rangeWords}`,
    exact: ch ? exSigned(ch.endValue - ch.startValue) : undefined,
    what: 'How much the value of the funds changed over the range chosen, including money put in and taken out.',
    how: ch
      ? `Value on ${exDate(ch.to)} ${exInr(ch.endValue)} − value on ${exDate(ch.from)} ${exInr(ch.startValue)} = ${exSigned(ch.endValue - ch.startValue)}. This change includes new money, so it is not the profit.`
      : 'Not worked out: two dated values are needed.',
    inputs: chInputs('Start and end values'),
    level: ch ? growthLevel : 'missing',
    completeness: ch ? growthText : 'Missing: two dated values.',
    notes: ['“Made by the market” removes the new money from this change.'],
  });
  const chgNew = explain({
    id: 'invest.chgNewMoney',
    title: 'New money put in',
    exact: ch !== null && ch.netIn !== null ? exSigned(ch.netIn) : undefined,
    what: 'Purchases less sales over the range: the part of the change that is money, not performance.',
    how:
      ch !== null && ch.netIn !== null
        ? `Cost of the units held on ${exDate(ch.to)} − cost of the units held on ${exDate(ch.from)} = ${exSigned(ch.netIn)} (purchases less sales).`
        : 'Not worked out: the cost of the units at the start is not recorded.',
    inputs: chInputs('Cost of units held at each end'),
    level: ch !== null && ch.netIn !== null ? growthLevel : 'missing',
    completeness:
      ch !== null && ch.netIn !== null
        ? growthText
        : 'Missing: cost not recorded for the start of the range.',
    notes: ['Switches between your own funds count as money out of one and in to the other.'],
  });
  const chgMarket = explain({
    id: 'invest.chgMarket',
    title: 'Made by the market',
    exact: ch !== null && ch.gain !== null ? exSigned(ch.gain) : undefined,
    what: 'The change in value that is not new money: what the market added or took away.',
    how:
      ch !== null && ch.gain !== null
        ? `Change in value ${exSigned(ch.endValue - ch.startValue)} − new money ${exSigned(ch.netIn ?? 0)} = ${exSigned(ch.gain)}.${ch.returnPct !== null ? ` As a share of the average money at work: ${exSigned(ch.gain)} ÷ (start value ${exInr(ch.startValue)} + half the new money ${exInr((ch.netIn ?? 0) / 2)}) = ${exSignedPct(ch.returnPct, 1)}.` : ''}`
        : 'Not worked out: it needs the cost of the units at both ends.',
    inputs: chInputs('Values and cost at each end'),
    level: ch !== null && ch.gain !== null ? growthLevel : 'missing',
    completeness:
      ch !== null && ch.gain !== null
        ? growthText
        : 'Missing: cost not recorded for the start of the range.',
    notes: [
      'The percentage counts new money at half weight (it was at work for about half the range on average); it is not an annual rate.',
    ],
  });

  // ---- contributions
  const contrib = explain({
    id: 'invest.contrib',
    title: 'Money put in each month',
    what: `Money put into funds in each of the last ${i.cfg.contributionMonths} months, split into monthly instalments, one-off purchases and units moved in.`,
    how: `Each column adds that month’s purchase lines on the statements: SIP instalments + one-off purchases + units moved in or bought with a dividend. Total over the months shown: ${exInr(i.growth.contributionTotal)}.`,
    inputs: [
      {
        label: 'Purchase lines on statements',
        value: exInr(i.growth.contributionTotal),
        basis: i.growth.statementFunds > 0 ? 'statement' : 'missing',
        count: {
          n: i.growth.statementFunds,
          of: i.growth.totalFunds,
          noun: 'funds with a statement',
        },
      },
    ],
    level:
      i.growth.statementFunds === 0
        ? 'missing'
        : i.growth.statementFunds < i.growth.totalFunds
          ? 'partly_estimated'
          : 'complete',
    completeness:
      i.growth.statementFunds === 0
        ? 'Missing: month-by-month purchases come from fund statements; none is imported.'
        : i.growth.statementFunds < i.growth.totalFunds
          ? `Only ${i.growth.statementFunds} of ${i.growth.totalFunds} funds have statements, so the columns are lower than what really went in.`
          : 'Every fund’s purchases are on a statement.',
    notes: [],
    fix:
      i.growth.statementFunds < i.growth.totalFunds
        ? { label: 'Import a fund statement', href: c.links.import }
        : undefined,
  });

  // ---- pace
  const pace = explain({
    id: 'invest.pace',
    title: 'If you carry on like this',
    what: 'What today’s value and SIPs would grow to if the same yearly return carried on. A projection, not a promise.',
    how:
      i.pace.years.length > 0
        ? `Today’s value ${exInr(c.hero.value)} grown at ${(i.pace.rate * 100).toFixed(1)}% a year with ${exInr(c.hero.sipMonthly)} added each month gives ${i.pace.years.map((y) => `${exInr(y.expected)} in ${y.years} year${y.years === 1 ? '' : 's'} (range ${exInr(y.low)} to ${exInr(y.high)})`).join(', ')}.`
        : 'No projection yet.',
    inputs: [
      {
        label: 'Yearly return used',
        value: `${(i.pace.rate * 100).toFixed(1)}%`,
        basis: i.pace.assumed ? 'estimated' : 'calculated',
        note: i.pace.assumed
          ? 'assumed: no annual return can be worked out yet'
          : `your annual return so far, between 0% and the ${(i.pace.cap * 100).toFixed(0)}% cap`,
      },
      { label: 'Today’s value', value: exInr(c.hero.value), basis: 'calculated', to: c.today },
      { label: 'SIP a month', value: exInr(c.hero.sipMonthly), basis: 'recorded' },
    ],
    level: i.pace.assumed ? 'estimated' : 'partly_estimated',
    completeness: i.pace.assumed
      ? 'Estimated: the return is assumed.'
      : 'Partly estimated: the value is calculated; the return is your past return carried forward.',
    notes: [
      `The range is ± ${(i.pace.spread * 100).toFixed(0)} points of return. The cap on the assumed return and the spread are saved settings.`,
    ],
  });

  return {
    'invest.returns': returns,
    'invest.pl': pl,
    'invest.monthGrid': monthGrid,
    'invest.growth100': growth100,
    'invest.drawdown': drawdown,
    'invest.risk': risk,
    'invest.rolling': rolling,
    'invest.whatIf': whatIf,
    'invest.chgValue': chgValue,
    'invest.chgChange': chgChange,
    'invest.chgNewMoney': chgNew,
    'invest.chgMarket': chgMarket,
    'invest.contrib': contrib,
    'invest.pace': pace,
  };
}

export type { Explain };
