import { describe, expect, it } from 'vitest';
import {
  buildPortfolio,
  latestObservations,
  type AssetRow,
  type FdRow,
  type ObservationRow,
} from '../src/portfolio';

const today = new Date('2026-10-26T00:00:00Z');
const asset = (o: Partial<AssetRow> & { id: string }): AssetRow => ({
  owner_id: 'rupash',
  type: 'bank_account',
  status: 'active',
  nickname: o.id,
  currency: 'INR',
  account_kind: 'NRE',
  expected_freshness_days: 35,
  ...o,
});
const obs = (
  o: Partial<ObservationRow> & { id: string; asset_id: string; amount: number },
): ObservationRow => ({
  kind: 'balance',
  currency: 'INR',
  fx_rate: null,
  as_of: '2026-10-25',
  confidence: 'manual_unverified',
  source: 'workbook',
  created_at: '2026-10-25T10:00:00Z',
  superseded_by: null,
  ...o,
});

describe('latestObservations', () => {
  it('uses the newest as_of, breaks ties by created_at and ignores superseded rows', () => {
    const m = latestObservations([
      obs({ id: '1', asset_id: 'a', amount: 1, as_of: '2026-09-01' }),
      obs({
        id: '2',
        asset_id: 'a',
        amount: 2,
        as_of: '2026-10-01',
        created_at: '2026-10-01T01:00:00Z',
      }),
      obs({
        id: '3',
        asset_id: 'a',
        amount: 3,
        as_of: '2026-10-01',
        created_at: '2026-10-02T01:00:00Z',
      }),
      obs({ id: '4', asset_id: 'a', amount: 4, as_of: '2026-10-20', superseded_by: '3' }),
    ]);
    expect(m.get('a')!.amount).toBe(3);
  });
});

describe('buildPortfolio', () => {
  const fd: FdRow = {
    asset_id: 'fd1',
    principal: 500_000,
    rate: 0.08,
    booked_on: '2026-09-14',
    maturity_on: '2029-09-15',
    compounding: 'quarterly',
    bank_maturity_amount: 634_399,
  };

  it('values bank balances with assumed interest and flags the assumption', () => {
    const p = buildPortfolio(
      [asset({ id: 'b' })],
      [obs({ id: 'o', asset_id: 'b', amount: 1_000_000, as_of: '2026-09-26' })],
      [],
      today,
    );
    const e = p.valued[0]!.estimate!;
    expect(e.anchorAmount).toBe(1_000_000);
    expect(e.estimatedAmount).toBeGreaterThan(1_000_000);
    expect(p.lines.b).toMatchObject({
      basis: 'estimated',
      usedAssumption: true,
      freshness: 'current',
      ageDays: 30,
    });
  });

  it('uses the per-account rate when one is set and says no assumption was used', () => {
    const p = buildPortfolio(
      [asset({ id: 'b', interest_rate: 0.0275, tds_rate: 0 })],
      [obs({ id: 'o', asset_id: 'b', amount: 100_000 })],
      [],
      today,
    );
    expect(p.lines.b!.usedAssumption).toBe(false);
  });

  it('uses the rate on file for the bank and slab when the account has none, and the account rate beats it', () => {
    const rows = [obs({ id: 'o', asset_id: 'b', amount: 100_000, as_of: '2026-07-26' })];
    const own = buildPortfolio([asset({ id: 'b', interest_rate: 0.0275 })], rows, [], today);
    const listed = buildPortfolio([asset({ id: 'b', listed_rate: 0.065 })], rows, [], today);
    const both = buildPortfolio(
      [asset({ id: 'b', interest_rate: 0.0275, listed_rate: 0.065 })],
      rows,
      [],
      today,
    );
    const plain = buildPortfolio([asset({ id: 'b' })], rows, [], today);
    expect(listed.lines.b!.usedAssumption).toBe(false);
    expect(plain.lines.b!.usedAssumption).toBe(true);
    const amount = (p: typeof own) => p.valued[0]!.estimate!.estimatedAmount;
    expect(amount(listed)).toBeGreaterThan(amount(plain)); // 6.5% beats the 3% default
    expect(amount(both)).toBe(amount(own));
  });

  it('values an FD from its contract (calculated), independent of observations', () => {
    const p = buildPortfolio([asset({ id: 'fd1', type: 'fixed_deposit' })], [], [fd], today);
    expect(p.lines.fd1).toMatchObject({ basis: 'calculated', freshness: 'calculated' });
    expect(p.netWorth.total).toBeGreaterThan(500_000);
    expect(p.netWorth.total).toBeLessThan(634_399);
  });

  it('keeps matured-unconfirmed FDs out of net worth but visible', () => {
    const p = buildPortfolio(
      [asset({ id: 'fd1', type: 'fixed_deposit', status: 'matured_unconfirmed' })],
      [],
      [{ ...fd, booked_on: '2025-05-12', maturity_on: '2026-09-23' }],
      today,
    );
    expect(p.netWorth.total).toBe(0);
    expect(p.netWorth.excluded[0]).toMatchObject({ reason: 'status_not_counted' });
    expect(p.lines.fd1!.freshness).toBe('older_than_expected');
  });

  it('shows S$ balances at the anchor rate until a live rate is supplied, then separates FX movement', () => {
    const rows = [asset({ id: 'sg', currency: 'SGD' })];
    const o = [obs({ id: 'o', asset_id: 'sg', amount: 100, currency: 'SGD', fx_rate: 65 })];
    expect(buildPortfolio(rows, o, [], today).netWorth.total).toBe(6500);
    const live = buildPortfolio(rows, o, [], today, {
      savingsRate: 0.03,
      tdsRate: 0,
      fxToday: { SGD: 70 },
    });
    expect(live.netWorth.total).toBe(7000);
    expect(live.netWorth.estimateTotals.fx).toBe(500);
  });

  it('reports an asset with no observation as missing, not zero', () => {
    const p = buildPortfolio([asset({ id: 'x' })], [], [], today);
    expect(p.lines.x).toMatchObject({ freshness: 'missing', basis: null });
    expect(p.netWorth.excluded[0]!.reason).toBe('no_valuation');
  });

  it('marks old balances stale rather than presenting them as current', () => {
    const p = buildPortfolio(
      [asset({ id: 'b' })],
      [obs({ id: 'o', asset_id: 'b', amount: 5, as_of: '2026-05-01' })],
      [],
      today,
    );
    expect(p.lines.b!.freshness).toBe('stale');
  });

  it('carries forward funds, property and receivables without inventing growth', () => {
    const p = buildPortfolio(
      [asset({ id: 'mf', type: 'mutual_fund' }), asset({ id: 'pr', type: 'property' })],
      [
        obs({ id: 'a', asset_id: 'mf', amount: 300_000, kind: 'valuation' }),
        obs({ id: 'b', asset_id: 'pr', amount: 2_500_000, kind: 'valuation', as_of: '2023-12-15' }),
      ],
      [],
      today,
    );
    expect(p.netWorth.total).toBe(2_800_000);
    expect(p.lines.mf!.basis).toBe('carried_forward');
  });
});

describe('buildPortfolio with market data', () => {
  const navs = {
    '118778': [
      { date: '2026-09-30', nav: 100 },
      { date: '2026-10-23', nav: 110 },
    ],
  };
  const fund = (extra: Partial<AssetRow> = {}) =>
    asset({ id: 'mf', type: 'mutual_fund', amfi_code: '118778', ...extra });
  const value = (as_of: string) =>
    obs({ id: 'o', asset_id: 'mf', kind: 'valuation', amount: 100_000, as_of });

  it('moves a fund by the NAV change since the date its value was recorded, and labels it an estimate', () => {
    const p = buildPortfolio([fund()], [value('2026-09-30')], [], today, {
      savingsRate: 0.03,
      tdsRate: 0,
      navs,
    });
    expect(p.netWorth.total).toBeCloseTo(110_000, 6);
    expect(p.netWorth.estimateTotals.market).toBeCloseTo(10_000, 6);
    expect(p.lines.mf).toMatchObject({ basis: 'estimated', marketDate: '2026-10-23' });
  });

  it('adds the SIP instalments due since the recorded value, and the switch turns that off', () => {
    const sip = { monthly: 10_000, startedOn: '2025-01-05', stopped: false };
    const args = [[fund({ sip })], [value('2026-09-30')], [], today] as [
      AssetRow[],
      ObservationRow[],
      FdRow[],
      Date,
    ];
    const on = buildPortfolio(...args, { savingsRate: 0.03, tdsRate: 0, navs });
    // one instalment (5 Oct) is due after 30 Sep; its NAV on 5 Oct is the 30 Sep NAV (100), today's NAV is 110
    expect(on.netWorth.total).toBeCloseTo(110_000 + 11_000, 6);
    expect(on.netWorth.estimateTotals.contribution).toBe(10_000);
    const off = buildPortfolio(...args, { savingsRate: 0.03, tdsRate: 0, navs, includeSip: false });
    expect(off.netWorth.total).toBeCloseTo(110_000, 6);
  });

  it('adds no market movement when the value was recorded on the latest NAV date', () => {
    const p = buildPortfolio([fund()], [value('2026-10-23')], [], today, {
      savingsRate: 0.03,
      tdsRate: 0,
      navs,
    });
    expect(p.netWorth.total).toBeCloseTo(100_000, 6);
  });

  it('falls back to the recorded value when there is no NAV close to the recorded date (never guesses)', () => {
    const p = buildPortfolio([fund()], [value('2026-06-01')], [], today, {
      savingsRate: 0.03,
      tdsRate: 0,
      navs,
    });
    expect(p.netWorth.total).toBe(100_000);
    expect(p.lines.mf!.basis).toBe('carried_forward');
  });

  it('ignores funds whose scheme you have not confirmed', () => {
    const p = buildPortfolio([fund({ amfi_code: null })], [value('2026-09-30')], [], today, {
      savingsRate: 0.03,
      tdsRate: 0,
      navs,
    });
    expect(p.lines.mf!.basis).toBe('carried_forward');
  });

  it('marks S$ balances as using a live rate when one is supplied', () => {
    const p = buildPortfolio(
      [asset({ id: 'sg', currency: 'SGD' })],
      [obs({ id: 's', asset_id: 'sg', amount: 100, currency: 'SGD', fx_rate: 65 })],
      [],
      today,
      { savingsRate: 0.03, tdsRate: 0, fxToday: { SGD: 74.263 } },
    );
    expect(p.netWorth.total).toBeCloseTo(7426.3, 6);
    expect(p.lines.sg!.marketDate).toBe('live');
  });
});
