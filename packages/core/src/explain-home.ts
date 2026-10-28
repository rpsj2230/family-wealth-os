/**
 * The "?" explainers of Home: the net worth and how it changed, the money tiles, how much is verified, the four kinds of holding,
 * the profit by period, the trend, where the money is and how fast it can be reached. Pure: Home's own model (HomeModel in the web
 * app) is passed in as plain values; every number quoted is one Home already shows, taken from the same functions the other pages use.
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
  HomeRange,
  RangeView,
  ValueTrust,
} from './home';
import type { GainPeriodKey, PeriodGains, PeriodWindow } from './period-gains';
import { coverageWords, sinceWords, type HeadlineTile } from './position';
import { formatInrCompact } from './money';

export interface HomeExplainInput {
  today: string;
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
    title: 'Net worth today',
    exact: exInr(i.total),
    shown: formatInrCompact(i.total),
    what: 'Everything the family holds that is wealth, at today’s value. Insurance cover is never counted.',
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
      maturedRuleText(),
      'Every kind below adds up to this figure, so nothing is counted twice.',
    ],
    fix: { label: 'Update balances', href: i.links.monthly },
  });
}

/**
 * What the family earned over a period: the gain of each kind of holding between the first day and the last, each valued from the
 * nearest record on or before the day and moved forward to it. Quotes the dates of the records it rests on.
 */
function tileExplain(
  id: string,
  title: string,
  what: string,
  key: GainPeriodKey,
  i: HomeExplainInput,
  basisNote: string,
): Explain {
  const t = i.tiles[key];
  const p = i.periods;
  if (i.dataStarts === null || (t.empty && t.from >= t.to))
    return explain({
      id,
      title,
      what,
      how: 'Not worked out: nothing is on record for this period yet.',
      inputs: [{ label: 'Records on file', value: 'none', basis: 'missing' }],
      level: 'missing',
      completeness: `Missing: ${i.dataStarts === null ? 'no balance, deposit or fund is recorded' : `the data starts ${exDate(i.dataStarts)}, after this period`}.`,
      notes: [],
    });
  const rows = p.rows.filter((r) => !r.cells[key].empty);
  const f = t.startFrom;
  const records =
    f.oldest === null
      ? 'deposit terms only'
      : f.oldest === f.newest
        ? `the record of ${exDate(f.oldest)}`
        : `records from ${exDate(f.oldest)} to ${exDate(f.newest)}`;
  const kindHow = (r: (typeof rows)[number]) => {
    const c = r.cells[key];
    return `${r.label}: ${exSigned(c.profit)} (worth ${exInr(c.startValue)} at the start, ${exInr(c.endValue)} at the end${c.putIn > 0 ? `, ${exInr(c.putIn)} put in` : ''}${c.takenOut > 0 ? `, ${exInr(c.takenOut)} taken out` : ''})`;
  };
  const cap = (x: string) => `${x[0]!.toUpperCase()}${x.slice(1)}`;
  return explain({
    id,
    title,
    exact: exSigned(t.amount),
    what,
    how: `${rows.map(kindHow).join('; ')}. Together ${exSigned(t.amount)}${t.pct === null ? '' : `; as a share of the money at work: ${ratioHow({ label: 'earned', amount: t.amount }, { label: 'at work', amount: t.base }, 2)}`}. Each holding is valued on ${exDate(t.from)} from the nearest record on or before that day, moved forward to it at its rate or the exchange rate (a fund: the units held times the price of the day, the units from its statement or, with none, from your SIP plan), and the same on the last day; a deposit made from savings, a payout, a fund bought or sold and a balance that jumped are money moving, not earnings.`,
    inputs: [
      {
        label: 'First day built from',
        value: records,
        basis: f.movedForward > 0 ? 'estimated' : 'recorded',
        from: f.oldest,
        to: t.from,
        note:
          f.movedForward > 0
            ? `${exPlural(f.movedForward, 'holding')} moved forward from an earlier record to ${exDate(t.from)} (savings at the account’s rate, funds by the price)${f.fromTerms > 0 ? `; ${exPlural(f.fromTerms, 'deposit')} worked out from their own terms` : ''}`
            : undefined,
      },
      {
        label: 'Holdings with a value on the first day',
        value: `${t.coverage.withValue} of ${t.coverage.of}`,
        basis: t.coverage.withValue === t.coverage.of ? 'calculated' : 'missing',
        count: { n: t.coverage.withValue, of: t.coverage.of, noun: 'holdings' },
        from: t.from,
        to: t.from,
      },
      ...rows.map((r) => ({
        label: `${r.label}: earned`,
        value: exSigned(r.cells[key].profit),
        basis: (r.cells[key].estimated ? 'estimated' : 'calculated') as 'estimated' | 'calculated',
        from: t.from,
        to: t.to,
      })),
      {
        label: 'Net worth on the first day and today',
        value: `${exInr(t.netWorth.start)} → ${exInr(t.netWorth.end)}`,
        basis: 'calculated',
        note: `it moved ${exSigned(t.netWorth.change)}; money added or taken out is in that, not in the earnings above`,
      },
    ],
    level:
      t.clamped || t.estimated || t.coverage.withValue < t.coverage.of
        ? 'partly_estimated'
        : 'complete',
    completeness: t.clamped
      ? `Data starts ${exDate(t.from)}: nothing is on record before it, so this period begins there and not on ${exDate(t.asked)}. ${cap(coverageWords(t))}.`
      : `${cap(sinceWords(t))}: built from ${records}. ${cap(coverageWords(t))}.${t.estimated ? ' Part of it is estimated from rates, prices or assumed instalments.' : ''}`,
    notes: [
      basisNote,
      'The change in net worth is a different figure: it includes money you added or took out.',
    ],
  });
}

function money(id: string, i: HomeExplainInput): Explain {
  const k = i.money;
  const cls = i.classes;
  const parts = (f: (c: ClassCard) => number) =>
    cls.map((c) => `${c.label} ${exInr(f(c))}`).join(' + ');
  if (id === 'home.invested')
    return explain({
      id,
      title: 'Total invested',
      exact: exInr(k.invested),
      what: 'The money put into deposits and funds. Savings and cash balances, shares, property and money lent are in net worth but are not counted as invested.',
      how: `Deposits ${exInr(k.parts.fd.invested)} (the principal of each) + funds ${exInr(k.parts.funds.invested)} (the cost of the units still held) = ${exInr(k.invested)}. ${exInr(k.parts.notInvested)} of net worth is not invested money: savings and cash, shares, property, pension accounts, money lent.`,
      inputs: [
        {
          label: 'Deposits: principal',
          value: exInr(k.parts.fd.invested),
          basis: 'recorded',
          to: i.today,
        },
        {
          label: 'Funds: cost of the units held',
          value: exInr(k.parts.funds.invested),
          basis: (cls.find((c) => c.key === 'funds')?.estimated ? 'estimated' : 'recorded') as
            'estimated' | 'recorded',
          to: i.today,
        },
        {
          label: 'Not invested: savings, cash, shares, property, loans',
          value: exInr(k.parts.notInvested),
          basis: 'recorded',
        },
      ],
      level: k.estimated ? 'partly_estimated' : 'complete',
      completeness: k.estimated
        ? 'Part of it rests on an estimate: a fund with no statement uses the amount entered as its cost.'
        : 'Every cost is recorded.',
      notes: [
        'This tile used to add the last balance recorded for each savings account; those are not invested money and are no longer counted here.',
      ],
    });
  if (id === 'home.current')
    return explain({
      id,
      title: 'Current value',
      exact: exInr(k.current),
      what: 'Net worth: everything counted, at today’s value.',
      how: `The same figure as net worth today: ${exInr(i.total)}.`,
      inputs: [
        {
          label: 'Net worth today',
          value: exInr(i.total),
          basis: estShare(i) === 'complete' ? 'calculated' : 'estimated',
          to: i.today,
        },
      ],
      level: estShare(i),
      completeness: `${exInr(i.trustDetail.byBasis.estimated)} of it is estimated from rates or prices.`,
      notes: [],
    });
  if (id === 'home.maturity')
    return explain({
      id,
      title: 'Maturity value',
      exact: exInr(k.maturity),
      what: 'What it would all be worth if every deposit paid out on its date and the rest stayed at today’s value.',
      how: `${parts((c) => c.maturity)} = ${exInr(k.maturity)}.`,
      inputs: cls.map((c) => ({
        label: c.label,
        value: exInr(c.maturity),
        basis: (c.key === 'fd' ? 'calculated' : 'estimated') as 'calculated' | 'estimated',
        to: i.today,
      })),
      level: 'partly_estimated',
      completeness:
        'Deposits are calculated from their terms; funds, cash and the rest have no maturity and stay at today’s value, so this is not a forecast.',
      notes: [maturedRuleText()],
    });
  if (id === 'home.profit')
    return explain({
      id,
      title: 'Profit so far (on invested money)',
      exact: exSigned(k.profit),
      what: 'What the deposits and funds are worth above the money put into them: the interest the deposits have accrued and the gain on the fund units still held.',
      how: `Deposits ${exInr(k.parts.fd.current)} now − ${exInr(k.parts.fd.invested)} principal = ${exSigned(k.parts.fd.profit)}; funds ${exInr(k.parts.funds.current)} now − ${exInr(k.parts.funds.invested)} cost of the units held = ${exSigned(k.parts.funds.profit)}; together ${exSigned(k.profit)}${k.profitPct === null ? '' : `. As a share of the money invested, at cost: ${ratioHow({ label: 'profit', amount: k.profit }, { label: 'invested', amount: k.invested })}`}.`,
      inputs: [
        {
          label: 'Deposits: accrued interest',
          value: exSigned(k.parts.fd.profit),
          basis: 'calculated',
          to: i.today,
          note: 'from each deposit’s terms, up to today',
        },
        {
          label: 'Funds: gain on the units held',
          value: exSigned(k.parts.funds.profit),
          basis: (cls.find((c) => c.key === 'funds')?.estimated ? 'estimated' : 'calculated') as
            'estimated' | 'calculated',
          to: i.today,
          note: 'value now − cost of the units still held',
        },
      ],
      level: k.estimated ? 'partly_estimated' : 'complete',
      completeness: k.estimated
        ? 'Part of it is estimated: funds with no statement or with assumed instalments.'
        : 'Calculated from deposit terms and recorded units and costs.',
      notes: [
        'Savings interest is not in this figure (there is no invested amount to compare it with); it is in the earnings of each period. Interest already paid out and gains already booked are in “Since the start” of the table below.',
      ],
    });
  // earnedToday
  const c = i.change.today;
  return explain({
    id,
    title: 'Earned today',
    exact: exSigned(c.amount),
    what: 'What savings and deposits earned since yesterday, plus the move in fund prices.',
    how: `Bank interest for one day ${exSigned(c.banks)} + the change in fund prices over their last two prices ${exSigned(c.funds)} = ${exSigned(c.amount)}${c.pct === null ? '' : `; as a share of yesterday’s net worth: ${ratioHow({ label: 'earned', amount: c.amount }, { label: 'yesterday’s net worth', amount: i.total - c.amount }, 2)}`}.`,
    inputs: [
      {
        label: 'Interest at each account’s and deposit’s rate, one day',
        value: exSigned(c.banks),
        basis: 'estimated',
        to: i.today,
      },
      {
        label: 'Fund price moves',
        value: exSigned(c.funds),
        basis: 'calculated',
        to: i.today,
        note: 'between each fund’s last two published prices',
      },
    ],
    level: 'estimated',
    completeness:
      'An estimate: it is not read from a bank. Savings interest uses the account’s own rate, else the bank’s rate, else the assumed rate in Settings.',
    notes: [
      `Tax at source of ${exPct(i.assumptions.tdsRate, 0)} is taken off savings interest; the assumed savings rate is ${exPct(i.assumptions.savingsRate, 2)}.`,
    ],
  });
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
    what: `What the ${c.label.toLowerCase()} are worth, what was put in and the profit, and their share of net worth.`,
    how: `${how[key]} Profit ${exSigned(c.profit)}${c.profitPct === null ? '' : ` = ${ratioHow({ label: 'profit', amount: c.profit }, { label: 'invested', amount: c.invested })}`}. Share of net worth: ${ratioHow({ label: c.label.toLowerCase(), amount: c.current }, { label: 'net worth', amount: i.total }, 0, false)}.`,
    inputs: [
      {
        label: 'Worth today',
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

function periods(i: HomeExplainInput): Explain {
  const p = i.periods;
  const w = (k: PeriodWindow['key']) => p.windows.find((x) => x.key === k)!;
  const tot = p.total.cells;
  return explain({
    id: 'home.periods',
    title: 'Profit earned, by period',
    what: 'The profit of each kind of holding over the last days, this month, quarter and financial year, the last financial year and since the start.',
    how: `Worked out from each holding’s own terms and records (the nearest record on or before each day, moved forward at its rate, price or exchange rate), not from saved totals. In all: ${p.windows.map((x) => `${x.label.toLowerCase()} ${tot[x.key].empty ? 'nothing held' : exSigned(tot[x.key].profit)}`).join('; ')}. The % is the profit ÷ the money at work (the value at the start plus each sum put in for the days it was there); money moved in or out is shown apart and is never profit.`,
    inputs: p.windows.map((x) => ({
      label: x.label,
      value: `${exRange(x.from, x.through)}`,
      basis: 'calculated' as const,
      from: x.from,
      to: x.through,
      note: `${x.days} days${x.clamped ? `; data starts ${exDate(x.from)}, the period would begin on ${exDate(x.asked)}` : ''}`,
    })),
    level:
      p.basis.fundsFromPlan + p.basis.fundsWithAssumed > 0 ||
      p.rows.some((r) => r.key === 'cash' && !r.cells.recent.empty)
        ? 'partly_estimated'
        : 'complete',
    completeness: `Deposits are calculated from their terms${p.basis.depositsEndedGuessed > 0 ? ` (${exPlural(p.basis.depositsEndedGuessed, 'deposit')} with no payout day use the maturity date)` : ''}; cash is always estimated; ${p.basis.fundsFromPlan} fund(s) are rebuilt from a plan and ${p.basis.fundsWithAssumed} have assumed instalments${p.basis.foreignAccounts > 0 ? `; ${p.basis.foreignAccounts} foreign-currency account(s) earn nothing here` : ''}${p.basis.accountsWithoutBalance > 0 ? `; ${p.basis.accountsWithoutBalance} account(s) have no balance recorded` : ''}.`,
    notes: [
      `${w('recent').label} is a Settings value. This month, quarter and financial year start on the 1st, on 1 Apr, 1 Jul, 1 Oct, 1 Jan, and on 1 April.`,
      'The change in net worth at the top also includes money added or taken out, so the two differ by design.',
      `Funds are worth the units held on a day times the price of that day. With a fund statement the units are the statement’s. A fund with no transactions has its units worked out from your plan: the start date, the amount invested and every SIP amount and change with its date, each instalment buying its amount divided by the price of its day (the next priced day when it fell on a holiday). That is labelled estimated from your SIP plan and the price of each day. Your monthly sheet value is used only as a last resort, for a fund with no start date or no price. Between two monthly sheet values the fund moves with its price; money added by the SIP plan and any difference between the sheet and the prices is not counted as profit. Of the ${exPlural(p.basis.fundsHeld, 'fund')} held, ${p.basis.fundsValuedFromLedger} are valued from a statement ledger, ${p.basis.fundsValuedFromPlan} from your plan and the price of each day and ${p.basis.fundsValuedFromRecords} from a value on file (the last resort).`,
    ],
    fix: { label: 'Open Settings', href: i.links.settings },
  });
}

export function buildHomeExplain(i: HomeExplainInput): ExplainSet<'home'> {
  const l = i.liquidity;
  const dep = i.deposits;
  const next = i.banks.overview.next;
  const f = i.funds;
  const trend = i.trend;
  const g = trend.growth;
  return {
    'home.netWorth': netWorth(i),
    'home.today': explain({
      id: 'home.today',
      title: 'Net worth change today',
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
    'home.month': tileExplain(
      'home.month',
      `Earned over the last ${exPlural(i.change.monthDays, 'day')}`,
      'What the holdings earned over the days set in Settings: interest, price moves and exchange-rate moves, not money you added or took out.',
      'recent',
      i,
      `The number of days (${i.change.monthDays}) is a Settings value.`,
    ),
    'home.fy': tileExplain(
      'home.fy',
      'Earned this financial year',
      `What the holdings earned since the financial year began on ${exDate(i.change.fyStart)}: interest, price moves and exchange-rate moves, not money you added or took out.`,
      'fy',
      i,
      'The financial year starts on 1 April.',
    ),
    'home.invested': money('home.invested', i),
    'home.current': money('home.current', i),
    'home.maturity': money('home.maturity', i),
    'home.profit': money('home.profit', i),
    'home.earnedToday': money('home.earnedToday', i),
    'home.verified': verified(i),
    'home.cashAndDeposits': explain({
      id: 'home.cashAndDeposits',
      title: 'Cash and deposits',
      exact: exInr(l.cashAndDeposits),
      what: 'Bank balances and fixed deposits together, and how many months of spending they cover.',
      how: `Cash and deposits ${exInr(l.cashAndDeposits)} ÷ net worth ${exInr(i.total)} = ${exPct(i.total > 0 ? l.cashAndDeposits / i.total : 0, 0)}.${l.months === null ? ' No monthly spending is entered, so no cover is worked out.' : ` ÷ monthly spending ${exInr(l.monthlySpending)} = ${l.months.toFixed(1)} months.`}`,
      inputs: [
        {
          label: 'Cash and deposits',
          value: exInr(l.cashAndDeposits),
          basis: 'estimated',
          to: i.today,
        },
        {
          label: 'Monthly spending (retirement plan)',
          value: l.monthlySpending > 0 ? exInr(l.monthlySpending) : 'not entered',
          basis: l.monthlySpending > 0 ? 'recorded' : 'missing',
        },
      ],
      level: l.months === null ? 'partly_estimated' : 'complete',
      completeness:
        l.months === null
          ? 'Missing: enter the household’s monthly spending to see how many months this covers.'
          : 'The spending is the figure entered in the retirement plan.',
      notes: [],
      fix:
        l.months === null
          ? { label: 'Enter spending in the retirement plan', href: '/retire' }
          : undefined,
    }),
    'home.free30': explain({
      id: 'home.free30',
      title: `Free within ${exPlural(i.freeDays, 'day')}`,
      exact: exInr(l.within30),
      what: 'What could be in the bank within the window with nothing sold.',
      how: `Cash now plus each deposit that matures within ${exPlural(i.freeDays, 'day')} = ${exInr(l.within30)}. Nothing is sold, so there is no tax, exit load or lost interest.`,
      inputs: [
        {
          label: 'Cash and deposits reachable',
          value: exInr(l.within30),
          basis: 'estimated',
          from: i.today,
          count: { n: i.freeDays, noun: 'days' },
        },
      ],
      level: 'partly_estimated',
      completeness:
        'Cash is the balance moved forward by estimated interest; deposits are calculated from their dates.',
      notes: [
        'The window is the first “I need money” scenario day in Settings.',
        'A deposit whose date has passed is not a deposit any more: its money is in a savings account or a new deposit, which are listed on their own.',
      ],
      fix: { label: 'Open “I need money”', href: i.links.raise },
    }),
    'home.nextMaturity': explain({
      id: 'home.nextMaturity',
      title: 'Next maturity',
      exact: next ? exInr(next.amount) : undefined,
      what: 'The first deposit date coming up and what is paid on it.',
      how: next
        ? `${next.count} deposit(s) mature on ${exDate(next.date)} (${next.days === 0 ? 'today' : `in ${exPlural(next.days, 'day')}`}) at ${next.bank}, paying ${exInr(next.amount)}.`
        : 'No deposit is running.',
      inputs: [
        {
          label: 'Maturity date and amount',
          value: next ? `${exDate(next.date)} · ${exInr(next.amount)}` : 'none',
          basis: next ? 'calculated' : 'missing',
          to: next?.date,
        },
      ],
      level: next ? 'complete' : 'missing',
      completeness: next ? 'From the deposit’s recorded dates and terms.' : 'No running deposit.',
      notes: [],
      fix: { label: 'See maturities', href: i.links.maturities },
    }),
    'home.interest': explain({
      id: 'home.interest',
      title: `Interest in ${dep.interest.fy}`,
      exact: exInr(dep.interest.thisYear),
      what: 'The interest the running deposits have added this financial year, and what they add over the next twelve months if held.',
      how: `For each deposit: its value today − its value on the later of ${exDate(dep.interest.fyStart)} and the day it was booked = ${exInr(dep.interest.thisYear)}. The next ${dep.interest.aheadDays} days add ${exInr(dep.interest.ahead)} more, to each deposit’s maturity at most.`,
      inputs: [
        {
          label: 'Running deposits',
          value: exInr(dep.interest.thisYear),
          basis: 'calculated',
          from: dep.interest.fyStart,
          to: i.today,
          count: COUNT(dep.interest.deposits, 'deposits'),
        },
      ],
      level: 'complete',
      completeness:
        'Worked out from each deposit’s own terms. Deposits already paid out are not included. Deposit interest only: savings interest and fund gains are not in it.',
      notes: ['This is accrued interest, not tax or what the bank has credited.'],
    }),
    'home.fundsStat': explain({
      id: 'home.fundsStat',
      title: 'Mutual funds',
      exact: f ? exInr(f.value) : undefined,
      what: 'What the mutual funds are worth, the gain and the annual return.',
      how: f
        ? `Units × latest price = ${exInr(f.value)}; gain ${exSigned(f.gain)} = ${exInr(f.value)} − ${exInr(f.invested)} invested${f.xirr === null ? '' : `; annual return ${exSignedPct(f.xirr, 1)} (XIRR)`}.`
        : 'No mutual fund is recorded.',
      inputs: f
        ? [
            {
              label: 'Fund statements',
              value: `${f.withStatement} of ${f.funds}`,
              basis: 'statement',
              count: { n: f.withStatement, of: f.funds, noun: 'funds' },
            },
          ]
        : [{ label: 'Funds', value: 'none', basis: 'missing' }],
      level: !f
        ? 'missing'
        : f.xirrEstimated || f.withStatement < f.funds
          ? 'partly_estimated'
          : 'complete',
      completeness: !f
        ? 'No fund is recorded.'
        : `A statement is on file for ${f.withStatement} of ${f.funds} funds; the rest use the plan you entered, so their return is an estimate.`,
      notes: ['The full explanation of each fund figure is on the Investments page.'],
      fix: { label: 'Open Investments', href: i.links.investments },
    }),
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
      title: 'Above the insured limit',
      exact: exInr(dep.cover.uninsured),
      what: 'Money in one bank, under one name, above the deposit-insurance limit.',
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
    'home.periods': periods(i),
    'home.changed': explain({
      id: 'home.changed',
      title: 'What changed',
      what: 'The biggest moves by kind of holding and by person, between the first day of the last days (set in Settings) and today.',
      how: i.whatChanged
        ? `Each kind’s (and person’s) value today − its value on ${exDate(i.whatChanged.since)}, rebuilt from the nearest record on or before that day and moved forward to it; the total moved ${exSigned(i.whatChanged.change)}. Money added or withdrawn is part of a move.`
        : 'Not worked out: nothing is on record for that day yet.',
      inputs: [
        {
          label: 'Position rebuilt for',
          value: i.whatChanged ? exDate(i.whatChanged.since) : 'none',
          basis: i.whatChanged ? 'estimated' : 'missing',
          from: i.whatChanged?.since,
          to: i.today,
        },
      ],
      level: !i.whatChanged ? 'missing' : i.whatChanged.partial ? 'partly_estimated' : 'complete',
      completeness: !i.whatChanged
        ? 'Missing: nothing is recorded for that day.'
        : i.whatChanged.partial
          ? `Data starts ${exDate(i.whatChanged.since)}: nothing is on record before it.`
          : 'Each holding valued on that day from its nearest earlier record, at its rate or price.',
      notes: [],
    }),
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
      title: 'Money put in and growth',
      exact: exSigned(g.growth),
      what: 'In banks and funds: what was put in against what it is worth, and the growth between them.',
      how: `Worth today ${exInr(g.current)} − put in ${exInr(g.invested)} = ${exSigned(g.growth)}${g.growthPct === null ? '' : `; ${ratioHow({ label: 'growth', amount: g.growth }, { label: 'put in', amount: g.invested })}`}. The bar shows what was put in as a share of today’s value: ${exPct(g.investedShare, 0)}.`,
      inputs: g.parts.map((p) => ({
        label: p.label,
        value: `${exInr(p.invested)} put in → ${exInr(p.current)} now`,
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
    'home.liquidity': explain({
      id: 'home.liquidity',
      title: 'How fast can I get at it?',
      what: 'How much could be in the bank by when: first with nothing sold, then at no cost, then the most including sales and early breaks.',
      how: `Nothing sold: accounts now, then each deposit as it matures, ${exInr(l.ladderTotal)} in all. For each window: the most each holding can give by that date, counted once. ${l.raise.map((r) => `by ${exDate(r.date)}: ${exInr(r.free)} at no cost, ${exInr(r.most)} at most`).join('; ')}.`,
      inputs: [
        {
          label: 'Windows (days)',
          value: l.raise.map((r) => r.days).join(', '),
          basis: 'recorded',
          note: 'the “I need money” scenario days in Settings',
        },
      ],
      level: 'partly_estimated',
      completeness:
        'Deposits are calculated from their dates; funds are valued at the latest price; before tax and penalties. Selling funds is taxed and breaking a deposit early loses interest.',
      notes: [maturedRuleText()],
      fix: { label: 'Open “I need money”', href: i.links.raise },
    }),
    'home.banks': explain({
      id: 'home.banks',
      title: 'Banks',
      exact: exInr(i.banks.overview.current),
      what: 'The money in banks, and the bank that holds most of it.',
      how: `Savings and deposits in banks = ${exInr(i.banks.overview.current)}${i.banks.topShare === null ? '' : `; the largest bank holds ${exPct(i.banks.topShare, 0)} of it`}.`,
      inputs: [
        {
          label: 'Money in banks',
          value: exInr(i.banks.overview.current),
          basis: 'estimated',
          to: i.today,
        },
      ],
      level: i.banks.overview.staleBalances > 0 ? 'partly_estimated' : 'complete',
      completeness:
        `${exPlural(i.banks.overview.staleBalances, 'balance')} older than ${i.banks.overview.staleBalances === 1 ? 'its' : 'their'} window. ${i.banks.maturedNotCounted > 0 ? `Deposits past their date (${exInr(i.banks.maturedNotCounted)}) are not counted: their money is in a savings account or a new deposit.` : ''}`.trim(),
      notes: [],
      fix: { label: 'Open Accounts', href: i.links.accounts },
    }),
    'home.deposits': explain({
      id: 'home.deposits',
      title: 'Fixed deposits',
      exact: exInr(dep.overview.current),
      what: 'The running fixed deposits, what is invested, what they pay and what is due soon.',
      how: `Value today ${exInr(dep.overview.current)} of ${exInr(dep.overview.invested)} invested; ${exInr(dep.overview.maturity)} at maturity; profit ${exSigned(dep.overview.profit)}.`,
      inputs: [
        {
          label: 'Deposits',
          value: exInr(dep.overview.current),
          basis: 'calculated',
          to: i.today,
          count: COUNT(dep.overview.deposits, 'deposits'),
        },
      ],
      level: 'complete',
      completeness: 'Each deposit is worked out from its own rate and terms.',
      notes: [],
      fix: { label: 'Open Deposits', href: i.links.deposits },
    }),
    'home.funds': explain({
      id: 'home.funds',
      title: 'Mutual funds',
      exact: f ? exInr(f.value) : undefined,
      what: 'The mutual funds in one place.',
      how: f
        ? `Value ${exInr(f.value)}; put in ${exInr(f.invested)}; gain ${exSigned(f.gain)}${f.xirr === null ? '' : `; annual return ${exSignedPct(f.xirr, 1)} (XIRR)`}. Best and weakest are each fund’s annual return.`
        : 'No mutual fund is recorded.',
      inputs: f
        ? [
            {
              label: 'Fund statements',
              value: `${f.withStatement} of ${f.funds}`,
              basis: 'statement',
              count: { n: f.withStatement, of: f.funds, noun: 'funds' },
            },
          ]
        : [],
      level: !f
        ? 'missing'
        : f.xirrEstimated || f.withStatement < f.funds
          ? 'partly_estimated'
          : 'complete',
      completeness: !f
        ? 'No fund is recorded.'
        : `${f.withStatement} of ${f.funds} funds have a statement; ~ marks a return worked out from the plan you entered.`,
      notes: [],
      fix: { label: 'Open Investments', href: i.links.investments },
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
    'home.risks': explain({
      id: 'home.risks',
      title: 'What to watch',
      what: 'The insurance limit, the largest bank, the largest kind of holding and late loans.',
      how: `${exPlural(i.risks, 'item')} are checked. The thresholds (the bank share that is flagged, the insured limit) are Settings values.`,
      inputs: [{ label: 'Checks', value: String(i.risks), basis: 'calculated' }],
      level: 'complete',
      completeness: 'Each check is worked out from the same figures as its own page.',
      notes: [],
    }),
  };
}
