import {
  cashYearly,
  depositsXirr,
  LADDER_DAYS,
  earningRateNow,
  maturingWithin,
  savingsRateEarned,
  type ClassYearly,
  moneyPosition,
  type PositionCard,
  capitalLedger,
  fundViews,
  kindOfBasis,
  mixOf,
  isHeld,
  wealthMovement,
  type CapitalLedger,
  type FigureKind,
  type FundViews,
  type LedgerMove,
  type MovementKey,
  type WealthMovement,
  OTHER_HOLDINGS_KEY,
  allocLabel,
  allocationOf,
  attentionItems,
  bankOverview,
  bestAndWeakest,
  classCards,
  depositInterest,
  depositsByBank,
  fixedDepositBlocks,
  foldByKind,
  fundLedgerNote,
  freshnessSummary,
  growthSplit,
  investedMoney,
  isCounted,
  largestShare,
  linearPath,
  liquidityLadder,
  maturityLadder,
  moversBetween,
  paceFromSeries,
  positionAsOf,
  positionGains,
  raisableWithin,
  rangeView,
  toShares,
  upcomingEvents,
  valueTrust,
  type AllocShare,
  type AppConfig,
  type AttentionItem,
  type BankBlock,
  type BankOverview,
  type BankShare,
  type ClassCard,
  type DepositInterest,
  type FreshnessSummary,
  type FundLedgerNote,
  type GrowthSplit,
  type HomeRange,
  type MaturityYear,
  type ShareMove,
  type OverviewOptions,
  type GainPeriodKey,
  type HeadlineTile,
  type PeriodGains,
  type PositionInput,
  type PersonStyle,
  type Portfolio,
  type RaiseSource,
  type RangeView,
  type SeriesPoint,
  type Share,
  type UpcomingEvent,
  type ValueTrust,
} from '@fwos/core';
import type { DepositsView } from './deposits';
import type { GoalSummary } from './goals-view';
import type { fundPace, FundRow, InvestmentView, Totals } from './investments';

/** One saved day of net worth, as the snapshots table keeps it. */
export interface HomeSnapshot {
  date: string;
  total: number;
  byType: Record<string, number>;
  byOwner: Record<string, number>;
  /** where it came from: recorded on the day, or 'rebuilt' from the history on file afterwards */
  source?: string;
}

export interface HomeReceivable {
  id: string;
  name: string;
  outstanding: number;
  daysOverdue: number;
  expectedOn: string | null;
  settled: boolean;
}

export interface HomeRecent {
  id: string;
  assetId: string;
  name: string;
  /** in rupees */
  amount: number;
  asOf: string;
  source: string;
}

/** Everything Home is drawn from, as plain values. The signed-in page and the public sample both build one of these. */
export interface HomeInput {
  /** ISO date */
  today: string;
  range: HomeRange;
  styles: Record<string, PersonStyle>;
  portfolio: Portfolio;
  blocks: BankBlock[];
  /** how bankOverview() is called for the whole household: rates, insurance, joint holders */
  overview: OverviewOptions;
  currencyOf: Record<string, string>;
  /** earlier days of net worth, oldest first; today is added from the portfolio */
  snapshots: HomeSnapshot[];
  inv: InvestmentView | null;
  pace: ReturnType<typeof fundPace> | null;
  goals: GoalSummary[];
  config: AppConfig;
  cover: DepositsView['cover'];
  sources: RaiseSource[];
  receivables: HomeReceivable[];
  policies: { id: string; insurer: string; renewalOn: string | null; expiresOn: string | null }[];
  tasks: { id: string; title: string; dueOn: string }[];
  openTasks: number;
  inboxReview: number;
  /** what waits on Explain movements (counts and the amount not yet explained) */
  toExplain?: { balances: number; unexplained: number; funding: number };
  /** held funds with no price source, not marked "not a listed fund" */
  fundsNoPrice: number;
  /** everything the position engine reads: every record, deposit, fund ledger and price. The period figures, the net worth on a past day and the coverage all come from it */
  position: PositionInput;
  /** monthly household spending from the retirement plan; 0 until entered */
  monthlySpending: number;
  /** the inflation rate of the retirement plan (0.055 = 5.5%), drawn as a mark on the growth strip; null hides the mark */
  inflation?: number | null;
  recent: HomeRecent[];
  newestRecorded: string | null;
  /** confirmed money movements as the family ledger reads them (capital.ts) */
  moves?: LedgerMove[];
  /** confirmed transfers from a foreign-currency account into a rupee holding (money sent from abroad, e.g. by Wise) */
  abroad?: { date: string; amount: number }[];
  /** the period of the wealth movement panel, from the address */
  movement?: { key: MovementKey; custom?: { from?: string; to?: string } };
}

/** The family's own money and its profit (capital.ts), the movement over the chosen period, and the fund views. */
export interface HomeCapital {
  totals: CapitalLedger['totals'];
  opening: CapitalLedger['opening'];
  limitations: string[];
  movement: WealthMovement;
  funds: Pick<
    FundViews,
    | 'confirmed'
    | 'estimated'
    | 'projected'
    | 'staleCount'
    | 'oldestNav'
    | 'unconfirmedFunds'
    | 'upcoming'
  > & {
    /** Settings: a price older than this many days is shown as old */
    navStaleDays: number;
  };
  /** deposits that matured whose proceeds are counted until you say where they went, and how much */
  proceeds: { count: number; amount: number };
  /** money sent from abroad into the rupee holdings after the opening day: part of the money worked out from balances */
  abroad: { count: number; amount: number };
  /** of net worth, how much each kind of figure makes up (figure.ts) */
  mix: Partial<Record<FigureKind, number>>;
}

export interface BankLine {
  key: string;
  name: string;
  amount: number;
  /** of the money in banks */
  share: number;
}

export interface RiskRow {
  key: string;
  label: string;
  /** a short plain verdict, shown with a word as well as a colour */
  verdict: 'ok' | 'watch' | 'info';
  value: string;
  note: string;
  href: string | null;
}

export interface FundSnapshot {
  totals: Totals;
  people: { ownerId: string; totals: Totals }[];
  sparkline: number[];
  bestWorst: ReturnType<typeof bestAndWeakest>;
  statements: { withStatement: number; total: number };
  pace: ReturnType<typeof fundPace> | null;
  growth: { invested: number; gain: number };
}

/**
 * The headline money figures: what was put to work, what it is worth, what it pays at maturity and the profit on it.
 *  - invested: the money put into deposits (their principal) and funds (the cost of the units still held). Savings and cash balances,
 *    shares, property and money lent are not "invested": they are in net worth but have no cost to earn a profit on.
 *  - profit: what those deposits and funds are worth above that money, and its per cent of the money invested (at cost).
 *  - valueOfInvested: what those deposits and funds are worth now (invested + profit).
 */
export interface HomeMoney {
  invested: number;
  /** net worth: the same figure as `total` */
  current: number;
  /** what deposits pay on their dates; everything else at today's value */
  maturity: number;
  profit: number;
  profitPct: number | null;
  /** what the invested money is worth now */
  valueOfInvested: number;
  /** deposits and funds apart, and the part of net worth that is not invested money */
  parts: {
    fd: { invested: number; current: number; profit: number };
    funds: { invested: number; current: number; profit: number };
    notInvested: number;
  };
  /** the profit of at least one kind rests on an estimate */
  estimated: boolean;
}

export interface HomeGrowth {
  all: { rate: number; perYear: number } | null;
  banks: { rate: number; perYear: number } | null;
  fd: number | null;
  funds: number | null;
  savings: ClassYearly | null;
  own: { rate: number | null; since: string | null };
  inflation: number | null;
}

export interface HomeExtras {
  /** profit made since 1 April, own transfers left out, by kind; null before the ledger reaches this year */
  earnedFy: {
    total: number;
    pct: number | null;
    deposits: number;
    funds: number;
    savings: number;
    other: number;
  } | null;
  available30: { total: number; cash: number; deposits: number };
  maturing30: { count: number; principal: number };
  maturing90: { count: number; principal: number };
  aboveInsured: { amount: number; banks: number; limit: number };
  nre: number;
  nro: number;
}

export interface HomeModel {
  today: string;
  styles: Record<string, PersonStyle>;
  total: number;
  /** own money put in, profit so far, the annual return and the movement of the chosen period */
  capital: HomeCapital;
  money: HomeMoney;
  /** deposits, funds, cash and the rest: together they are net worth */
  classes: ClassCard[];
  /** the yearly return of each kind: XIRR for deposits and funds, the rate cash earns; none for the rest */
  yearly: Partial<Record<ClassCard['key'], ClassYearly | null>>;
  /**
   * How is my money growing? Each kind's yearly rate (XIRR for deposits and funds, the rate savings earned this financial year), all
   * the money together at today's rates (Earning rate now; the money in banks alone for Accounts), XIRR on own money since records
   * began, and the retirement plan's inflation to compare against.
   */
  growth: HomeGrowth;
  /** the useful extras under the headline: what this year earned by kind, what can be reached soon, what matures, insurance, NRE/NRO */
  extras: HomeExtras;
  /** profit earned in the last N days, this month, quarter and financial year, last financial year and since the start */
  periods: PeriodGains;
  /** the line under the period tiles about funds with no transaction ledger: their gains are approximate until a statement is imported */
  fundNote: FundLedgerNote;
  /** the assumptions behind the cash figures, from Settings: the rate for an account with none of its own, and the tax at source */
  assumptions: { savingsRate: number; tdsRate: number };
  counted: number;
  people: number;
  asOf: string | null;
  change: {
    today: { amount: number; pct: number | null; banks: number; funds: number };
    monthDays: number;
    fyStart: string;
  };
  /**
   * What the family earned in each period (interest, price moves, exchange-rate moves, assumed growth; money put in or taken out
   * is not in it), from the same figures as the table above: where the period begins, how many holdings it rests on and how net
   * worth itself moved.
   */
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
  byPerson: { ownerId: string; amount: number; share: number }[];
  currencies: Share[];
  trend: {
    range: HomeRange;
    view: RangeView;
    all: { date: string; value: number }[];
    pace: ReturnType<typeof paceFromSeries>;
    projection: SeriesPoint[];
    growth: GrowthSplit;
    history: number;
    /** points that were worked out afterwards from the history, not recorded on the day */
    rebuilt: number;
    /** month ends the data reaches back to that have no point yet: the history can be rebuilt */
    missingMonths: number;
  };
  whatChanged: {
    since: string;
    partial: boolean;
    change: number;
    /** against net worth on that day; null when it was not above zero */
    pct: number | null;
    kinds: ShareMove[];
    people: ShareMove[];
  } | null;
  liquidity: {
    ladder: ReturnType<typeof liquidityLadder>;
    ladderTotal: number;
    within30: number;
    /** by each window from Settings: what costs nothing, and the most including sales and early breaks */
    raise: { days: number; date: string; free: number; most: number }[];
    cashAndDeposits: number;
    months: number | null;
    monthlySpending: number;
  };
  /**
   * The money position, one card per kind of money (net worth of the family and each person, cash in rupees and in each foreign
   * currency, deposits with principal and interest apart, funds, liquid assets, money lent, property, retirement, cover, records
   * out of date), each with its basis, status, date and a link to the records behind it.
   */
  position: PositionCard[];
  attention: AttentionItem[];
  events: (UpcomingEvent & { daysLeft: number })[];
  /** how far ahead the events look, from Settings */
  eventDays: number;
  banks: {
    overview: BankOverview;
    lines: BankLine[];
    topShare: number | null;
    /** deposits past their date, waiting to be confirmed: in no figure (the money counts where it went) */
    maturedNotCounted: number;
  };
  deposits: {
    overview: BankOverview;
    banks: BankShare[];
    ladder: MaturityYear[];
    interest: DepositInterest;
    cover: { limit: number; uninsured: number; banksOver: number };
  };
  funds: FundSnapshot | null;
  goals: { list: GoalSummary[]; onTrack: number; withTarget: number };
  risks: RiskRow[];
  recent: HomeRecent[];
  openTasks: number;
}

/** Month ends the data reaches back to (before the month of today) that have no snapshot, recorded or rebuilt, in the month. */
function missingMonths(start: string | null, today: string, snaps: HomeSnapshot[]): number {
  if (!start) return 0;
  const have = new Set(snaps.map((s) => s.date.slice(0, 7)));
  let n = 0;
  for (let y = Number(start.slice(0, 4)), m = Number(start.slice(5, 7)); ;) {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    if (key >= today.slice(0, 7)) break;
    if (!have.has(key)) n++;
    if (++m > 12) {
      m = 1;
      y++;
    }
  }
  return n;
}

const cleanTitle = (s: string) => s.replace(/^\[[^\]]+\]\s*/, '');
const BANK_LINES = 5;

/** Turns what was loaded into the figures Home shows. Every figure comes from a function the other pages use too. */
export function buildHome(i: HomeInput): HomeModel {
  const nw = i.portfolio.netWorth;
  const today = i.today;
  const cfg = i.config;
  const todayDate = new Date(`${today}T00:00:00Z`);
  const counted = i.portfolio.valued.filter(isCounted);
  const rows = i.blocks.flatMap((b) =>
    b.sections.flatMap((s) => s.rows.map((r) => ({ ...r, bank: b.name, bankKey: b.key }))),
  );

  // --- the money in banks, over everything and over the deposits alone
  const overview = bankOverview(i.blocks, i.overview);
  const fdBlocks = fixedDepositBlocks(i.blocks);
  const depOverview = bankOverview(fdBlocks, {
    today: todayDate,
    soonDays: i.overview.soonDays,
    defaultSavingsRate: i.overview.defaultSavingsRate,
    ...(i.overview.tdsRate !== undefined ? { tdsRate: i.overview.tdsRate } : {}),
  });
  const bankMoney = i.blocks
    .filter((b) => b.key !== OTHER_HOLDINGS_KEY)
    .map((b) => ({ key: b.key, name: b.name, amount: b.totals.current }))
    .filter((b) => b.amount > 0)
    .sort((a, b) => b.amount - a.amount);
  const bankTotal = bankMoney.reduce((a, b) => a + b.amount, 0);
  const bankLines: BankLine[] = bankMoney.slice(0, BANK_LINES).map((b) => ({
    ...b,
    share: bankTotal > 0 ? b.amount / bankTotal : 0,
  }));
  const restAmount = bankMoney.slice(BANK_LINES).reduce((a, b) => a + b.amount, 0);
  if (restAmount > 0)
    bankLines.push({
      key: '__other',
      name: `${bankMoney.length - BANK_LINES} other banks`,
      amount: restAmount,
      share: bankTotal > 0 ? restAmount / bankTotal : 0,
    });
  const topBank = largestShare(bankMoney);

  // --- how it moved
  const trendPoints = [
    ...i.snapshots.filter((s) => s.date < today).map((s) => ({ date: s.date, value: s.total })),
    { date: today, value: nw.total },
  ];
  const fundsDay = i.inv && i.inv.household.dayPct !== null ? i.inv.household.dayAmount : 0;
  const dayAmount = overview.today.change + fundsDay;
  const dayBase = nw.total - dayAmount;
  const pace = paceFromSeries(trendPoints);
  const projection =
    pace && pace.months >= 2 && trendPoints.length >= 3
      ? linearPath(trendPoints[trendPoints.length - 1]!, pace.monthlyChange, 2)
      : [];
  const funds = i.inv && i.inv.household.funds > 0 ? i.inv : null;
  const fundRows: FundRow[] = funds ? funds.groups.flatMap((g) => g.funds) : [];
  // --- the four kinds of holding, and what each earned in each period
  // deposits past their date to confirm whose proceeds are NOT counted (probably already in another account, or assumed so); the
  // proceeds still awaiting confirmation are counted once in the deposits figure itself
  const awaitingRows = rows.filter((r) => r.fd?.listState === 'confirm' && !r.inNetWorth);
  const awaiting = {
    count: awaitingRows.length,
    invested: awaitingRows.reduce((a, r) => a + r.fd!.principal, 0),
    current: awaitingRows.reduce((a, r) => a + (r.current ?? 0), 0),
  };
  const fundsIn = funds
    ? {
        count: funds.household.funds,
        invested: funds.household.invested,
        value: funds.household.value,
        today: fundsDay,
        withoutStatement: fundRows.filter((f) => !f.hasStatement).length,
      }
    : null;
  const cardsIn = {
    netWorth: nw.total,
    fd: overview.parts.fd,
    fdToday: overview.today.fd,
    awaiting,
    cash: overview.parts.cash,
    cashToday: overview.today.savings,
    cashForeign: overview.foreign,
    othersHeld: overview.parts.others,
    funds: fundsIn,
  };
  const gains = positionGains({ position: i.position, recentDays: cfg.home.changeDays });
  const periods = gains.periods;
  const tiles = Object.fromEntries(gains.tiles.map((t) => [t.key, t])) as Record<
    GainPeriodKey,
    HeadlineTile
  >;
  const classList = classCards({
    ...cardsIn,
    earned: Object.fromEntries(
      periods.rows.map((r) => [r.key, r.cells.start.empty ? null : r.cells.start.profit]),
    ),
  });
  const sumOf = (f: (c: ClassCard) => number) => classList.reduce((a, c) => a + f(c), 0);
  // invested money is deposits and funds; the profit is on that money (core investedMoney, shared with the daily summary)
  const invested = investedMoney(classList, nw.total);

  const growth = growthSplit([
    {
      key: 'banks',
      label: 'Banks and deposits',
      invested: overview.invested,
      current: overview.current,
    },
    ...(funds
      ? [
          {
            key: 'funds',
            label: 'Mutual funds',
            invested: funds.household.invested,
            current: funds.household.value,
            approximate: fundRows.some((f) => !f.hasStatement),
          },
        ]
      : []),
  ]);

  // what changed since the start of the last N days, by kind of holding and by person: the position on that day, rebuilt from what is on
  // file (not from a saved snapshot, so it exists as far back as the data does)
  const startTile = tiles.recent;
  const then = gains.dataStarts ? positionAsOf(i.position, startTile.from) : null;
  const whatChanged =
    then && then.counted > 0
      ? {
          since: startTile.from,
          partial: startTile.clamped,
          change: nw.total - then.total,
          pct: then.total > 0 ? (nw.total - then.total) / then.total : null,
          kinds: moversBetween(
            foldByKind(then.byType as Record<string, number>),
            foldByKind(nw.byType as Record<string, number>),
            (k) => allocLabel(k as AllocShare['key']),
            4,
            1,
          ),
          people: moversBetween(
            then.byOwner,
            nw.byOwner,
            (k) => i.styles[k]?.name ?? 'Unknown',
            4,
            1,
          ),
        }
      : null;

  // --- where it is
  const allocation = allocationOf(nw.byType as Record<string, number>);
  const byPerson = Object.entries(nw.byOwner)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([ownerId, amount]) => ({ ownerId, amount, share: nw.total > 0 ? amount / nw.total : 0 }));
  const currencyAmounts: Record<string, number> = {};
  for (const v of counted) {
    const cur = i.currencyOf[v.assetId] ?? 'INR';
    currencyAmounts[cur] = (currencyAmounts[cur] ?? 0) + v.estimate!.estimatedAmount;
  }
  const currencies = toShares(currencyAmounts, {}, 4);

  // --- how fast it can be reached
  const runningDeposits = rows.filter(
    (r) => r.fd && r.status === 'active' && !r.fd.needsConfirmation,
  );
  const ladder = liquidityLadder({
    today,
    cashNow: overview.parts.cash.current,
    deposits: runningDeposits.map((r) => ({
      name: `${r.bank} ${r.code}`,
      maturityOn: r.fd!.maturityOn,
      amount: r.fd!.maturityAmount,
    })),
  });
  const within30 = ladder.find((s) => s.key === 'd30')!.cumulative;
  const cashAndDeposits = nw.byLiquidity.liquid;
  const most = raisableWithin(i.sources, today, cfg.liquidity.scenarioDays, cfg.liquidity.order);
  const free = raisableWithin(
    i.sources,
    today,
    cfg.liquidity.scenarioDays,
    cfg.liquidity.order,
    true,
  );
  const raise = most.map((m, k) => ({
    days: m.days,
    date: m.date,
    free: free[k]!.amount,
    most: m.amount,
  }));

  // --- what needs attention and what is coming
  const lines = Object.fromEntries(
    counted.map((v) => [v.assetId, i.portfolio.lines[v.assetId]!] as const),
  );
  const fresh = freshnessSummary(Object.values(lines));
  const stale = fresh.stale + fresh.missing;
  const cover = {
    limit: i.cover.limit,
    uninsured: i.cover.uninsured,
    banksOver: Object.values(i.cover.byBank).filter((b) => b.uninsured > 0).length,
  };
  const toConfirmRows = rows.filter((r) => r.fd?.listState === 'confirm');
  const dated = (d: string | null, kind: 'renewal' | 'ends', insurer: string) =>
    d ? [{ insurer, kind, on: d }] : [];
  const attention = attentionItems({
    today,
    toConfirm: {
      count: overview.toConfirm,
      amount: toConfirmRows.reduce((a, r) => a + (r.fd?.maturityAmount ?? 0), 0),
    },
    overdueLoans: i.receivables
      .filter((r) => !r.settled && r.daysOverdue > 0)
      .map((r) => ({ name: r.name, outstanding: r.outstanding, daysOverdue: r.daysOverdue })),
    maturingSoon: overview.soon,
    staleBalances: stale,
    noValue: nw.excluded.filter((e) => e.reason === 'no_valuation').length,
    uninsured: { amount: cover.uninsured, banks: cover.banksOver, limit: cover.limit },
    inboxReview: i.inboxReview,
    ...(i.toExplain ? { toExplain: i.toExplain } : {}),
    fundsNoPrice: i.fundsNoPrice,
    tasks: i.tasks.map((t) => ({ title: t.title, dueOn: t.dueOn })),
    taskDays: cfg.reminders.taskDays,
    policies: i.policies.flatMap((p) => [
      ...dated(p.renewalOn, 'renewal', p.insurer),
      ...dated(p.expiresOn, 'ends', p.insurer),
    ]),
    policyDays: cfg.reminders.policyDays,
  });

  // --- deposits
  const depositRows = fdBlocks.flatMap((b) => b.sections.flatMap((s) => s.rows));
  const interest = depositInterest(
    depositRows
      .filter((r) => r.fd && r.status === 'active' && !r.fd.needsConfirmation)
      .map((r) => ({
        principal: r.fd!.principal,
        rate: r.fd!.rate,
        bookedOn: r.fd!.bookedOn,
        maturityOn: r.fd!.maturityOn,
        compounding: r.fd!.compounding,
        payout: r.fd!.payout ?? null,
        bankMaturityAmount: r.fd!.bankMaturityAmount ?? null,
        endedOn: r.fd!.endedOn,
      })),
    today,
  );

  const maturingByDay = new Map<string, typeof runningDeposits>();
  for (const r of runningDeposits)
    maturingByDay.set(r.fd!.maturityOn, [...(maturingByDay.get(r.fd!.maturityOn) ?? []), r]);
  const events = upcomingEvents(
    [
      ...[...maturingByDay.entries()].map(([date, list]): UpcomingEvent => {
        const first = list[0]!;
        const amount = list.reduce((a, r) => a + r.fd!.maturityAmount, 0);
        return list.length === 1
          ? {
              date,
              kind: 'deposit',
              title: `${first.bank} ${first.code} matures`,
              amount,
              href: `/asset/${first.assetId}`,
            }
          : {
              date,
              kind: 'deposit',
              title: `${list.length} deposits mature (${first.bank} and ${list.length - 1} more)`,
              amount,
              href: '/deposits?tab=maturities',
            };
      }),
      ...i.policies.flatMap((p) =>
        [
          p.renewalOn ? { d: p.renewalOn, w: 'renews' } : null,
          p.expiresOn ? { d: p.expiresOn, w: 'ends' } : null,
        ]
          .filter((e): e is { d: string; w: string } => !!e)
          .map((e): UpcomingEvent => ({
            date: e.d,
            kind: 'policy',
            title: `${p.insurer} policy ${e.w}`,
            href: `/policy/${p.id}`,
          })),
      ),
      ...i.tasks.map((t): UpcomingEvent => ({
        date: t.dueOn,
        kind: 'task',
        title: cleanTitle(t.title),
        href: `/tasks/${t.id}`,
      })),
      ...i.receivables
        .filter((r) => !r.settled && r.expectedOn)
        .map((r): UpcomingEvent => ({
          date: r.expectedOn!,
          kind: 'receivable',
          title: `${r.name} to repay`,
          amount: r.outstanding,
          href: '/others',
        })),
      {
        date: interest.fyEnd,
        kind: 'tax',
        title: 'Financial year ends: use the tax-free gain on funds',
        href: '/tax',
      },
    ],
    today,
    cfg.home.upcomingDays,
    8,
  );

  // --- funds
  const fundSnapshot: FundSnapshot | null = funds
    ? {
        totals: funds.household,
        people: funds.groups.map((g) => ({ ownerId: g.ownerId, totals: g.totals })),
        sparkline: funds.series.slice(-24).map((p) => p.value),
        bestWorst: bestAndWeakest(
          fundRows.map((f) => ({
            assetId: f.assetId,
            name: f.name,
            xirr: f.xirr,
            estimated: f.xirrEstimated,
          })),
        ),
        statements: {
          withStatement: fundRows.filter((f) => f.hasStatement).length,
          total: fundRows.length,
        },
        pace: i.pace,
        growth: { invested: funds.household.invested, gain: funds.household.gain },
      }
    : null;

  const goalsWithTarget = i.goals.filter((g) => g.proj.status !== 'no_target').length;

  // --- risks
  const kindTop = largestShare(allocation)?.row;
  const risks: RiskRow[] = [
    {
      key: 'cover',
      label: 'Deposit insurance',
      verdict: cover.uninsured > 0 ? 'watch' : 'ok',
      value: cover.uninsured > 0 ? 'Above the limit' : 'Within the limit',
      note:
        cover.uninsured > 0
          ? `${cover.banksOver} ${cover.banksOver === 1 ? 'bank holds' : 'banks hold'} more than the insured limit per name`
          : 'every bank is within the insured limit per name',
      href: '/deposits?tab=cover',
    },
    ...(topBank
      ? [
          {
            key: 'bank',
            label: 'Largest bank',
            verdict: topBank.share > cfg.home.bankShareWatch ? 'watch' : 'ok',
            value: `${Math.round(topBank.share * 100)}%`,
            note: `${topBank.row.name} of the money kept in banks`,
            href: `/bank/${topBank.row.key}`,
          } satisfies RiskRow,
        ]
      : []),
    ...(kindTop
      ? [
          {
            key: 'kind',
            label: 'Largest kind of holding',
            verdict: 'info',
            value: `${Math.round(kindTop.share * 100)}%`,
            note: `${kindTop.label}, of net worth`,
            href: null,
          } satisfies RiskRow,
        ]
      : []),
  ];
  const overdue = i.receivables.filter((r) => !r.settled && r.daysOverdue > 0);
  if (overdue.length > 0)
    risks.push({
      key: 'lent',
      label: 'Money lent',
      verdict: 'watch',
      value: `${overdue.length} overdue`,
      note: 'repayment date passed',
      href: '/others',
    });

  // --- the family ledger: own money, profit, return, and the chosen period's movement
  const ledger = capitalLedger({
    position: i.position,
    moves: i.moves ?? [],
    openingDate: cfg.capital.openingDate || null,
    reinvestDays: cfg.harvest.reinvestDays,
  });
  const views = fundViews(i.position, {
    navStaleDays: cfg.funds.navStaleDays,
    upcomingDays: cfg.home.upcomingDays,
  });
  const proceedsRows = i.portfolio.valued.filter(
    (v) => v.estimate?.method === 'fd_proceeds' && isCounted(v),
  );
  const mixParts = positionAsOf(i.position, today)
    .holdings.filter(isHeld)
    .map((h) => ({
      kind: h.deposit?.proceeds ? ('estimate' as const) : kindOfBasis(h.basis, !h.estimated),
      value: h.value ?? 0,
    }));
  const capital: HomeCapital = {
    totals: ledger.totals,
    opening: ledger.opening,
    limitations: ledger.limitations,
    movement: wealthMovement(ledger, i.movement?.key ?? 'fy', today, i.movement?.custom),
    funds: {
      confirmed: views.confirmed,
      estimated: views.estimated,
      projected: views.projected,
      staleCount: views.staleCount,
      oldestNav: views.oldestNav,
      unconfirmedFunds: views.unconfirmedFunds,
      upcoming: views.upcoming.slice(0, 6),
      navStaleDays: cfg.funds.navStaleDays,
    },
    proceeds: {
      count: proceedsRows.length,
      amount: proceedsRows.reduce((a, v) => a + (v.estimate?.estimatedAmount ?? 0), 0),
    },
    mix: mixOf(mixParts).by,
    abroad: (() => {
      const after = (i.abroad ?? []).filter((x) => !ledger.opening || x.date > ledger.opening.date);
      return { count: after.length, amount: after.reduce((a, x) => a + x.amount, 0) };
    })(),
  };

  // --- How is my money growing? and the extras
  const fyMove = wealthMovement(ledger, 'fy', today);
  const yearlyFd = depositsXirr(
    runningDeposits.map((r) => ({
      principal: r.fd!.principal,
      bookedOn: r.fd!.bookedOn,
      value: r.current ?? 0,
    })),
    today,
  );
  const yearlyFunds: ClassYearly | null =
    fundSnapshot && fundSnapshot.totals.xirr !== null
      ? {
          rate: fundSnapshot.totals.xirr,
          kind: 'xirr',
          estimated: !!fundSnapshot.totals.xirrEstimated,
          basis: 'money-weighted, from the funds’ purchases and sales',
        }
      : null;
  const cashNow = overview.parts.cash.current;
  const savingsEarned = fyMove.figures
    ? savingsRateEarned(fyMove.figures.earnings.savings, cashNow, fyMove.from, today)
    : null;
  const classValue = (k: ClassCard['key']) => classList.find((c) => c.key === k)?.current ?? 0;
  const fdPart = { key: 'fd', value: classValue('fd'), rate: yearlyFd?.rate ?? null };
  const cashPart = { key: 'cash', value: classValue('cash'), rate: savingsEarned?.rate ?? null };
  const allRate = earningRateNow([
    fdPart,
    { key: 'funds', value: classValue('funds'), rate: yearlyFunds?.rate ?? null },
    cashPart,
    { key: 'others', value: classValue('others'), rate: 0 },
  ]);
  const bankRate = earningRateNow([fdPart, cashPart]);
  const depositTerms = runningDeposits.map((r) => ({
    principal: r.fd!.principal,
    maturityOn: r.fd!.maturityOn,
    maturityAmount: r.fd!.maturityAmount,
  }));
  const due30 = maturingWithin(depositTerms, today, LADDER_DAYS.d30);
  const due90 = maturingWithin(depositTerms, today, LADDER_DAYS.d90);
  const typeAmount = (k: string) => overview.accountTypes.find((t) => t.key === k)?.amount ?? 0;
  const growthNow: HomeGrowth = {
    all: allRate ? { rate: allRate.rate, perYear: allRate.perYear } : null,
    banks: bankRate ? { rate: bankRate.rate, perYear: bankRate.perYear } : null,
    fd: yearlyFd?.rate ?? null,
    funds: yearlyFunds?.rate ?? null,
    savings: savingsEarned,
    own: { rate: ledger.totals.xirr.rate, since: ledger.opening?.date ?? null },
    inflation: i.inflation ?? null,
  };
  const extras: HomeExtras = {
    earnedFy: fyMove.figures
      ? {
          total: fyMove.figures.earnings.total,
          pct:
            fyMove.figures.start > 0 ? fyMove.figures.earnings.total / fyMove.figures.start : null,
          deposits: fyMove.figures.earnings.deposits,
          funds: fyMove.figures.earnings.funds,
          savings: fyMove.figures.earnings.savings,
          other:
            fyMove.figures.earnings.total -
            fyMove.figures.earnings.deposits -
            fyMove.figures.earnings.funds -
            fyMove.figures.earnings.savings,
        }
      : null,
    available30: { total: cashNow + due30.principal, cash: cashNow, deposits: due30.principal },
    maturing30: { count: due30.count, principal: due30.principal },
    maturing90: { count: due90.count, principal: due90.principal },
    aboveInsured: {
      amount: i.cover.uninsured,
      banks: Object.values(i.cover.byBank).filter((b) => b.uninsured > 0).length,
      limit: cover.limit,
    },
    nre: typeAmount('NRE'),
    nro: typeAmount('NRO'),
  };

  return {
    capital,
    growth: growthNow,
    extras,
    today,
    styles: i.styles,
    total: nw.total,
    money: {
      current: nw.total,
      maturity: sumOf((c) => c.maturity),
      invested: invested.invested,
      profit: invested.profit,
      profitPct: invested.profitPct,
      valueOfInvested: invested.valueOfInvested,
      parts: invested.parts,
      estimated: invested.estimated,
    },
    classes: classList,
    yearly: {
      fd: yearlyFd,
      funds: yearlyFunds,
      // the rate savings earned this financial year; the rate on file when the year has no figures yet
      cash: savingsEarned ?? cashYearly(cashNow, overview.today.savings),
      others: null,
    },
    periods,
    fundNote: fundLedgerNote(periods.basis, cfg.funds.noLedgerNoteAbove),
    assumptions: {
      savingsRate: cfg.estimates.savingsRate,
      tdsRate: cfg.estimates.interestTdsRate,
    },
    counted: nw.counted,
    people: Object.keys(nw.byOwner).length,
    asOf: i.newestRecorded,
    change: {
      today: {
        amount: dayAmount,
        pct: dayBase > 0 ? dayAmount / dayBase : null,
        banks: overview.today.change,
        funds: fundsDay,
      },
      monthDays: cfg.home.changeDays,
      fyStart: periods.windows.find((w) => w.key === 'fy')!.asked,
    },
    tiles,
    dataStarts: gains.dataStarts,
    trust: valueTrust(i.portfolio.valued, i.portfolio.lines),
    trustDetail: {
      fresh,
      assumptions: counted.filter((v) => i.portfolio.lines[v.assetId]?.usedAssumption).length,
      byBasis: nw.estimateTotals.byBasis,
      statements: fundSnapshot ? fundSnapshot.statements : null,
    },
    allocation,
    byPerson,
    currencies,
    trend: {
      range: i.range,
      view: rangeView(trendPoints, i.range, today),
      all: trendPoints,
      pace,
      projection,
      growth,
      history: trendPoints.length,
      rebuilt: i.snapshots.filter((s) => s.source === 'rebuilt').length,
      missingMonths: missingMonths(gains.dataStarts, today, i.snapshots),
    },
    whatChanged,
    position: moneyPosition({
      today,
      total: nw.total,
      byType: nw.byType as Record<string, number>,
      byOwner: nw.byOwner,
      ownerName: Object.fromEntries(Object.entries(i.styles).map(([k, v]) => [k, v.name])),
      classes: classList,
      foreign: overview.foreign,
      maturities: runningDeposits.map((r) => ({
        daysLeft: Math.round(
          (Date.parse(`${r.fd!.maturityOn}T00:00:00Z`) - todayDate.getTime()) / 86_400_000,
        ),
        amount: r.fd!.maturityAmount,
      })),
      maturityWindows: cfg.deposits.maturityAlertDays,
      freshness: { stale: fresh.stale, missing: fresh.missing, total: fresh.total },
      monthlySpending: i.monthlySpending,
      snapshots: i.snapshots.filter((s) => s.date < today),
    }),
    liquidity: {
      ladder,
      ladderTotal: ladder[ladder.length - 1]!.cumulative,
      within30,
      raise,
      cashAndDeposits,
      months: i.monthlySpending > 0 ? cashAndDeposits / i.monthlySpending : null,
      monthlySpending: i.monthlySpending,
    },
    attention,
    events,
    eventDays: cfg.home.upcomingDays,
    banks: {
      overview,
      lines: bankLines,
      topShare: topBank?.share ?? null,
      maturedNotCounted: toConfirmRows.reduce((a, r) => a + (r.fd?.maturityAmount ?? 0), 0),
    },
    deposits: {
      overview: depOverview,
      banks: depositsByBank(fdBlocks, today),
      ladder: maturityLadder(fdBlocks),
      interest,
      cover,
    },
    funds: fundSnapshot,
    goals: {
      list: i.goals,
      onTrack: i.goals.filter((g) => g.proj.status === 'on_track').length,
      withTarget: goalsWithTarget,
    },
    risks,
    recent: i.recent,
    openTasks: i.openTasks,
  };
}
