/**
 * Puts the daily summary's input together from the pieces the portal already works out (the bank blocks and overview, the funds'
 * totals, the saved days of net worth, the goal summaries, the retirement settings). Pure. The data layer reads the rows and calls
 * this; the public sample calls it with invented rows; both go through the same functions Home, Goals and "Can I retire now?" use,
 * so a number in the e-mail is the number on the page.
 */
import type { BankBlock } from './accounts-view';
import type { BankOverview } from './bank-overview';
import type { AppConfig } from './config';
import { goalCard, retirementCard } from './digest-goals';
import type { DigestInput } from './digest';
import { biggestMaturities, digestWealth, type DigestWealthInput } from './digest-wealth';
import type { GoalSummary } from './goal-summary';
import {
  allocLabel,
  attentionItems,
  foldByKind,
  moversBetween,
  netWorthChanges,
  type AllocKey,
} from './home';
import { freshnessSummary } from './dashboard';
import { isCounted } from './networth';
import type { Portfolio } from './portfolio';
import { assess, earliestRetirementAge, monteCarlo } from './retirement';
import { buildPlan, type Holdings, type PlanSettings } from './planning';
import { positionAsOf, positionGains, type PositionInput } from './position';

/** Why the retirement view reads as it does, in words (the same as the portal's three states). */
const STATUS_TEXT = {
  meets_plan: 'projected to meet the plan under your assumptions',
  shortfall: 'projected shortfall under your assumptions',
  insufficient_data: 'insufficient data to assess',
} as const;

/** The seed and the number of paths "Can I retire now?" uses for its Monte Carlo run: the same seed gives the same answer. */
export const MONTE_CARLO_SEED = 20261026;

export interface DigestSources {
  date: string;
  householdName: string;
  appUrl: string;
  config: AppConfig;
  portfolio: Portfolio;
  /** the bank blocks and bankOverview() of them for the whole household, built the way Home builds them */
  blocks: BankBlock[];
  overview: BankOverview;
  funds: DigestWealthInput['funds'];
  /** money above the deposit-insurance limit (`depositCover`) */
  cover: { limit: number; uninsured: number; banksOver: number };
  /** earlier saved days of net worth, oldest first, today excluded */
  snapshots: {
    date: string;
    total: number;
    byType: Record<string, number>;
    byOwner: Record<string, number>;
  }[];
  ownerNames: Record<string, string>;
  newestRecorded: string | null;
  lastBankBalanceAsOf: string | null;
  market: DigestInput['market'];
  /** one summary per goal; null leaves the goals out (Settings: Include the goals view) */
  goals: GoalSummary[] | null;
  /** the saved retirement plan and what it is built from; null leaves the retirement view out */
  retirement: { settings: PlanSettings; holdings: Holdings; sipMonthly: number } | null;
  attention: {
    overdueLoans: { name: string; outstanding: number; daysOverdue: number }[];
    tasks: { title: string; dueOn: string }[];
    policies: { insurer: string; kind: 'renewal' | 'ends'; on: string }[];
    inboxReview: number;
    /** held funds with no price source, not marked "not a listed fund" */
    fundsNoPrice?: number;
  };
  taxIdeas: string[];
  rateIdeas: string[];
  /** bank rates not checked within Settings' stale days */
  staleRates: number;
  monthly: DigestInput['monthly'];
  /**
   * What the position engine reads (records, deposit terms, fund ledgers and prices). With it, the last N days and the moves by kind
   * and by person are what Home shows: earnings from the records on file, not the change between two saved snapshots. Without it
   * they fall back to the saved snapshots.
   */
  position?: PositionInput;
}

export function assembleDigest(s: DigestSources): DigestInput {
  const cfg = s.config;
  const nw = s.portfolio.netWorth;
  const rows = s.blocks.flatMap((b) =>
    b.sections.flatMap((sc) => sc.rows.map((r) => ({ ...r, bank: b.name }))),
  );
  const wealth = digestWealth({
    netWorth: nw.total,
    blocks: s.blocks,
    overview: s.overview,
    funds: s.funds,
  });

  // how it moved: Home's trend, month change and what changed by kind and by person
  const trend = [
    ...s.snapshots.filter((x) => x.date < s.date).map((x) => ({ date: x.date, value: x.total })),
    { date: s.date, value: nw.total },
  ];
  const gains = s.position
    ? positionGains({ position: s.position, recentDays: cfg.home.changeDays })
    : null;
  const recent = gains?.tiles.find((t) => t.key === 'recent') ?? null;
  const changes = netWorthChanges(trend, s.date, cfg.home.changeDays);
  const earlier = s.snapshots.filter((x) => x.date < s.date);
  const prev = earlier[earlier.length - 1];
  const fromSnap = changes.month ? s.snapshots.find((x) => x.date === changes.month!.from) : null;
  // the position on the first day of the period, rebuilt from the records on file; else the snapshot nearest to it
  const rebuilt =
    s.position && recent && gains?.dataStarts ? positionAsOf(s.position, recent.from) : null;
  const from =
    rebuilt && rebuilt.counted > 0
      ? {
          date: recent!.from,
          byType: rebuilt.byType as Record<string, number>,
          byOwner: rebuilt.byOwner,
        }
      : fromSnap && Object.keys(fromSnap.byType).length > 0
        ? fromSnap
        : null;
  const max = cfg.digest.changesMax;

  // what needs the person, in Home's order, then the tax and rate lines
  const counted = s.portfolio.valued.filter(isCounted);
  const fresh = freshnessSummary(
    counted.flatMap((v) => (s.portfolio.lines[v.assetId] ? [s.portfolio.lines[v.assetId]!] : [])),
  );
  const late = fresh.stale + fresh.missing;
  const toConfirm = rows.filter((r) => r.fd?.listState === 'confirm');
  const cover = s.cover;
  const items = attentionItems({
    today: s.date,
    toConfirm: {
      count: s.overview.toConfirm,
      amount: toConfirm.reduce((a, r) => a + (r.fd?.maturityAmount ?? 0), 0),
    },
    overdueLoans: s.attention.overdueLoans,
    maturingSoon: s.overview.soon,
    staleBalances: late,
    noValue: nw.excluded.filter((e) => e.reason === 'no_valuation').length,
    uninsured: {
      amount: cover.uninsured,
      banks: cover.banksOver,
      limit: cover.limit,
    },
    inboxReview: s.attention.inboxReview,
    fundsNoPrice: s.attention.fundsNoPrice ?? 0,
    tasks: s.attention.tasks,
    taskDays: cfg.reminders.taskDays,
    policies: s.attention.policies,
    policyDays: cfg.reminders.policyDays,
  });
  const needsYou: NonNullable<DigestInput['needsYou']> = [
    ...items.map((x) => ({ text: x.text, href: x.href, tone: x.tone })),
    ...s.taxIdeas.map((text) => ({ text, href: '/tax', tone: 'warn' as const })),
    ...s.rateIdeas.map((text) => ({
      text: `Better rate: ${text}`,
      href: '/rates',
      tone: 'info' as const,
    })),
    ...(s.staleRates > 0
      ? [
          {
            text:
              s.staleRates === 1
                ? `The rate for 1 bank is older than ${cfg.rates.staleDays} days: refresh it in Rates.`
                : `Rates for ${s.staleRates} banks are older than ${cfg.rates.staleDays} days: refresh them in Rates.`,
            href: '/rates',
            tone: 'info' as const,
          },
        ]
      : []),
  ];

  // goals and retirement
  let retirement: DigestInput['retirement'] = null;
  const r = s.retirement;
  if (r && r.settings.monthlySpendingToday > 0 && r.settings.primaryDob) {
    const plan = buildPlan(r.settings, r.holdings, r.sipMonthly, s.date);
    const readiness = assess(plan, r.settings.assumptions);
    const earliest =
      readiness.status === 'insufficient_data'
        ? null
        : earliestRetirementAge(plan, r.settings.assumptions).earliest;
    const mc =
      readiness.status !== 'insufficient_data' && cfg.digest.monteCarloRuns > 0
        ? monteCarlo(plan, r.settings.assumptions, cfg.digest.monteCarloRuns, MONTE_CARLO_SEED)
        : null;
    retirement = {
      statusText: STATUS_TEXT[readiness.status],
      earliestAge: earliest === null ? null : Math.round(earliest * 10) / 10,
      card: retirementCard({
        plan,
        assumptions: r.settings.assumptions,
        readiness,
        monteCarlo: mc,
        earliestAge: earliest,
        aheadMargin: cfg.digest.aheadMargin,
      }),
    };
  }

  // retirement is one of the goals: when its own card is shown, a goal of the retirement kind is not listed twice
  const goals = s.goals
    ? s.goals
        .filter((g) => !(retirement?.card && g.kind === 'retirement'))
        .map((g) => goalCard(g, cfg.digest.aheadMargin))
    : null;
  const dated = s.attention.tasks.map((t) => ({ title: t.title, dueOn: t.dueOn }));
  return {
    date: s.date,
    householdName: s.householdName,
    netWorth: nw,
    ownerNames: s.ownerNames,
    previous: prev ? { date: prev.date, total: prev.total } : null,
    lastBankBalanceAsOf: s.lastBankBalanceAsOf,
    attention: {
      maturedUnconfirmed: toConfirm.map((r) => `${r.bank} ${r.code}`),
      maturingSoon: biggestMaturities(s.blocks, s.overview.soon.days, 50).map((m) => ({
        name: m.name,
        daysLeft: m.daysLeft,
        amount: m.amount,
      })),
      overdueLoans: s.attention.overdueLoans,
      staleOrMissing: late,
      policyDates: s.attention.policies,
      tasksDue: dated,
    },
    market: s.market,
    retirement,
    appUrl: s.appUrl,
    reminders: { policyDays: cfg.reminders.policyDays, taskDays: cfg.reminders.taskDays },
    rateIdeas: s.rateIdeas,
    taxIdeas: s.taxIdeas,
    monthly: s.monthly ?? null,
    wealth,
    asOf: s.newestRecorded,
    lateInputs: late,
    goals,
    needsYou,
    month: recent
      ? { amount: recent.amount, pct: recent.pct, from: recent.from, partial: recent.clamped }
      : changes.month,
    changes: {
      since: from?.date ?? changes.month?.from ?? s.date,
      partial: recent ? recent.clamped : !!changes.month?.partial,
      kinds: from
        ? moversBetween(
            foldByKind(from.byType),
            foldByKind(nw.byType as Record<string, number>),
            (k) => allocLabel(k as AllocKey),
            max,
            1,
          )
        : [],
      people: from
        ? moversBetween(from.byOwner, nw.byOwner, (k) => s.ownerNames[k] ?? 'Unknown', max, 1)
        : [],
      maturities: biggestMaturities(s.blocks, cfg.reminders.maturitySoonDays, max),
      maturityDays: cfg.reminders.maturitySoonDays,
    },
    limits: { needsYouMax: cfg.digest.needsYouMax },
  };
}
