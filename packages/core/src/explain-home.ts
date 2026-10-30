/**
 * The "?" explainers of Home: the net worth and how it changed, the money tiles, how much is verified, the four kinds of holding,
 * the profit by period, the trend, where the money is and how fast it can be reached. Pure: Home's own model (HomeModel in the web
 * app) is passed in as plain values; every number quoted is one Home already shows, taken from the same functions the other pages use.
 */
import type { CapitalLedger, WealthMovement } from './capital';
import {
  explain,
  exDate,
  exInr,
  exPct,
  exPlural,
  exSigned,
  exSignedPct,
  levelOfShare,
  ratioHow,
  type Explain,
  type ExplainInput,
  type ExplainLevel,
  type ExplainSet,
} from './explain';
import type { BankOverview } from './bank-overview';
import { maturedRuleText } from './deposit-state';
import { foreignExplain } from './foreign-cash';
import type { FreshnessSummary } from './dashboard';
import type {
  AllocShare,
  ClassCard,
  DepositInterest,
  GrowthSplit,
  HomeExtras,
  HomeGrowth,
  HomeRange,
  RangeView,
  ValueTrust,
} from './home';
import { TERMS } from './terms';
import type { GainPeriodKey, PeriodGains } from './period-gains';
import type { HeadlineTile } from './position';
import { formatInrCompact } from './money';

export interface HomeExplainInput {
  today: string;
  /** How is my money growing? and the extras under the headline */
  growth: HomeGrowth;
  extras: HomeExtras;
  total: number;
  money: {
    invested: number;
    current: number;
    maturity: number;
    profit: number;
    profitPct: number | null;
    valueOfInvested: number;
    parts: {
      fd: { invested: number; current: number; profit: number };
      funds: { invested: number; current: number; profit: number };
      notInvested: number;
    };
    estimated: boolean;
  };
  classes: ClassCard[];
  /** own money, profit and the movement of the chosen period (capital.ts) */
  capital?: {
    totals: CapitalLedger['totals'];
    opening: CapitalLedger['opening'];
    limitations: string[];
    movement: WealthMovement;
  };
  periods: PeriodGains;
  assumptions: { savingsRate: number; tdsRate: number };
  counted: number;
  people: number;
  asOf: string | null;
  change: {
    today: { amount: number; pct: number | null; banks: number; funds: number };
    monthDays: number;
    fyStart: string;
  };
  /** what was earned in each period, with where it begins and what it rests on (position.ts) */
  tiles: Record<GainPeriodKey, HeadlineTile>;
  /** the first day anything can be worked out for */
  dataStarts: string | null;
  trust: ValueTrust;
  trustDetail: {
    fresh: FreshnessSummary;
    assumptions: number;
    byBasis: { calculated: number; estimated: number; carried_forward: number };
    statements: { withStatement: number; total: number } | null;
  };
  allocation: AllocShare[];
  trend: {
    range: HomeRange;
    view: RangeView;
    pace: { monthlyChange: number; annualGrowth: number | null; months: number } | null;
    growth: GrowthSplit;
    history: number;
    rebuilt: number;
    missingMonths: number;
  };
  whatChanged: { since: string; partial: boolean; change: number } | null;
  liquidity: {
    ladderTotal: number;
    within30: number;
    raise: { days: number; date: string; free: number; most: number }[];
    cashAndDeposits: number;
    months: number | null;
    monthlySpending: number;
  };
  attention: { tone: string }[];
  openTasks: number;
  banks: { overview: BankOverview; topShare: number | null; maturedNotCounted: number };
  deposits: {
    overview: BankOverview;
    interest: DepositInterest;
    cover: { limit: number; uninsured: number; banksOver: number };
  };
  funds: {
    value: number;
    invested: number;
    gain: number;
    xirr: number | null;
    xirrEstimated: boolean;
    funds: number;
    withStatement: number;
  } | null;
  goals: { onTrack: number; withTarget: number; count: number };
  risks: number;
  /** the window "Free within N days" uses */
  freeDays: number;
  links: {
    accounts: string;
    deposits: string;
    cash: string;
    investments: string;
    monthly: string;
    raise: string;
    goals: string;
    settings: string;
    maturities: string;
    cover: string;
    import: string;
  };
}

const COUNT = (n: number, noun: string) => ({ n, noun });

function estShare(i: HomeExplainInput): ExplainLevel {
  const b = i.trustDetail.byBasis;
  return levelOfShare(b.estimated + b.carried_forward, i.total || 1);
}

function netWorth(i: HomeExplainInput): Explain {
  const b = i.trustDetail.byBasis;
  const f = i.trustDetail.fresh;
  return explain({
    id: 'home.netWorth',
    title: TERMS.netWorth.label,
    exact: exInr(i.total),
    shown: formatInrCompact(i.total),
    what: `${TERMS.netWorth.hint} Insurance cover is never counted.`,
    how: `Each of ${exPlural(i.counted, 'holding')} of ${exPlural(i.people, 'person', 'people')} at its latest recorded value moved forward to today: ${i.allocation.map((a) => `${a.label} ${exInr(a.amount)}`).join(' + ')} = ${exInr(i.total)}.`,
    inputs: [
      {
        label: 'Calculated from contracts or units (deposits, units × price)',
        value: exInr(b.calculated),
        basis: 'calculated',
        to: i.today,
      },
      {
        label: 'Estimated: interest or price moved on from the last record',
        value: exInr(b.estimated),
        basis: 'estimated',
        to: i.today,
      },
      {
        label: 'Carried forward: the last entry repeated',
        value: exInr(b.carried_forward),
        basis: 'recorded',
        to: i.asOf,
      },
      {
        label: 'Latest recorded value',
        value: exDate(i.asOf),
        basis: i.asOf ? 'recorded' : 'missing',
        to: i.asOf,
        note: f.oldestDays !== null ? `the oldest value is ${f.oldestDays} days old` : undefined,
      },
    ],
    level: estShare(i),
    completeness: `${exInr(b.calculated)} is calculated, ${exInr(b.estimated)} is estimated and ${exInr(b.carried_forward)} is carried forward from the last entry${i.trustDetail.assumptions > 0 ? `; ${exPlural(i.trustDetail.assumptions, 'account')} use an assumed savings rate` : ''}. ${f.fresh} of ${exPlural(f.total, 'holding')} are recorded within their refresh window.`,
    notes: [
      ...(i.extras.notCounted.count > 0
        ? [
            `${exPlural(i.extras.notCounted.count, 'property', 'properties')} worth ${exInr(i.extras.notCounted.amount)} ${i.extras.notCounted.count === 1 ? 'is' : 'are'} shown on its own page but not counted (Settings > Count property in net worth).`,
          ]
        : []),
      maturedRuleText(),
      'Every kind below adds up to this figure, so nothing is counted twice.',
    ],
    fix: { label: 'Update balances', href: i.links.monthly },
  });
}

/** The "?" of own money, profit so far, the yearly return and the movement panel, from the capital ledger (capital.ts). */
function capitalExplains(
  i: HomeExplainInput,
): Record<'home.ownMoney' | 'home.profitSoFar' | 'home.xirr' | 'home.movement', Explain> {
  const c = i.capital;
  const t = c?.totals;
  const o = c?.opening ?? null;
  const none = (id: string, title: string): Explain =>
    explain({
      id,
      title,
      exact: '–',
      what: 'Shows once balances or deposits are recorded.',
      how: 'Nothing is on file to measure from yet.',
      inputs: [],
      level: 'missing',
      completeness: 'Nothing recorded yet.',
      notes: [],
    });
  if (!c || !t || !o)
    return {
      'home.ownMoney': none('home.ownMoney', 'Own money'),
      'home.profitSoFar': none('home.profitSoFar', 'Lifetime profit'),
      'home.xirr': none('home.xirr', TERMS.xirrOwn.label),
      'home.movement': none('home.movement', 'Wealth movement'),
    };
  const unexplainedShare = t.ownMoney > 0 ? Math.abs(t.unexplained) / t.ownMoney : 0;
  const level = unexplainedShare > 0.2 ? 'partly_estimated' : 'complete';
  const mv = c.movement;
  const f = mv.figures;
  return {
    'home.ownMoney': explain({
      id: 'home.ownMoney',
      title: TERMS.ownMoney.label,
      exact: exInr(t.ownMoney),
      what: 'The family’s own money in what it holds: the opening position plus money that came in from outside its accounts, less money withdrawn. Interest, profit, renewals, reinvestment and transfers between your own accounts never change it.',
      how: `Opening position ${exInr(t.opening)} on ${exDate(o.date)} + outside money you confirmed ${exSigned(t.confirmedExternal)} + money moved in or out with nothing to say what it was ${exSigned(t.unexplained)} = ${exInr(t.ownMoney)}.`,
      inputs: [
        {
          label: `Opening position (${exDate(o.date)})`,
          value: exInr(t.opening),
          basis: 'calculated',
          to: o.date,
        },
        {
          label: 'Outside money, confirmed',
          value: exSigned(t.confirmedExternal),
          basis: 'recorded',
        },
        {
          label: 'Not yet explained (worked out from balances)',
          value: exSigned(t.unexplained),
          basis: 'estimated',
          note: 'assumed to be your own money until you say what it was',
        },
      ],
      level,
      completeness:
        level === 'complete'
          ? 'Most of the money moved is confirmed or small.'
          : 'Much of the money moved is worked out from balances, not confirmed: confirm salary, gifts and money withdrawn on Explain movements.',
      notes: c.limitations,
    }),
    'home.profitSoFar': explain({
      id: 'home.profitSoFar',
      title: TERMS.lifetimeProfit.label,
      exact: exSigned(t.profit),
      what: 'Net worth less own money: interest on savings and deposits, fund profit, exchange-rate moves and income, less fees and taxes, since the opening date.',
      how: `Net worth ${exInr(t.netWorth)} − own money ${exInr(t.ownMoney)} = ${exSigned(t.profit)}${t.profitPct === null ? '' : `; ÷ own money = ${exPct(t.profitPct, 1)}`}. By kind: savings interest ${exSigned(t.earnings.savings)}, deposit interest ${exSigned(t.earnings.deposits)}, funds ${exSigned(t.earnings.funds)}, exchange rates ${exSigned(t.earnings.fx)}, other ${exSigned(t.earnings.others + t.earnings.income)}.`,
      inputs: [
        { label: 'Net worth', value: exInr(t.netWorth), basis: 'estimated', to: i.today },
        {
          label: 'Own money',
          value: exInr(t.ownMoney),
          basis: 'calculated',
          from: o.date,
          to: i.today,
        },
        { label: 'Interest on savings', value: exSigned(t.earnings.savings), basis: 'estimated' },
        {
          label: 'Interest on deposits',
          value: exSigned(t.earnings.deposits),
          basis: 'calculated',
        },
        { label: 'Fund profit and loss', value: exSigned(t.earnings.funds), basis: 'estimated' },
        { label: 'Exchange-rate moves', value: exSigned(t.earnings.fx), basis: 'calculated' },
      ],
      level,
      completeness: 'Money moved with nothing to say what it was is never counted as profit.',
      notes: ['The per cent is of own money; it is not shown when own money is zero or less.'],
    }),
    'home.xirr': explain({
      id: 'home.xirr',
      title: TERMS.xirrOwn.label,
      exact: t.xirr.rate === null ? '–' : exPct(t.xirr.rate, 2),
      what: 'The yearly rate that turns the opening position and every dated sum of outside money into today’s net worth: a money-weighted return.',
      how: `Flows: −${exInr(t.opening)} on ${exDate(o.date)}, each sum of outside money on its date (a sum worked out from balances in the middle of its month), +${exInr(t.netWorth)} today. ${t.xirr.rate === null ? t.xirr.message : `Solved: ${exPct(t.xirr.rate, 2)} a year.`}`,
      inputs: [
        { label: 'Opening position', value: exInr(t.opening), basis: 'calculated', to: o.date },
        { label: 'Net worth', value: exInr(t.netWorth), basis: 'estimated', to: i.today },
      ],
      level: t.xirr.rate === null ? 'missing' : level,
      completeness:
        t.twr.total === null
          ? 'No time-weighted figure.'
          : `Time-weighted over the same time: ${exPct(t.twr.total, 1)}${t.twr.annualised === null ? '' : ` (${exPct(t.twr.annualised, 1)} a year)`}.`,
      notes: [
        'Transfers between your own accounts, renewals and reinvested interest are not flows.',
      ],
    }),
    'home.movement': explain({
      id: 'home.movement',
      title: `Wealth movement: ${mv.label}`,
      exact: f ? exSigned(f.end - f.start) : '–',
      what: 'How net worth moved over the period: outside money (confirmed, and worked out from balances) apart from what was earned.',
      how: f
        ? `${exInr(f.end)} at the end − ${exInr(f.start)} at the start = ${exSigned(f.end - f.start)} = outside money ${exSigned(f.confirmedExternal)} + not yet explained ${exSigned(f.unexplained)}${Math.abs(f.corrections) >= 1 ? ` + corrections ${exSigned(f.corrections)}` : ''} + earned ${exSigned(f.earnings.total)}.`
        : 'Nothing recorded in the period.',
      inputs: f
        ? [
            {
              label: 'Net worth at the start',
              value: exInr(f.start),
              basis: 'estimated',
              to: f.from,
            },
            {
              label: 'Net worth at the end',
              value: exInr(f.end),
              basis: 'estimated',
              to: f.through,
            },
            {
              label: 'Interest on savings',
              value: exSigned(f.earnings.savings),
              basis: 'estimated',
            },
            {
              label: 'Interest on deposits',
              value: exSigned(f.earnings.deposits),
              basis: 'calculated',
            },
            {
              label: 'Fund profit and loss',
              value: exSigned(f.earnings.funds),
              basis: 'estimated',
            },
          ]
        : [],
      level: f?.estimated ? 'partly_estimated' : 'complete',
      completeness: mv.clamped
        ? `The records start on ${exDate(mv.from)}: the period begins there.`
        : 'Whole calendar months, the last to today.',
      notes: [],
    }),
  };
}

function verified(i: HomeExplainInput): Explain {
  const t = i.trust;
  return explain({
    id: 'home.verified',
    title: 'How much is verified',
    exact: exPct(t.verifiedShare, 1),
    what: 'The share of net worth that is confirmed recently or worked out from a contract.',
    how: `(Confirmed recently ${exInr(t.confirmed)} + worked out from deposit terms ${exInr(t.calculated)}) ÷ total ${exInr(t.total)} = ${exPct(t.verifiedShare, 0)}. The rest, ${exInr(t.unconfirmed)}, is older, unconfirmed or has no value.`,
    inputs: [
      {
        label: 'Confirmed recently',
        value: exInr(t.confirmed),
        basis: 'recorded',
        count: COUNT(t.counts.confirmed, 'holdings'),
      },
      {
        label: 'Worked out from deposit terms',
        value: exInr(t.calculated),
        basis: 'calculated',
        count: COUNT(t.counts.calculated, 'deposits'),
      },
      {
        label: 'Older than the window, unconfirmed or no value',
        value: exInr(t.unconfirmed),
        basis: 'estimated',
        count: COUNT(t.counts.unconfirmed, 'holdings'),
      },
    ],
    level: levelOfShare(t.unconfirmed > 0 ? t.unconfirmed : 0, t.total || 1),
    completeness: `${exPct(1 - t.verifiedShare, 0)} of net worth rests on values older than their refresh window or not yet confirmed. Estimated SIP lines are never treated as statement-backed.`,
    notes: ['It adds to the same total as net worth because the same holdings are counted.'],
    fix: { label: 'Update balances', href: i.links.monthly },
  });
}

function classCard(key: ClassCard['key'], id: string, i: HomeExplainInput): Explain {
  const c = i.classes.find((x) => x.key === key)!;
  const how: Record<ClassCard['key'], string> = {
    fd: `Invested ${exInr(c.invested)} is the principal of each deposit; current ${exInr(c.current)} is what each has grown to today on its own rate and terms; maturity ${exInr(c.maturity)} is what they pay on their dates.`,
    funds: `Invested ${exInr(c.invested)} is the cost of the units still held (as Investments shows it); current ${exInr(c.current)} is units × the latest price, with SIP instalments assumed since the last statement marked est.`,
    cash: `Invested ${exInr(c.invested)} is the last balance recorded for each account; current ${exInr(c.current)} adds interest estimated since at the account’s rate, less ${exPct(i.assumptions.tdsRate, 0)} tax at source. The profit is that interest.`,
    others: `Invested ${exInr(c.invested)} is the amount recorded; current ${exInr(c.current)} is what is counted today. Shares, property, money lent, money held by others and pension accounts are included; no profit is counted unless a recorded value has moved.`,
  };
  const basis: Record<ClassCard['key'], ExplainInput['basis']> = {
    fd: 'calculated',
    funds: 'calculated',
    cash: 'estimated',
    others: 'recorded',
  };
  return explain({
    id,
    title: c.label,
    exact: exInr(c.current),
    what: `What the ${c.label.toLowerCase()} are worth, what was invested and the profit, and their share of net worth.`,
    how: `${how[key]} Profit ${exSigned(c.profit)}${c.profitPct === null ? '' : ` = ${ratioHow({ label: 'profit', amount: c.profit }, { label: 'invested', amount: c.invested })}`}. Share of net worth: ${ratioHow({ label: c.label.toLowerCase(), amount: c.current }, { label: 'net worth', amount: i.total }, 0, false)}.`,
    inputs: [
      {
        label: 'Current value',
        value: exInr(c.current),
        basis: basis[key],
        to: i.today,
        count: COUNT(c.count, 'holdings'),
      },
      {
        label: 'Invested',
        value: exInr(c.invested),
        basis: key === 'funds' && c.estimated ? 'estimated' : 'recorded',
      },
      ...(c.earned !== null
        ? [
            {
              label: 'Earned since the first record (incl. paid out)',
              value: exSigned(c.earned),
              basis: (c.estimated ? 'estimated' : 'calculated') as 'estimated' | 'calculated',
              from: i.periods.rows.find((r) => r.key === key)?.since,
              to: i.today,
            },
          ]
        : []),
      ...(foreignExplain(c.foreign)?.lines ?? []).map((l) => ({
        label: l.label,
        value: l.value,
        basis: 'calculated' as const,
        to: l.to,
        note: `${l.note}${l.live ? '' : ' (no rate on file)'}`,
      })),
      ...(c.awaiting
        ? [
            {
              label: 'Deposits past their date, not counted (waiting to be confirmed)',
              value: exInr(c.awaiting.current),
              basis: 'missing' as const,
              count: COUNT(c.awaiting.count, 'deposits'),
            },
          ]
        : []),
    ],
    level: c.estimated ? 'partly_estimated' : 'complete',
    completeness: c.estimated
      ? key === 'cash'
        ? `Interest is estimated: banks credit it in lumps. ${i.trustDetail.assumptions} account(s) use the assumed rate.`
        : 'Part of the profit rests on an estimate (a plan, assumed instalments or no statement).'
      : 'Worked out from recorded facts and contract terms.',
    notes: [
      foreignExplain(c.foreign)?.sentence ?? null,
      c.awaiting
        ? `Leaves out ${exInr(c.awaiting.current)} in ${exPlural(c.awaiting.count, 'deposit')} past their date: once a deposit has matured its money is in a savings account or a new deposit, which are counted on their own.`
        : null,
    ],
  });
}

/** The "?" of How is my money growing? and of the extras under the headline. */
function growthExplains(i: HomeExplainInput) {
  const g = i.growth;
  const x = i.extras;
  const value = (k: ClassCard['key']) => i.classes.find((c) => c.key === k)?.current ?? 0;
  const rate = (r: number | null) => (r === null ? '–' : `${exPct(r, 2)} a year`);
  const parts = [
    { label: 'Fixed deposits', value: value('fd'), rate: g.fd, basis: 'calculated' as const },
    { label: 'Mutual funds', value: value('funds'), rate: g.funds, basis: 'calculated' as const },
    {
      label: 'Savings and cash',
      value: value('cash'),
      rate: g.savings?.rate ?? null,
      basis: 'estimated' as const,
    },
    { label: 'Money lent and other', value: value('others'), rate: 0, basis: 'recorded' as const },
  ].filter((p) => p.value > 0);
  const inflationNote =
    g.inflation === null
      ? []
      : [
          `The mark on each bar is inflation, ${exPct(g.inflation, 1)} a year, from the retirement plan.`,
        ];
  const ef = x.earnedFy;
  return {
    'home.earningRate': explain({
      id: 'home.earningRate',
      title: TERMS.earningRate.label,
      exact: g.all ? rate(g.all.rate) : '–',
      what: TERMS.earningRate.hint,
      how: g.all
        ? `${parts.map((p) => `${p.label} ${exInr(p.value)} × ${rate(p.rate)}`).join(' + ')} = ${exInr(g.all.perYear)} a year ÷ ${exInr(parts.reduce((a, p) => a + p.value, 0))} = ${rate(g.all.rate)}.`
        : 'Shows once every kind of holding has a yearly rate.',
      inputs: parts.map((p) => ({
        label: p.label,
        value: `${exInr(p.value)} · ${rate(p.rate)}`,
        basis: p.basis,
        to: i.today,
      })),
      level: g.all ? 'partly_estimated' : 'missing',
      completeness:
        'Each part’s own rate: the deposits’ and funds’ XIRR from their own dated money, savings from the interest earned this financial year.',
      notes: [
        'Different from XIRR on own money: this is what the money earns today, not how it has grown since records began.',
        ...inflationNote,
      ],
    }),
    'home.fundsXirr': explain({
      id: 'home.fundsXirr',
      title: `${TERMS.xirr.label}: mutual funds`,
      exact: rate(g.funds),
      what: `${TERMS.xirr.hint} Every purchase, SIP, sale and payout of all funds together, and current value.`,
      how:
        g.funds === null
          ? 'Shows once a fund has dated purchases.'
          : `Solved over all fund money movements: ${rate(g.funds)}.`,
      inputs: [
        {
          label: 'Mutual funds today',
          value: exInr(value('funds')),
          basis: 'calculated',
          to: i.today,
        },
      ],
      level: g.funds === null ? 'missing' : 'complete',
      completeness: 'From each fund’s transactions; a fund with no statement uses its plan.',
      notes: inflationNote,
      fix: { label: 'Open Investments', href: i.links.investments },
    }),
    'home.depositsXirr': explain({
      id: 'home.depositsXirr',
      title: `${TERMS.xirr.label}: fixed deposits`,
      exact: rate(g.fd),
      what: `${TERMS.xirr.hint} Each running deposit from its booking date to current value.`,
      how:
        g.fd === null
          ? 'Shows once a deposit is running.'
          : `Each principal out on its booking day, current value of all of them back: ${rate(g.fd)}.`,
      inputs: [
        {
          label: 'Fixed deposits today',
          value: exInr(value('fd')),
          basis: 'calculated',
          to: i.today,
        },
      ],
      level: g.fd === null ? 'missing' : 'complete',
      completeness: 'Worked out from each deposit’s own terms.',
      notes: inflationNote,
      fix: { label: 'Open Deposits', href: i.links.deposits },
    }),
    'home.savingsRate': explain({
      id: 'home.savingsRate',
      title: `${TERMS.rateEarned.label}: savings`,
      exact: g.savings ? rate(g.savings.rate) : '–',
      what: TERMS.rateEarned.hint,
      how: g.savings
        ? `Interest earned since 1 April ${ef ? exInr(ef.savings) : ''} on today’s balance ${exInr(value('cash'))}, made yearly: ${rate(g.savings.rate)}.`
        : 'Shows once this financial year has savings figures.',
      inputs: [
        {
          label: 'Savings and cash today',
          value: exInr(value('cash')),
          basis: 'estimated',
          to: i.today,
        },
      ],
      level: g.savings ? 'estimated' : 'missing',
      completeness:
        'Savings are not an XIRR: money moves in and out daily, so the rate earned is the useful figure.',
      notes: inflationNote,
      fix: { label: 'Open Accounts', href: i.links.accounts },
    }),
    'home.earnedFy': explain({
      id: 'home.earnedFy',
      title: TERMS.earnedFy.label,
      exact: ef ? exSigned(ef.total) : '–',
      what: TERMS.earnedFy.hint,
      how: ef
        ? `Deposits ${exSigned(ef.deposits)} + funds ${exSigned(ef.funds)} + savings ${exSigned(ef.savings)} + other ${exSigned(ef.other)} = ${exSigned(ef.total)}${ef.pct === null ? '' : `, ${exSignedPct(ef.pct, 1)} of net worth on 1 April`}.`
        : 'Shows once the records reach this financial year.',
      inputs: ef
        ? [
            { label: 'Interest on deposits', value: exSigned(ef.deposits), basis: 'calculated' },
            { label: 'Fund profit and loss', value: exSigned(ef.funds), basis: 'calculated' },
            { label: 'Interest on savings', value: exSigned(ef.savings), basis: 'estimated' },
            {
              label: 'Exchange-rate moves and other income',
              value: exSigned(ef.other),
              basis: 'calculated',
            },
          ]
        : [],
      level: ef ? 'partly_estimated' : 'missing',
      completeness: 'The same figures as Wealth movement for this financial year.',
      notes: [],
    }),
    'home.maturing90': explain({
      id: 'home.maturing90',
      title: TERMS.maturing90.label,
      exact: exInr(x.maturing90.principal),
      what: TERMS.maturing90.hint,
      how: `${exPlural(x.maturing90.count, 'deposit')} mature from tomorrow to 90 days from today; their principal adds up to ${exInr(x.maturing90.principal)} (${exInr(x.maturing30.principal)} of it within 30 days).`,
      inputs: [
        {
          label: 'Deposits maturing',
          value: exInr(x.maturing90.principal),
          basis: 'calculated',
          from: i.today,
          count: COUNT(x.maturing90.count, 'deposits'),
        },
      ],
      level: 'complete',
      completeness: 'From each deposit’s recorded maturity date.',
      notes: [],
      fix: { label: 'See maturities', href: i.links.maturities },
    }),
    'home.nreNro': explain({
      id: 'home.nreNro',
      title: TERMS.nreNro.label,
      exact: `${exInr(x.nre)} · ${exInr(x.nro)}`,
      what: TERMS.nreNro.hint,
      how: `Savings and deposits in NRE accounts ${exInr(x.nre)}; in NRO accounts ${exInr(x.nro)}. Accounts with no type set, and accounts abroad, are in neither.`,
      inputs: [
        { label: 'NRE', value: exInr(x.nre), basis: 'estimated', to: i.today },
        { label: 'NRO', value: exInr(x.nro), basis: 'estimated', to: i.today },
      ],
      level: 'complete',
      completeness: 'From the account type recorded for each account.',
      notes: [],
      fix: { label: 'Open Accounts', href: i.links.accounts },
    }),
  };
}

export function buildHomeExplain(i: HomeExplainInput): ExplainSet<'home'> {
  const dep = i.deposits;
  const trend = i.trend;
  const g = trend.growth;
  return {
    'home.netWorth': netWorth(i),
    'home.today': explain({
      id: 'home.today',
      title: TERMS.todayChange.label,
      exact: exSigned(i.change.today.amount),
      what: 'Interest at each rate and the move in fund prices since yesterday.',
      how: `Interest since yesterday ${exSigned(i.change.today.banks)} + fund price moves ${exSigned(i.change.today.funds)} = ${exSigned(i.change.today.amount)}${i.change.today.pct === null ? '' : `, ${ratioHow({ label: 'earned', amount: i.change.today.amount }, { label: 'yesterday’s net worth', amount: i.total - i.change.today.amount }, 2)}`}.`,
      inputs: [
        {
          label: 'One day of interest at each rate',
          value: exSigned(i.change.today.banks),
          basis: 'estimated',
          to: i.today,
        },
        {
          label: 'Fund price moves (last two prices)',
          value: exSigned(i.change.today.funds),
          basis: 'calculated',
          to: i.today,
        },
      ],
      level: 'estimated',
      completeness: 'An estimate, not read from a bank.',
      notes: [],
    }),
    ...capitalExplains(i),
    'home.verified': verified(i),
    'home.free30': explain({
      id: 'home.free30',
      title: TERMS.available30.label,
      exact: exInr(i.extras.available30.total),
      what: `${TERMS.available30.hint} Nothing is sold.`,
      how: `Savings and cash ${exInr(i.extras.available30.cash)} + the principal of deposits maturing within ${exPlural(i.freeDays, 'day')} ${exInr(i.extras.available30.deposits)} = ${exInr(i.extras.available30.total)}. Nothing is sold, so there is no tax, exit load or lost interest; the interest the deposits pay comes on top.`,
      inputs: [
        {
          label: 'Savings and cash',
          value: exInr(i.extras.available30.cash),
          basis: 'estimated',
          to: i.today,
        },
        {
          label: 'Deposits maturing (principal)',
          value: exInr(i.extras.available30.deposits),
          basis: 'calculated',
          from: i.today,
          count: COUNT(i.extras.maturing30.count, 'deposits'),
        },
      ],
      level: 'partly_estimated',
      completeness:
        'Cash is the balance moved forward by estimated interest; deposits are calculated from their dates.',
      notes: [
        'A deposit whose date has passed is not a deposit any more: its money is in a savings account or a new deposit, which are listed on their own.',
      ],
      fix: { label: 'Open “I need money”', href: i.links.raise },
    }),
    ...growthExplains(i),
    'home.goalsStat': explain({
      id: 'home.goalsStat',
      title: 'Goals on track',
      what: 'How many goals with a target are funded on the plan.',
      how: `${i.goals.onTrack} of ${exPlural(i.goals.withTarget, 'goal')} with a target are on track.`,
      inputs: [
        {
          label: 'Goals with a target',
          value: String(i.goals.withTarget),
          basis: i.goals.withTarget > 0 ? 'recorded' : 'missing',
          count: COUNT(i.goals.count, 'goals'),
        },
      ],
      level: i.goals.withTarget === 0 ? 'missing' : 'complete',
      completeness:
        i.goals.withTarget === 0
          ? 'No goal has a target yet.'
          : 'A goal is on track when its allocated holdings reach the target on the plan.',
      notes: [],
      fix: { label: 'Open Goals', href: i.links.goals },
    }),
    'home.needsStat': explain({
      id: 'home.needsStat',
      title: 'Needs you',
      what: 'How many things wait for a person: late items, dated items and housekeeping.',
      how: `${exPlural(i.attention.length, 'item')} ${i.attention.length === 1 ? 'needs' : 'need'} you, of which ${i.attention.filter((a) => a.tone === 'bad').length} are late or urgent; ${exPlural(i.openTasks, 'open task')}.`,
      inputs: [{ label: 'Items waiting', value: String(i.attention.length), basis: 'calculated' }],
      level: 'complete',
      completeness:
        'Counted from deposits, balances, policies, loans and tasks, with the thresholds set in Settings.',
      notes: [],
    }),
    'home.insured': explain({
      id: 'home.insured',
      title: TERMS.aboveInsured.label,
      exact: exInr(dep.cover.uninsured),
      what: TERMS.aboveInsured.hint,
      how: `For each bank and name: deposits and savings together minus the limit ${exInr(dep.cover.limit)}; the excess added = ${exInr(dep.cover.uninsured)} in ${exPlural(dep.cover.banksOver, 'bank')}.`,
      inputs: [
        {
          label: 'Limit per bank and name',
          value: exInr(dep.cover.limit),
          basis: 'recorded',
          note: 'a Setting',
        },
      ],
      level: 'complete',
      completeness:
        'Counted over every deposit and savings account of the household; foreign banks are left out.',
      notes: [],
      fix: { label: 'Open the cover check', href: i.links.cover },
    }),
    'home.classDeposits': classCard('fd', 'home.classDeposits', i),
    'home.classFunds': classCard('funds', 'home.classFunds', i),
    'home.classCash': classCard('cash', 'home.classCash', i),
    'home.classOthers': classCard('others', 'home.classOthers', i),
    'home.trend': explain({
      id: 'home.trend',
      title: 'Net worth over time',
      what: 'The net worth saved over the range chosen, and the change over it. Points for months before the app was used are rebuilt from the history on file and say so.',
      how: trend.view.change
        ? `Last saved value − first value in the range = ${exSigned(trend.view.change.amount)}${trend.view.change.pct === null ? '' : ` (${ratioHow({ label: 'change', amount: trend.view.change.amount }, { label: 'the first value', amount: trend.view.points[0]?.value ?? 0 })})`}. ${trend.pace ? `The dotted line extends the last ${exPlural(trend.pace.months, 'month')}’ pace of ${exSigned(trend.pace.monthlyChange)} a month in a straight line; it is not a forecast.` : ''}`
        : 'The change shows once two days are saved.',
      inputs: [
        {
          label: 'Saved daily net worth',
          value: `${trend.view.points.length} points`,
          basis: 'recorded',
          from: trend.view.points[0]?.date,
          to: trend.view.points.at(-1)?.date,
          note: trend.view.short ? 'the history does not reach the start of the range' : undefined,
        },
      ],
      level:
        trend.view.points.length < 2
          ? 'missing'
          : trend.view.short
            ? 'partly_estimated'
            : 'complete',
      completeness:
        trend.view.points.length < 2
          ? 'Missing: the graph appears once two days are saved.'
          : trend.view.short
            ? 'The saved history is shorter than the range.'
            : trend.rebuilt > 0
              ? `${trend.rebuilt} of ${trend.history} points were rebuilt from your history (month ends worked out from the records on file), the rest were recorded on the day.`
              : 'Every point is a net worth saved that day.',
      notes: [
        'Money you add or take out is part of the change.',
        ...(trend.missingMonths > 0
          ? [
              `${exPlural(trend.missingMonths, 'month')} the records reach back to have no point yet: use “Rebuild the history chart” on Import > History.`,
            ]
          : []),
      ],
    }),
    'home.growth': explain({
      id: 'home.growth',
      title: 'Invested and profit',
      exact: exSigned(g.growth),
      what: 'In banks and funds: what was invested against what it is worth, and the growth between them.',
      how: `Current value ${exInr(g.current)} − invested ${exInr(g.invested)} = ${exSigned(g.growth)}${g.growthPct === null ? '' : `; ${ratioHow({ label: 'growth', amount: g.growth }, { label: 'invested', amount: g.invested })}`}. The bar shows what was invested as a share of current value: ${exPct(g.investedShare, 0)}.`,
      inputs: g.parts.map((p) => ({
        label: p.label,
        value: `${exInr(p.invested)} invested → ${exInr(p.current)} now`,
        basis: (p.approximate ? 'estimated' : 'recorded') as 'estimated' | 'recorded',
      })),
      level: g.approximate ? 'partly_estimated' : 'complete',
      completeness: g.approximate
        ? 'Approximate: some funds have no statement, so their cost is the amount entered.'
        : 'Every part has a recorded cost.',
      notes: [
        'Property, shares and money lent have no recorded cost, so they are not in this split.',
      ],
    }),
    'home.where': explain({
      id: 'home.where',
      title: 'Where the money is',
      what: 'Net worth by kind of holding, by person, and by NRE or NRO and currency where they exist.',
      how: `Each kind’s value ÷ net worth ${exInr(i.total)}: ${i.allocation.map((a) => `${a.label} ${exInr(a.amount)} = ${exPct(a.share, 0)}`).join('; ')}.`,
      inputs: i.allocation.map((a) => ({
        label: a.label,
        value: exInr(a.amount),
        basis: 'calculated' as const,
        to: i.today,
      })),
      level: estShare(i),
      completeness:
        'The same holdings as net worth, each counted once. Negative amounts are not shown.',
      notes: [],
    }),
    'home.goals': explain({
      id: 'home.goals',
      title: 'Goals',
      what: 'Each goal with a word and a bar.',
      how: `${i.goals.onTrack} of ${exPlural(i.goals.withTarget, 'goal')} with a target are on track; a goal’s bar is the value of its allocated holdings ÷ its target.`,
      inputs: [
        { label: 'Goals with a target', value: String(i.goals.withTarget), basis: 'recorded' },
      ],
      level: i.goals.withTarget === 0 ? 'missing' : 'complete',
      completeness:
        i.goals.withTarget === 0 ? 'No goal has a target yet.' : 'Targets are set on each goal.',
      notes: [],
      fix: { label: 'Open Goals', href: i.links.goals },
    }),
  };
}
