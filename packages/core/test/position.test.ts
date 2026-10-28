import { describe, expect, it } from 'vitest';
import {
  buildPortfolio,
  coverageOn,
  coverageWords,
  currentValues,
  dataStarts,
  fdEffectiveRate,
  fdValueOn,
  netWorthAsOf,
  observedAnnualRate,
  positionAsOf,
  positionAssetsFrom,
  positionConfig,
  positionGains,
  posFundFrom,
  sinceWords,
  valueOn,
  DEFAULT_CONFIG,
  type AssetRow,
  type FdRow,
  type ObservationRow,
  type PosFund,
  type PositionAsset,
  type PositionConfig,
  type PositionInput,
  savingsOn,
} from '../src';

const TODAY = '2026-10-27';
/** a savings balance moved on at a rate, credited quarterly (savings-accrual.ts) */
const accrue = (amount: number, date: string, rate: number, on: string, tds = 0) =>
  savingsOn(
    { date, amount },
    [],
    {
      schedule: [
        { from: '0000-01-01', slabs: [{ upTo: null, rate }], method: 'whole', source: 'account' },
      ],
      tds,
      credit: 'quarterly',
    },
    on,
  );
const cfg = (over: Partial<PositionConfig> = {}): PositionConfig => ({
  today: TODAY,
  savingsRate: 0.03,
  tdsRate: 0,
  navGapDays: 10,
  rateGap: 0.02,
  growth: { property: 0, retirement: 0, other: 0 },
  fx: {},
  ...over,
});

const base = (
  over: Partial<PositionAsset> & Pick<PositionAsset, 'assetId' | 'type'>,
): PositionAsset => ({
  ownerId: 'o1',
  status: 'active',
  name: over.assetId,
  currency: 'INR',
  rate: { own: null, listed: null, tds: null },
  records: [],
  fd: null,
  fund: null,
  ...over,
});

const rec = (date: string, amount: number, extra: object = {}) => ({
  date,
  amount,
  currency: 'INR',
  fxRate: null,
  ...extra,
});

const savings = (
  id: string,
  records: ReturnType<typeof rec>[],
  over: Partial<PositionAsset> = {},
) => base({ assetId: id, type: 'bank_account', records, ...over });

const deposit = (
  id: string,
  d: Partial<NonNullable<PositionAsset['fd']>> = {},
  over: Partial<PositionAsset> = {},
) =>
  base({
    assetId: id,
    type: 'fixed_deposit',
    fd: {
      principal: 100_000,
      rate: 0.07,
      bookedOn: '2026-01-01',
      maturityOn: '2027-01-01',
      compounding: 'quarterly',
      bankMaturityAmount: null,
      endedOn: null,
      ...d,
    },
    ...over,
  });

const fund = (over: Partial<PosFund> = {}): PosFund => ({
  txns: [],
  navs: [],
  units: null,
  snapshots: [],
  flows: [],
  hasStatement: true,
  estimatedSince: null,
  ...over,
});

const input = (assets: PositionAsset[], c: PositionConfig = cfg()): PositionInput => ({
  assets,
  config: c,
});

const fdOn = (d: NonNullable<PositionAsset['fd']>, on: string) =>
  fdValueOn({
    principal: d.principal,
    annualRate: d.rate,
    bookedOn: new Date(`${d.bookedOn}T00:00:00Z`),
    asOf: new Date(`${on}T00:00:00Z`),
    maturityOn: new Date(`${d.maturityOn}T00:00:00Z`),
    compounding: d.compounding,
  });

describe('savings and cash: the last balance moved forward at the rate', () => {
  const a = savings('s', [rec('2026-01-01', 100_000), rec('2026-03-01', 150_000)], {
    rate: { own: 0.06, listed: 0.04, tds: 0.1 },
  });
  it('has no value before the first record, and says so (not zero)', () => {
    const v = valueOn(a, '2025-12-31', cfg());
    expect(v.state).toBe('no_data');
    expect(v.value).toBeNull();
  });
  it('is the recorded balance on the day of the record', () => {
    const v = valueOn(a, '2026-01-01', cfg());
    expect(v.value).toBe(100_000);
    expect(v.basis).toBe('recorded');
    expect(v.estimated).toBe(false);
  });
  it('rolls the last record forward at the account rate after the tax at source', () => {
    const v = valueOn(a, '2026-02-01', cfg());
    // 31 days at 6% less 10% tax
    expect(v.value).toBeCloseTo(100_000 + (100_000 * 0.06 * 0.9 * 31) / 365, 6);
    expect(v.basis).toBe('rate');
    expect(v.estimated).toBe(true);
    expect(v.asOf).toBe('2026-01-01');
    expect(v.note).toContain('estimated from the balance recorded on 1 Jan 2026');
    expect(v.rate?.source).toBe('account');
  });
  it('a newer record takes over from the day it is dated, so a jump from a transfer is not interest', () => {
    expect(valueOn(a, '2026-03-01', cfg()).value).toBe(150_000);
  });
  it('uses the rate list when the account has none, then the assumed rate in Settings', () => {
    const listed = savings('l', [rec('2026-01-01', 100_000)], {
      rate: { own: null, listed: 0.04, tds: null },
    });
    expect(valueOn(listed, '2026-01-31', cfg()).rate).toMatchObject({
      used: 0.04,
      source: 'rates_list',
    });
    const plain = savings('p', [rec('2026-01-01', 100_000)]);
    expect(valueOn(plain, '2026-01-31', cfg()).rate).toMatchObject({
      used: 0.03,
      source: 'assumed',
    });
  });
  it('a closed account counts until its last record and not after', () => {
    const closed = savings('c', [rec('2026-01-01', 50_000)], { status: 'closed' });
    expect(valueOn(closed, '2026-01-01', cfg()).state).toBe('held');
    expect(valueOn(closed, '2026-01-02', cfg()).state).toBe('ended');
  });
  it('a foreign balance earns no interest here: it moves with the exchange rate', () => {
    const sgd = savings('g', [rec('2026-01-01', 1_000, { currency: 'SGD', fxRate: 60 })], {
      currency: 'SGD',
    });
    const c = cfg({
      fx: {
        SGD: [
          { date: '2026-01-01', rate: 60 },
          { date: '2026-06-01', rate: 66 },
        ],
      },
    });
    expect(valueOn(sgd, '2026-02-01', c)).toMatchObject({ value: 60_000, basis: 'fx' });
    expect(valueOn(sgd, '2026-07-01', c).value).toBe(66_000);
  });
});

describe('observed rate: a pointer from the records, never a valuation', () => {
  it('is the middle growth rate of balances a month or more apart', () => {
    const r = observedAnnualRate([
      { date: '2026-01-01', amount: 100_000 },
      { date: '2026-04-01', amount: 101_500 },
      { date: '2026-07-01', amount: 103_000 },
    ]);
    expect(r).toBeGreaterThan(0.05);
    expect(r).toBeLessThan(0.07);
  });
  it('skips balances that fell (a withdrawal) and records less than a month apart', () => {
    expect(
      observedAnnualRate([
        { date: '2026-01-01', amount: 100_000 },
        { date: '2026-01-10', amount: 200_000 },
        { date: '2026-04-01', amount: 50_000 },
      ]),
    ).toBeNull();
  });
  it('flags an account whose records grow at a rate far from the one it is valued at', () => {
    const a = savings(
      's',
      [rec('2026-01-01', 100_000), rec('2026-04-01', 101_500), rec('2026-07-01', 103_000)],
      { rate: { own: 0.01, listed: null, tds: null } },
    );
    const v = valueOn(a, '2026-08-01', cfg());
    expect(v.rate?.differs).toBe(true);
    expect(v.rate?.observed).toBeGreaterThan(0.05);
    const near = savings(
      's2',
      [rec('2026-01-01', 100_000), rec('2026-04-01', 101_500), rec('2026-07-01', 103_000)],
      { rate: { own: 0.06, listed: null, tds: null } },
    );
    expect(valueOn(near, '2026-08-01', cfg()).rate?.differs).toBe(false);
  });
});

describe('fixed deposits', () => {
  it('accrues from the terms, is not there before booking and not counted after maturity', () => {
    const a = deposit('d');
    expect(valueOn(a, '2025-12-31', cfg()).state).toBe('not_yet');
    const mid = valueOn(a, '2026-07-01', cfg());
    expect(mid.value).toBeCloseTo(fdOn(a.fd!, '2026-07-01'), 6);
    expect(mid.basis).toBe('terms');
    expect(mid.estimated).toBe(false);
    // it still counts on the day it matures, and not after (the same rule as net worth)
    expect(valueOn(a, '2027-01-01', cfg()).state).toBe('held');
    const after = valueOn(a, '2027-01-02', cfg());
    expect(after.state).toBe('ended');
    expect(after.value).toBe(0);
  });
  it('a deposit paid out early stops on the day it was closed', () => {
    const a = deposit('d', { endedOn: '2026-05-01' }, { status: 'closed' });
    expect(valueOn(a, '2026-04-30', cfg()).state).toBe('held');
    expect(valueOn(a, '2026-05-01', cfg()).state).toBe('ended');
  });
  it('uses the rate that reaches the bank’s maturity amount, and says so', () => {
    const stated = deposit('d').fd!;
    const bank = fdOn(stated, stated.maturityOn) * 1.004;
    const a = deposit('d', { bankMaturityAmount: bank });
    const v = valueOn(a, '2026-07-01', cfg());
    expect(v.basis).toBe('bank_amount');
    expect(v.rate?.used).toBeGreaterThan(0.07);
    expect(v.note).toContain('from the bank’s maturity amount');
    // at maturity it equals the bank's figure
    const eff = fdEffectiveRate({
      principal: 100_000,
      annualRate: 0.07,
      bookedOn: new Date('2026-01-01T00:00:00Z'),
      maturityOn: new Date('2027-01-01T00:00:00Z'),
      bankMaturityAmount: bank,
    });
    expect(
      fdValueOn({
        principal: 100_000,
        annualRate: eff.rate,
        bookedOn: new Date('2026-01-01T00:00:00Z'),
        asOf: new Date('2027-01-01T00:00:00Z'),
        compounding: 'quarterly',
      }),
    ).toBeCloseTo(bank, 2);
  });
  it('ignores a bank amount that implies a rate far from the stated one (a typing error)', () => {
    const a = deposit('d', { bankMaturityAmount: 150_000 });
    expect(valueOn(a, '2026-07-01', cfg()).basis).toBe('terms');
  });
});

describe('mutual funds: units held on the day times the price', () => {
  const f = fund({
    txns: [
      { date: '2026-01-10', units: 100, amount: 10_000, estimated: false },
      { date: '2026-03-10', units: 50, amount: 6_000, estimated: false },
      { date: '2026-06-10', units: -80, amount: -10_400, estimated: false },
    ],
    navs: [
      { date: '2026-01-09', nav: 100 },
      { date: '2026-01-30', nav: 100 },
      { date: '2026-03-09', nav: 120 },
      { date: '2026-05-31', nav: 130 },
      { date: '2026-06-09', nav: 130 },
    ],
  });
  const a = base({ assetId: 'f', type: 'mutual_fund', fund: f });
  it('uses the ledger up to the day and the last price on or before it', () => {
    expect(valueOn(a, '2026-02-01', cfg())).toMatchObject({ value: 100 * 100, basis: 'units_nav' });
    expect(valueOn(a, '2026-03-12', cfg()).value).toBe(150 * 120);
    expect(valueOn(a, '2026-06-12', cfg()).value).toBe(70 * 130);
  });
  it('is not held before the first line', () => {
    expect(valueOn(a, '2026-01-01', cfg()).state).toBe('not_yet');
  });
  it('is ended after every unit is sold', () => {
    const sold = base({
      assetId: 'f2',
      type: 'mutual_fund',
      fund: fund({
        txns: [
          { date: '2026-01-10', units: 10, amount: 1_000, estimated: false },
          { date: '2026-02-10', units: -10, amount: -1_100, estimated: false },
        ],
        navs: [
          { date: '2026-01-09', nav: 100 },
          { date: '2026-01-19', nav: 101 },
        ],
      }),
    });
    expect(valueOn(sold, '2026-03-01', cfg()).state).toBe('ended');
    expect(valueOn(sold, '2026-01-20', cfg()).state).toBe('held');
  });
  it('without a ledger: the value recorded moved with the price (estimated), then the sheet’s value', () => {
    const noLedger = base({
      assetId: 'f3',
      type: 'mutual_fund',
      records: [rec('2026-01-31', 10_000)],
      fund: fund({
        navs: [
          { date: '2026-01-30', nav: 100 },
          { date: '2026-03-30', nav: 110 },
        ],
      }),
    });
    const v = valueOn(noLedger, '2026-03-31', cfg());
    expect(v.value).toBeCloseTo(11_000, 6);
    expect(v.basis).toBe('nav_scaled');
    expect(v.estimated).toBe(true);
    const sheetOnly = base({
      assetId: 'f4',
      type: 'mutual_fund',
      records: [rec('2026-01-31', 7_000, { sheet: true })],
      fund: fund(),
    });
    const s = valueOn(sheetOnly, '2026-02-28', cfg());
    expect(s).toMatchObject({ value: 7_000, basis: 'sheet', estimated: true });
    expect(valueOn(sheetOnly, '2026-01-01', cfg()).state).toBe('not_yet');
  });
  it('lines assumed from a SIP plan make the figure an estimate', () => {
    const a2 = base({
      assetId: 'f5',
      type: 'mutual_fund',
      fund: fund({
        txns: [{ date: '2026-01-10', units: 10, amount: 1_000, estimated: true }],
        navs: [{ date: '2026-01-10', nav: 100 }],
      }),
    });
    expect(valueOn(a2, '2026-01-20', cfg()).estimated).toBe(true);
  });
});

describe('others: the value recorded, held flat unless Settings assumes growth', () => {
  const prop = base({ assetId: 'p', type: 'property', records: [rec('2025-04-01', 5_000_000)] });
  it('holds the recorded value flat', () => {
    expect(valueOn(prop, '2026-04-01', cfg())).toMatchObject({
      value: 5_000_000,
      basis: 'recorded',
      estimated: false,
    });
  });
  it('moves it on at the assumed growth and says assumed', () => {
    const v = valueOn(
      prop,
      '2026-04-01',
      cfg({ growth: { property: 0.05, retirement: 0, other: 0 } }),
    );
    expect(v.value).toBeCloseTo(5_250_000, -2);
    expect(v.basis).toBe('assumed');
    expect(v.estimated).toBe(true);
  });
  it('insurance cover is never wealth', () => {
    const pol = base({ assetId: 'pol', type: 'policy', records: [rec('2026-01-01', 1_000_000)] });
    expect(positionAsOf(input([pol]), TODAY).total).toBe(0);
  });
});

describe('a day’s position', () => {
  const assets = [
    savings('s', [rec('2026-01-01', 100_000)]),
    deposit('d'),
    base({ assetId: 'p', type: 'property', records: [rec('2026-02-01', 1_000_000)] }),
  ];
  it('adds only what is held that day and counts the holdings with no value', () => {
    const p = positionAsOf(input(assets), '2026-03-01');
    expect(p.counted).toBe(3);
    expect(p.total).toBeCloseTo(
      100_000 + (100_000 * 0.03 * 59) / 365 + fdOn(assets[1]!.fd!, '2026-03-01') + 1_000_000,
      2,
    );
    const early = positionAsOf(input(assets), '2026-01-15');
    expect(early.counted).toBe(2);
    expect(early.noData).toBe(1);
    expect(early.byClass.others).toBe(0);
  });
  it('a month with no data at all is zero holdings, not a made-up figure', () => {
    const p = positionAsOf(input(assets), '2025-06-30');
    expect(p.counted).toBe(0);
    expect(p.total).toBe(0);
    expect(netWorthAsOf(input(assets), '2025-06-30')).toBe(0);
  });
  it('knows where the data starts and how many holdings a day is built from', () => {
    const inp = input(assets);
    expect(dataStarts(inp)).toBe('2026-01-01');
    expect(coverageOn(inp, '2026-01-15')).toEqual({ withValue: 2, of: 3 });
    expect(coverageWords({ coverage: coverageOn(inp, '2026-01-15') })).toBe(
      '2 of 3 holdings had a value then',
    );
    expect(coverageWords({ coverage: coverageOn(inp, '2026-06-01') })).toBe(
      'all 3 holdings had a value then',
    );
  });
});

describe('period gains are gains, not changes of balance', () => {
  const day = (t: ReturnType<typeof positionGains>['tiles'], key: string) =>
    t.find((x) => x.key === key)!;

  it('a deposit booked mid-period funded from savings adds its interest only', () => {
    const d = deposit('d', {
      bookedOn: '2026-10-10',
      maturityOn: '2027-10-10',
      principal: 500_000,
    });
    const s = savings('s', [rec('2026-09-01', 1_000_000), rec('2026-10-11', 500_000)], {
      rate: { own: 0.03, listed: null, tds: null },
    });
    const g = positionGains({ position: input([s, d]), recentDays: 30 });
    const t = day(g.tiles, 'recent');
    const interestFd = fdOn(d.fd!, TODAY) - 500_000;
    // savings: interest at 3% on each record's own stretch; the 500,000 drop is not a loss
    const interestSav =
      accrue(1_000_000, '2026-09-01', 0.03, '2026-10-11').interest -
      accrue(1_000_000, '2026-09-01', 0.03, '2026-09-27').interest +
      accrue(500_000, '2026-10-11', 0.03, TODAY).interest;
    expect(t.amount).toBeCloseTo(interestFd + interestSav, 4);
    expect(t.putIn).toBe(500_000);
    expect(t.empty).toBe(false);
    // net worth itself did not move because of the transfer
    expect(Math.abs(t.netWorth.change)).toBeLessThan(10_000);
  });

  it('a deposit that matured mid-period stops counting and its payout is not a loss', () => {
    const d = deposit('d', {
      bookedOn: '2025-10-15',
      maturityOn: '2026-10-15',
      principal: 200_000,
    });
    const g = positionGains({ position: input([d]), recentDays: 30 });
    const t = day(g.tiles, 'recent');
    expect(t.amount).toBeCloseTo(fdOn(d.fd!, '2026-10-15') - fdOn(d.fd!, '2026-09-27'), 4);
    expect(t.takenOut).toBeGreaterThan(200_000);
    expect(positionAsOf(input([d]), TODAY).total).toBe(0);
  });

  it('a fund bought and sold: the gain is the change in value less purchases plus sales', () => {
    const f = fund({
      txns: [
        { date: '2026-09-01', units: 100, amount: 10_000, estimated: false },
        { date: '2026-10-05', units: 50, amount: 6_000, estimated: false },
        { date: '2026-10-20', units: -60, amount: -7_800, estimated: false },
      ],
      navs: [
        { date: '2026-09-01', nav: 100 },
        { date: '2026-09-26', nav: 105 },
        { date: '2026-10-05', nav: 120 },
        { date: '2026-10-20', nav: 130 },
        { date: '2026-10-27', nav: 135 },
      ],
      flows: [
        { date: '2026-09-01', amount: 10_000 },
        { date: '2026-10-05', amount: 6_000 },
        { date: '2026-10-20', amount: -7_800 },
      ],
    });
    const a = base({ assetId: 'f', type: 'mutual_fund', fund: f });
    const g = positionGains({
      position: { ...input([a]), current: { f: { value: 90 * 135, counted: true } } },
      recentDays: 30,
    });
    const t = day(g.tiles, 'recent');
    // value at 26 Sep: 100 x 105; today 90 x 135; bought 6,000, sold 7,800
    expect(t.amount).toBeCloseTo(90 * 135 - 100 * 105 - 6_000 + 7_800, 4);
    expect(t.putIn).toBe(6_000);
    expect(t.takenOut).toBe(7_800);
  });

  it('a savings balance jump from a transfer is not a gain', () => {
    const s = savings('s', [rec('2026-09-01', 100_000), rec('2026-10-01', 900_000)], {
      rate: { own: 0, listed: null, tds: null },
    });
    const g = positionGains({ position: input([s]), recentDays: 30 });
    expect(day(g.tiles, 'recent').amount).toBeCloseTo(0, 6);
    expect(day(g.tiles, 'recent').netWorth.change).toBeCloseTo(800_000, 0);
  });

  it('a period before the data starts begins where the data does, and says so', () => {
    const d = deposit('d', { bookedOn: '2026-08-01', maturityOn: '2027-08-01' });
    const g = positionGains({ position: input([d]), recentDays: 30 });
    const fy = day(g.tiles, 'fy');
    expect(fy.asked).toBe('2026-04-01');
    expect(fy.from).toBe('2026-08-01');
    expect(fy.clamped).toBe(true);
    expect(sinceWords(fy)).toBe('data starts 1 Aug 2026');
    expect(fy.amount).toBeCloseTo(fdOn(d.fd!, TODAY) - 100_000, 4);
    // the last 30 days start inside the data: no clamp, real start
    const recent = day(g.tiles, 'recent');
    expect(recent.clamped).toBe(false);
    expect(sinceWords(recent)).toBe('since 27 Sep 2026');
    // the last financial year ended before the data began
    expect(day(g.tiles, 'lastFy').empty).toBe(true);
  });

  it('the last 30 days and this financial year differ once the data goes back far enough', () => {
    const d = deposit('d', {
      bookedOn: '2025-12-01',
      maturityOn: '2026-12-31',
      principal: 1_000_000,
    });
    const g = positionGains({ position: input([d]), recentDays: 30 });
    const a = day(g.tiles, 'recent').amount;
    const b = day(g.tiles, 'fy').amount;
    expect(b).toBeGreaterThan(a * 5);
    expect(sinceWords(day(g.tiles, 'fy'))).toBe('since 1 Apr 2026');
  });

  it('the financial year starts on 1 April and last year ends there', () => {
    const d = deposit('d', { bookedOn: '2025-01-01', maturityOn: '2028-01-01' });
    const g = positionGains({ position: input([d]), recentDays: 30 });
    const fy = day(g.tiles, 'fy');
    const last = day(g.tiles, 'lastFy');
    expect(fy.from).toBe('2026-04-01');
    expect(last.from).toBe('2025-04-01');
    expect(last.to).toBe('2026-04-01');
    expect(last.amount).toBeCloseTo(fdOn(d.fd!, '2026-04-01') - fdOn(d.fd!, '2025-04-01'), 4);
    expect(fy.amount).toBeCloseTo(fdOn(d.fd!, TODAY) - fdOn(d.fd!, '2026-04-01'), 4);
  });

  it('a leap day is a day of interest', () => {
    const c = cfg({ today: '2028-03-01' });
    const d = deposit('d', { bookedOn: '2028-01-01', maturityOn: '2029-01-01' });
    const g = positionGains({ position: input([d], c), recentDays: 2 });
    // 29 Feb 2028 -> 1 Mar 2028 is 1 day; the two days back include the leap day
    const t = day(g.tiles, 'recent');
    expect(t.amount).toBeCloseTo(fdOn(d.fd!, '2028-03-01') - fdOn(d.fd!, '2028-02-28'), 4);
    expect(span('2028-02-28', '2028-03-01')).toBe(2);
  });

  it('foreign balances count the exchange-rate move as a gain, labelled estimated', () => {
    const sgd = savings('g', [rec('2026-08-01', 1_000, { currency: 'SGD', fxRate: 60 })], {
      currency: 'SGD',
    });
    const c = cfg({
      fx: {
        SGD: [
          { date: '2026-08-01', rate: 60 },
          { date: '2026-10-01', rate: 63 },
        ],
      },
    });
    const g = positionGains({
      position: { assets: [sgd], config: c, current: { g: { value: 63_000, counted: true } } },
      recentDays: 30,
    });
    const t = day(g.tiles, 'fy');
    expect(t.amount).toBeCloseTo(1_000 * (63 - 60), 6);
    expect(t.estimated).toBe(true);
  });

  it('others add nothing unless Settings assumes growth', () => {
    const p = base({ assetId: 'p', type: 'property', records: [rec('2025-01-01', 1_000_000)] });
    expect(day(positionGains({ position: input([p]), recentDays: 30 }).tiles, 'fy').amount).toBe(0);
    const grown = positionGains({
      position: input([p], cfg({ growth: { property: 0.1, retirement: 0, other: 0 } })),
      recentDays: 30,
    });
    expect(day(grown.tiles, 'fy').amount).toBeGreaterThan(0);
    expect(day(grown.tiles, 'fy').estimated).toBe(true);
  });
});

describe('a period starts from the nearest earlier record, rolled forward (the user’s example)', () => {
  // there is a record on 22 Aug and none on the day the last 30 days begin; today is 28 Oct
  const c = cfg({ today: '2026-10-28' });
  const sav = savings('s', [rec('2026-08-22', 1_000_000)], {
    rate: { own: 0.06, listed: null, tds: null },
  });

  it('values the first day from the 22 Aug record at the account’s rate, and the last day the same way', () => {
    const g = positionGains({ position: input([sav], c), recentDays: 30 });
    const t = g.tiles.find((x) => x.key === 'recent')!;
    expect(t.from).toBe('2026-09-28');
    expect(t.clamped).toBe(false);
    expect(sinceWords(t)).toBe('since 28 Sep 2026');
    // 1,000,000 recorded on 22 Aug, 37 days to 28 Sep, 67 days to 28 Oct, at 6%, interest credited on 30 Sep
    const start = accrue(1_000_000, '2026-08-22', 0.06, '2026-09-28').value;
    const end = accrue(1_000_000, '2026-08-22', 0.06, '2026-10-28').value;
    expect(start).toBeCloseTo(1_000_000 + (1_000_000 * 0.06 * 37) / 365, 6);
    expect(t.netWorth.start).toBeCloseTo(start, 1);
    expect(t.netWorth.end).toBeCloseTo(end, 1);
    // the earning of the period is 30 days of interest on the balance (with the 30 Sep credit earning after it)
    expect(t.amount).toBeCloseTo(end - start, 4);
    // and it says which record the first day rests on
    expect(t.startFrom).toEqual({
      oldest: '2026-08-22',
      newest: '2026-08-22',
      onTheDay: 0,
      movedForward: 1,
      fromTerms: 0,
    });
    expect(t.coverage).toEqual({ withValue: 1, of: 1 });
  });

  it('the financial year does the same from a record before 1 April, and a deposit from its terms', () => {
    const old = savings('o', [rec('2026-03-22', 500_000)], {
      rate: { own: 0.04, listed: null, tds: null },
    });
    const fd = deposit('d', {
      bookedOn: '2026-01-15',
      maturityOn: '2027-01-15',
      principal: 300_000,
    });
    const g = positionGains({ position: input([sav, old, fd], c), recentDays: 30 });
    const fy = g.tiles.find((x) => x.key === 'fy')!;
    expect(fy.from).toBe('2026-04-01');
    expect(fy.clamped).toBe(false);
    // the savings account recorded in August was not there on 1 April: nothing is invented for it
    expect(fy.startFrom.oldest).toBe('2026-03-22');
    expect(fy.coverage).toEqual({ withValue: 2, of: 3 });
    const interestOld =
      accrue(500_000, '2026-03-22', 0.04, '2026-10-28').interest -
      accrue(500_000, '2026-03-22', 0.04, '2026-04-01').interest;
    const interestSav = accrue(1_000_000, '2026-08-22', 0.06, '2026-10-28').interest;
    const interestFd = fdOn(fd.fd!, '2026-10-28') - fdOn(fd.fd!, '2026-04-01');
    expect(fy.amount).toBeCloseTo(interestOld + interestSav + interestFd, 3);
  });

  it('only with no record at all before the day does it say the data starts', () => {
    const late = positionGains({
      position: input([savings('n', [rec('2026-10-10', 100_000)])], c),
      recentDays: 30,
    });
    const t = late.tiles.find((x) => x.key === 'recent')!;
    expect(t.clamped).toBe(true);
    expect(sinceWords(t)).toBe('data starts 10 Oct 2026');
    expect(t.from).toBe('2026-10-10');
    expect(t.asked).toBe('2026-09-28');
  });
});

const span = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

describe('today agrees with net worth', () => {
  const assets: AssetRow[] = [
    {
      id: 's',
      owner_id: 'o1',
      type: 'bank_account',
      status: 'active',
      nickname: 'Savings',
      currency: 'INR',
      account_kind: null,
      expected_freshness_days: null,
      interest_rate: 0.05,
      tds_rate: 0.1,
    },
    {
      id: 'd',
      owner_id: 'o1',
      type: 'fixed_deposit',
      status: 'active',
      nickname: 'FD',
      currency: 'INR',
      account_kind: null,
      expected_freshness_days: null,
    },
    {
      id: 'm',
      owner_id: 'o1',
      type: 'bank_account',
      status: 'closed',
      nickname: 'Old',
      currency: 'INR',
      account_kind: null,
      expected_freshness_days: null,
    },
  ];
  const obs = (asset_id: string, as_of: string, amount: number): ObservationRow => ({
    id: `${asset_id}${as_of}`,
    asset_id,
    kind: 'balance',
    amount,
    currency: 'INR',
    fx_rate: null,
    as_of,
    confidence: 'verified' as ObservationRow['confidence'],
    source: 'manual',
    created_at: `${as_of}T00:00:00Z`,
    superseded_by: null,
  });
  const fds: FdRow[] = [
    {
      asset_id: 'd',
      principal: 300_000,
      rate: 0.071,
      booked_on: '2026-02-01',
      maturity_on: '2027-02-01',
      compounding: 'quarterly',
      bank_maturity_amount: 321_900,
    },
  ];
  it('the engine and the portfolio give the same figure for savings and deposits', () => {
    const observations = [obs('s', '2026-08-15', 400_000), obs('m', '2026-03-01', 10_000)];
    const todayDate = new Date(`${TODAY}T00:00:00Z`);
    const portfolio = buildPortfolio(assets, observations, fds, todayDate, {
      savingsRate: 0.03,
      tdsRate: 0,
      fdRateGap: 0.02,
    });
    const pos = positionAsOf(positionInputFrom0({ assets, observations, fds, portfolio }), TODAY);
    const live = portfolio.valued.filter((v) => v.assetId !== 'm');
    const expected = live.reduce((a, v) => a + (v.estimate?.estimatedAmount ?? 0), 0);
    expect(pos.total).toBeCloseTo(expected, 2);
    // without the shortcut (the engine's own rule) it is the same figure
    const own = positionAsOf(
      (() => {
        const { current: _c, ...rest } = positionInputFrom0({
          assets,
          observations,
          fds,
          portfolio,
        });
        return rest;
      })(),
      TODAY,
    );
    expect(own.total).toBeCloseTo(expected, 2);
    expect(Object.keys(currentValues(portfolio))).toContain('d');
  });
});

function positionInputFrom0(a: {
  assets: AssetRow[];
  observations: ObservationRow[];
  fds: FdRow[];
  portfolio: ReturnType<typeof buildPortfolio>;
}): PositionInput {
  return {
    assets: positionAssetsFrom({ assets: a.assets, observations: a.observations, fds: a.fds }),
    config: positionConfig(DEFAULT_CONFIG, TODAY),
    current: currentValues(a.portfolio),
  };
}

describe('building a fund from its stored lines', () => {
  it('puts the lines in order, counts the units held before the first line and keeps the statement’s flows', () => {
    const f = posFundFrom({
      lines: [
        {
          date: '2026-02-01',
          kind: 'purchase',
          units: 10,
          amount: 1_000,
          nav: 100,
          balance: 110,
          source: 'cas',
        },
        {
          date: '2026-03-01',
          kind: 'purchase',
          units: 10,
          amount: 1_100,
          nav: 110,
          balance: 120,
          source: 'cas',
        },
      ],
      navs: [],
      units: null,
      snapshots: [],
      plan: null,
      today: TODAY,
      unitTolerance: 0.001,
    });
    // 100 units were held before the first line
    expect(f.txns.map((t) => t.units)).toEqual([100, 10, 10]);
    expect(f.hasStatement).toBe(true);
    expect(f.flows.length).toBe(3);
    expect(f.estimatedSince).toBeNull();
  });
});
