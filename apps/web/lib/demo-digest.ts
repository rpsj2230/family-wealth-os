/**
 * The public sample of the daily summary e-mail: the invented household of /demo/dashboard (its banks, deposits, funds and goals),
 * put through the same assembly the real summary uses, plus a few extra invented goals so every state (on track, ahead, behind,
 * not enough data) can be seen. Nothing here is real and everything is deterministic.
 */
import {
  DEFAULT_SETTINGS,
  assembleDigest,
  bankOverview,
  depositCover,
  holdingsFromAssets,
  summariseGoals,
  type DigestInput,
  type DigestSources,
  type GoalSummary,
} from '@fwos/core';
import { demoModel } from './demo-fixture';
import { demoHomeInput } from './demo-home';
import type { HomeInput } from './home';

/** The funds as the digest counts them, read from the same view Home draws. */
export function digestFunds(inv: HomeInput['inv']): DigestSources['funds'] {
  if (!inv || inv.household.funds <= 0) return null;
  const rows = inv.groups.flatMap((g) => g.funds);
  return {
    count: inv.household.funds,
    invested: inv.household.invested,
    value: inv.household.value,
    today: inv.household.dayPct !== null ? inv.household.dayAmount : 0,
    withoutStatement: rows.filter((f) => !f.hasStatement).length,
  };
}

/** Everything the summary is built from, for the invented household. */
export function demoDigestSources(over: Partial<DigestSources> = {}): DigestSources {
  const h = demoHomeInput('1Y');
  const extra: GoalSummary[] = summariseGoals({
    goals: [
      {
        id: 'g4',
        name: 'Emergency fund',
        kind: 'emergency',
        targetAmount: 900_000,
        targetDate: '2027-03-31',
        inflationRate: null,
      },
      {
        id: 'g5',
        name: 'Family holiday',
        kind: 'other',
        targetAmount: null,
        targetDate: null,
        inflationRate: null,
      },
    ],
    allocations: [{ goalId: 'g4', assetId: 'x', method: 'amount', value: 1_400_000 }],
    values: new Map([['x', 2_000_000]]),
    sips: new Map(),
    today: h.today,
  });
  const names = Object.fromEntries(Object.entries(h.styles).map(([id, st]) => [id, st.name]));
  return {
    date: h.today,
    householdName: 'Sample household',
    appUrl: 'https://wealth.example.test',
    config: h.config,
    portfolio: h.portfolio,
    blocks: h.blocks,
    overview: bankOverview(h.blocks, h.overview),
    cover: depositCover({
      assets: demoModel().assets,
      valued: h.portfolio.valued,
      jointHolders: {},
      outside: new Set(),
      limit: h.config.deposits.insuranceLimit,
    }),
    funds: digestFunds(h.inv),
    snapshots: h.snapshots,
    ownerNames: names,
    newestRecorded: h.newestRecorded,
    lastBankBalanceAsOf: '2026-10-24',
    market: { navLatest: '2026-10-23', fx: { SGD: { rate: 74.263, date: '2026-10-23' } } },
    goals: [...h.goals, ...extra],
    retirement: {
      settings: {
        ...DEFAULT_SETTINGS,
        primaryDob: '1990-01-01',
        spouseDob: '1993-01-01',
        monthlySpendingToday: 150_000,
        retireAtAge: 55,
      },
      holdings: holdingsFromAssets(h.portfolio.valued),
      sipMonthly: 115_000,
    },
    attention: {
      overdueLoans: h.receivables
        .filter((r) => !r.settled && r.daysOverdue > 0)
        .map((r) => ({ name: r.name, outstanding: r.outstanding, daysOverdue: r.daysOverdue })),
      tasks: h.tasks.map((t) => ({ title: t.title, dueOn: t.dueOn })),
      policies: h.policies.flatMap((p) => [
        ...(p.renewalOn ? [{ insurer: p.insurer, kind: 'renewal' as const, on: p.renewalOn }] : []),
        ...(p.expiresOn ? [{ insurer: p.insurer, kind: 'ends' as const, on: p.expiresOn }] : []),
      ]),
      inboxReview: h.inboxReview,
    },
    taxIdeas: ['Tax harvest for Beena: 140 days left to use the tax-free gain on equity funds.'],
    rateIdeas: [],
    staleRates: 2,
    monthly: null,
    ...over,
  };
}

/** The invented summary the sample page and the browser test draw. */
export function demoDigestInput(over: Partial<DigestSources> = {}): DigestInput {
  return assembleDigest(demoDigestSources(over));
}
