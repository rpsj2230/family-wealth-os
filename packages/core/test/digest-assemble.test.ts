import { describe, expect, it } from 'vitest';
import { buildBankBlocks } from '../src/accounts-view';
import { bankOverview } from '../src/bank-overview';
import { savingsRatesOf } from '../src/cash-rates';
import { DEFAULT_CONFIG } from '../src/config';
import { assembleDigest, type DigestSources } from '../src/digest-assemble';
import { buildDigestEmail } from '../src/digest-email';
import { biggestMaturities, depositCover, digestWealth } from '../src/digest-wealth';
import { summariseGoals } from '../src/goal-summary';
import { DEFAULT_SETTINGS, holdingsFromAssets } from '../src/planning';
import { buildPortfolio, type AssetRow, type FdRow, type ObservationRow } from '../src/portfolio';

const iso = '2026-10-27';
const today = new Date(`${iso}T00:00:00Z`);
const asset = (o: Partial<AssetRow> & { id: string }): AssetRow => ({
  owner_id: 'r',
  type: 'bank_account',
  status: 'active',
  nickname: o.id,
  currency: 'INR',
  account_kind: 'NRE',
  expected_freshness_days: 35,
  institution_id: 'eq',
  ...o,
});
const obs = (o: Partial<ObservationRow> & { id: string; asset_id: string }): ObservationRow => ({
  kind: 'balance',
  amount: 100_000,
  currency: 'INR',
  fx_rate: null,
  as_of: '2026-10-25',
  confidence: 'manual_confirmed',
  source: 'manual',
  created_at: '2026-10-25T00:00:00Z',
  superseded_by: null,
  ...o,
});
const fd = (id: string, o: Partial<FdRow> = {}): FdRow => ({
  asset_id: id,
  principal: 500_000,
  rate: 0.08,
  booked_on: '2026-01-10',
  maturity_on: '2027-10-26',
  compounding: 'quarterly',
  bank_maturity_amount: null,
  ...o,
});

const assets: AssetRow[] = [
  asset({ id: 'cash', sort_order: 1, identifier_last4: '1111' }),
  asset({ id: 'fd1', type: 'fixed_deposit', account_kind: null, sort_order: 2 }),
  asset({ id: 'fd2', type: 'fixed_deposit', account_kind: null, sort_order: 3 }),
  asset({ id: 'fd3', type: 'fixed_deposit', account_kind: null, sort_order: 4 }),
  asset({ id: 'old', type: 'fixed_deposit', account_kind: null, sort_order: 5 }),
  asset({ id: 'mf', type: 'mutual_fund', account_kind: null, institution_id: null, sort_order: 6 }),
  asset({ id: 'flat', type: 'property', account_kind: null, institution_id: null, sort_order: 7 }),
];
const observations: ObservationRow[] = [
  obs({ id: '1', asset_id: 'cash', amount: 600_000 }),
  obs({ id: '2', asset_id: 'mf', amount: 1_900_000, source: 'cas' }),
  obs({ id: '3', asset_id: 'flat', amount: 5_000_000 }),
];
const fds: FdRow[] = [
  fd('fd1', { principal: 1_000_000, maturity_on: '2027-10-26' }),
  fd('fd2', { principal: 600_000, maturity_on: '2026-11-05', bank_maturity_amount: 640_000 }),
  fd('fd3', { principal: 300_000, maturity_on: '2026-11-20' }),
  fd('old', { principal: 200_000, booked_on: '2025-10-01', maturity_on: '2026-10-01' }),
];
const portfolio = buildPortfolio(assets, observations, fds, today);
const blocks = buildBankBlocks({
  assets,
  observations,
  fds,
  portfolio,
  institutionNames: { eq: 'Equitas' },
  today,
});
const overview = bankOverview(blocks, {
  today,
  soonDays: 30,
  defaultSavingsRate: 0.03,
  tdsRate: 0.1,
  insuranceLimit: 500_000,
});
const fundsIn = {
  count: 1,
  invested: 1_500_000,
  value: 1_900_000,
  today: 12_000,
  withoutStatement: 0,
};

const goals = summariseGoals({
  goals: [
    {
      id: 'g1',
      name: 'Education',
      kind: 'education',
      targetAmount: 1_500_000,
      targetDate: '2032-06-01',
      inflationRate: null,
    },
    {
      id: 'g2',
      name: 'Retirement pot',
      kind: 'retirement',
      targetAmount: 20_000_000,
      targetDate: '2046-01-01',
      inflationRate: null,
    },
  ],
  allocations: [
    { goalId: 'g1', assetId: 'mf', method: 'percent', value: 50 },
    { goalId: 'g2', assetId: 'mf', method: 'percent', value: 50 },
  ],
  values: new Map([['mf', 1_900_000]]),
  sips: new Map([['mf', 30_000]]),
  today: iso,
});
const retirementSettings = {
  settings: {
    ...DEFAULT_SETTINGS,
    primaryDob: '1982-04-10',
    spouseDob: '1984-01-01',
    monthlySpendingToday: 90_000,
    retireAtAge: 58,
  },
  holdings: holdingsFromAssets(portfolio.valued),
  sipMonthly: 30_000,
};

const sources = (o: Partial<DigestSources> = {}): DigestSources => ({
  date: iso,
  householdName: 'Our household',
  appUrl: 'https://wealth.example.test',
  config: { ...DEFAULT_CONFIG, digest: { ...DEFAULT_CONFIG.digest, monteCarloRuns: 200 } },
  portfolio,
  blocks,
  overview,
  funds: fundsIn,
  cover: { limit: 500_000, uninsured: 0, banksOver: 0 },
  snapshots: [
    {
      date: '2026-09-20',
      total: 8_000_000,
      byType: {
        bank_account: 700_000,
        fixed_deposit: 2_000_000,
        mutual_fund: 1_600_000,
        property: 4_500_000,
      },
      byOwner: { r: 8_000_000 },
    },
    { date: '2026-10-26', total: 9_000_000, byType: {}, byOwner: {} },
  ],
  ownerNames: { r: 'Rupash' },
  newestRecorded: '2026-10-25',
  lastBankBalanceAsOf: '2026-10-25',
  market: { navLatest: '2026-10-24', fx: {} },
  goals,
  retirement: retirementSettings,
  attention: {
    overdueLoans: [],
    tasks: [{ title: 'Pay premium', dueOn: '2026-10-30' }],
    policies: [],
    inboxReview: 0,
  },
  taxIdeas: ['Tax harvest for Rupash: 140 days left.'],
  rateIdeas: ['Moving ₹5,00,000 earns ₹9,000 more a year.'],
  staleRates: 2,
  monthly: null,
  ...o,
});

describe('assembleDigest: the money figures are the portal’s', () => {
  const i = assembleDigest(sources());
  const w = i.wealth!;

  it('the four kinds add up to net worth exactly', () => {
    expect(w.total).toBe(portfolio.netWorth.total);
    expect(w.classes.map((c) => c.key).sort()).toEqual(['cash', 'fd', 'funds', 'others']);
    expect(w.classes.reduce((a, c) => a + c.current, 0)).toBeCloseTo(w.total, 4);
    expect(w.classes.reduce((a, c) => a + c.share, 0)).toBeCloseTo(1, 8);
  });

  it('today is what the banks earned plus the funds’ move, as a share of yesterday’s value', () => {
    expect(w.today.banks).toBeCloseTo(overview.today.change, 8);
    expect(w.today.funds).toBe(12_000);
    expect(w.today.amount).toBeCloseTo(overview.today.change + 12_000, 8);
    expect(w.today.pct).toBeCloseTo(w.today.amount / (w.total - w.today.amount), 10);
  });

  it('overall profit is value less money put in, summed over the four kinds, as Home’s headline does', () => {
    expect(w.overall.profit).toBeCloseTo(
      w.classes.reduce((a, c) => a + c.profit, 0),
      6,
    );
    expect(w.overall.invested).toBeCloseTo(
      w.classes.reduce((a, c) => a + c.invested, 0),
      6,
    );
    expect(w.overall.profitPct).toBeCloseTo(w.overall.profit / w.overall.invested, 10);
    const funds = w.classes.find((c) => c.key === 'funds')!;
    expect(funds.profit).toBeCloseTo(400_000, 4);
    expect(funds.today).toBe(12_000);
    expect(digestWealth({ netWorth: w.total, blocks, overview, funds: fundsIn })).toEqual(w);
  });

  it('a household with no funds still adds up', () => {
    const none = digestWealth({
      netWorth: portfolio.netWorth.total,
      blocks,
      overview,
      funds: null,
    });
    expect(none.classes.find((c) => c.key === 'funds')!.current).toBe(0);
    expect(none.today.funds).toBe(0);
  });
});

describe('assembleDigest: what needs you, what changed, late inputs', () => {
  const i = assembleDigest(sources());

  it('ranks needs as the portal does (late first), then tax, then rates', () => {
    const t = i.needsYou!.map((n) => n.text);
    expect(t[0]).toMatch(/matured deposit .* to confirm/);
    expect(i.needsYou![0]).toMatchObject({ href: '/deposits?tab=maturities', tone: 'bad' });
    const maturing = t.findIndex((x) => /mature within 30 days/.test(x));
    const tax = t.findIndex((x) => x.startsWith('Tax harvest'));
    const rate = t.findIndex((x) => x.startsWith('Better rate:'));
    const stale = t.findIndex((x) => /^Rates for 2 banks are older than/.test(x));
    expect(maturing).toBeGreaterThan(0);
    expect(tax).toBeGreaterThan(maturing);
    expect(rate).toBeGreaterThan(tax);
    expect(stale).toBeGreaterThan(rate);
    expect(t[stale]).toBe(
      `Rates for 2 banks are older than ${DEFAULT_CONFIG.rates.staleDays} days: refresh them in Rates.`,
    );
    expect(i.needsYou!.find((n) => n.text.startsWith('Tax harvest'))!.href).toBe('/tax');
  });

  it('the late-input count and values-as-of are the portal’s', () => {
    expect(i.asOf).toBe('2026-10-25');
    expect(i.lateInputs).toBe(i.attention.staleOrMissing);
  });

  it('what changed compares with the day a month ago, by kind and by person, and lists the largest deposits paying out', () => {
    expect(i.changes!.since).toBe('2026-09-20');
    expect(i.changes!.kinds.length).toBeGreaterThan(0);
    expect(i.changes!.people[0]!.label).toBe('Rupash');
    const m = i.changes!.maturities;
    expect(m.map((x) => x.amount)).toEqual([...m.map((x) => x.amount)].sort((a, b) => b - a));
    expect(m[0]!.name).toContain('Equitas');
    expect(m.length).toBeLessThanOrEqual(DEFAULT_CONFIG.digest.changesMax);
    expect(i.previous).toEqual({ date: '2026-10-26', total: 9_000_000 });
  });

  it('largest maturities skip a deposit that waits to be confirmed', () => {
    const names = biggestMaturities(blocks, 400, 10).map((x) => x.name);
    expect(names.some((n) => n.includes('old'))).toBe(false);
  });
});

describe('assembleDigest: goals and retirement', () => {
  it('builds a card per goal, but not a retirement-kind goal twice when the retirement card is shown', () => {
    const i = assembleDigest(sources());
    expect(i.retirement?.card?.name).toBe('Retirement at 58');
    expect(i.goals!.map((g) => g.name)).toEqual(['Education']);
    const without = assembleDigest(sources({ retirement: null }));
    expect(without.retirement).toBeNull();
    expect(without.goals!.map((g) => g.name)).toEqual(['Education', 'Retirement pot']);
  });

  it('leaves the goals out when the view is off', () => {
    expect(assembleDigest(sources({ goals: null })).goals).toBeNull();
  });

  it('shows retirement only when assumptions are saved (spending and a date of birth)', () => {
    const blank = {
      ...retirementSettings,
      settings: { ...retirementSettings.settings, monthlySpendingToday: 0 },
    };
    expect(assembleDigest(sources({ retirement: blank })).retirement).toBeNull();
  });

  it('adds the Monte Carlo chance when runs are set in Settings, and leaves it out at 0', () => {
    const on = assembleDigest(sources()).retirement!.card!;
    expect(on.extra!.successRate).toBeGreaterThanOrEqual(0);
    expect(on.extra!.successRate).toBeLessThanOrEqual(1);
    const off = assembleDigest(
      sources({
        config: { ...DEFAULT_CONFIG, digest: { ...DEFAULT_CONFIG.digest, monteCarloRuns: 0 } },
      }),
    ).retirement!.card!;
    expect(off.extra!.successRate).toBeNull();
  });

  it('the whole thing renders to an e-mail whose numbers agree with the input', () => {
    const i = assembleDigest(sources());
    const e = buildDigestEmail(i);
    expect(e.subject).toMatch(/^Family Wealth Summary · 27 Oct 2026 · Net worth ₹/);
    expect(e.text).toContain('Education');
    expect(e.text).toContain('Retirement at 58');
    expect(e.html).toContain('In mutual funds');
  });
});

describe('savingsRatesOf', () => {
  it('uses the rate on the account, else the bank’s listed slab, else the assumed rate', () => {
    const rows = [
      {
        assetId: 'a',
        kind: 'cash',
        status: 'active',
        accountKind: 'NRE' as const,
        current: 100_000,
        bank: 'Equitas',
      },
      {
        assetId: 'b',
        kind: 'cash',
        status: 'active',
        accountKind: 'NRE' as const,
        current: 100_000,
        bank: 'Equitas',
      },
      {
        assetId: 'c',
        kind: 'fd',
        status: 'active',
        accountKind: null,
        current: 1,
        bank: 'Equitas',
      },
      {
        assetId: 'd',
        kind: 'cash',
        status: 'closed',
        accountKind: null,
        current: 1,
        bank: 'Equitas',
      },
    ];
    const r = savingsRatesOf(rows, new Map([['a', 0.05]]), [], 0.03);
    expect(r['a']).toMatchObject({ rate: 0.05, tag: 'own' });
    expect(r['b']).toMatchObject({ rate: 0.03, tag: 'assumed' });
    expect(r['c']).toBeUndefined();
    expect(r['d']).toBeUndefined();
  });
});

describe('depositCover', () => {
  const args = { assets, valued: portfolio.valued, jointHolders: {}, limit: 500_000 };
  it('counts money above the limit per bank and per name, a deposit past its date included', () => {
    const c = depositCover({ ...args, outside: new Set() });
    expect(c.banksOver).toBe(1);
    expect(c.uninsured).toBeGreaterThan(1_000_000);
    expect(c.limit).toBe(500_000);
  });
  it('leaves a bank outside the scheme out', () => {
    expect(depositCover({ ...args, outside: new Set(['eq']) })).toEqual({
      limit: 500_000,
      uninsured: 0,
      banksOver: 0,
    });
  });
  it('a second holder on a joint account gives it its own limit', () => {
    const joint = assets.map((a) => (a.id === 'cash' ? { ...a, is_joint: true } : a));
    const apart = depositCover({
      ...args,
      assets: joint,
      jointHolders: { cash: 'g' },
      outside: new Set(),
    });
    const together = depositCover({ ...args, outside: new Set() });
    expect(apart.uninsured).toBeLessThan(together.uninsured);
  });
});
