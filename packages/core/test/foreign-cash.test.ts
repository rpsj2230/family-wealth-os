import { describe, expect, it } from 'vitest';
import { buildBankBlocks, filterBlocksByOwner } from '../src/accounts-view';
import { bankOverview, type OverviewOptions } from '../src/bank-overview';
import {
  datedForeignCash,
  foreignCash,
  foreignRupeeLine,
  foreignShort,
  formatForeign,
  formatRate,
  mergeForeignCash,
  shortDay,
  sumForeignCash,
} from '../src/foreign-cash';
import { classCards } from '../src/home';
import {
  buildPortfolio,
  DEFAULT_ASSUMPTIONS,
  type AssetRow,
  type ObservationRow,
} from '../src/portfolio';

const today = new Date('2026-10-27T00:00:00Z');
const asset = (o: Partial<AssetRow> & { id: string }): AssetRow => ({
  owner_id: 'a',
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
  as_of: '2026-10-20',
  confidence: 'manual_confirmed',
  source: 'manual',
  created_at: '2026-10-20T00:00:00Z',
  superseded_by: null,
  ...o,
});

// Anil: an INR account and a SGD account at Equitas, a second SGD account and a USD account at Yes Bank. Beena: INR only.
const assets: AssetRow[] = [
  asset({ id: 'inr1', sort_order: 1 }),
  asset({ id: 'sgd1', currency: 'SGD', sort_order: 2 }),
  asset({ id: 'sgd2', currency: 'SGD', institution_id: 'yb', sort_order: 3 }),
  asset({ id: 'usd1', currency: 'USD', institution_id: 'yb', sort_order: 4 }),
  asset({ id: 'inr2', owner_id: 'b', institution_id: 'yb', sort_order: 5 }),
  asset({ id: 'sgd-closed', currency: 'SGD', status: 'closed', sort_order: 6 }),
  asset({ id: 'fd', type: 'fixed_deposit', account_kind: null, sort_order: 7 }),
];
const observations: ObservationRow[] = [
  obs({ id: '1', asset_id: 'inr1', amount: 200_000 }),
  obs({ id: '2', asset_id: 'sgd1', amount: 41_250, currency: 'SGD', fx_rate: 55 }),
  obs({
    id: '3',
    asset_id: 'sgd2',
    amount: 8_750,
    currency: 'SGD',
    fx_rate: 55.5,
    as_of: '2026-10-05',
  }),
  obs({ id: '4', asset_id: 'usd1', amount: 2_000, currency: 'USD', fx_rate: 83 }),
  obs({ id: '5', asset_id: 'inr2', amount: 300_000 }),
  obs({ id: '6', asset_id: 'sgd-closed', amount: 999, currency: 'SGD', fx_rate: 55 }),
];
const fds = [
  {
    asset_id: 'fd',
    principal: 500_000,
    rate: 0.07,
    booked_on: '2026-01-10',
    maturity_on: '2027-10-26',
    compounding: 'quarterly' as const,
    bank_maturity_amount: null,
  },
];
const fx = {
  SGD: { rate: 56.1, date: '2026-10-27' },
  USD: { rate: 84.2, date: '2026-10-27' },
};
const live = buildPortfolio(assets, observations, fds, today, {
  ...DEFAULT_ASSUMPTIONS,
  fxToday: { SGD: 56.1, USD: 84.2 },
});

describe('foreignCash', () => {
  const f = foreignCash(assets, live.valued, observations, fx);

  it('adds the accounts of each currency, the one worth most in rupees first', () => {
    expect(f.map((x) => x.currency)).toEqual(['SGD', 'USD']);
    const sgd = f[0]!;
    expect(sgd.native).toBe(41_250 + 8_750);
    expect(sgd.accounts).toBe(2);
    expect(sgd.inr).toBeCloseTo(50_000 * 56.1, 4);
    expect(f[1]!.native).toBe(2_000);
    expect(f[1]!.inr).toBeCloseTo(2_000 * 84.2, 4);
  });

  it('takes the rate as the rupee value over the balance and dates it from the rate on file', () => {
    const sgd = f[0]!;
    expect(sgd.rate).toBeCloseTo(56.1, 9);
    expect(sgd.rateDate).toBe('2026-10-27');
    expect(sgd.rateLive).toBe(true);
  });

  it('uses exactly the rupee value net worth counts, so the Cash total is untouched', () => {
    const rupees = live.valued.find((v) => v.assetId === 'sgd1')!.estimate!.estimatedAmount;
    expect(
      foreignCash(assets, live.valued, observations, fx, { institutionId: 'eq' })[0]!.inr,
    ).toBe(rupees);
    // the whole Cash figure is the rupee accounts plus every foreign account at its rupee value
    const cash = live.netWorth.byType.bank_account!;
    const inrAccounts = live.valued
      .filter((v) => ['inr1', 'inr2'].includes(v.assetId))
      .reduce((s, v) => s + v.estimate!.estimatedAmount, 0);
    const foreignInr = f.reduce((s, x) => s + x.inr, 0);
    // net worth sums to the paisa
    expect(cash).toBeCloseTo(inrAccounts + foreignInr, 1);
    // and the closed account is in none of it
    expect(f[0]!.native).not.toBe(50_000 + 999);
  });

  it('scopes to a person or a bank', () => {
    expect(foreignCash(assets, live.valued, observations, fx, { ownerId: 'b' })).toEqual([]);
    const eq = foreignCash(assets, live.valued, observations, fx, { institutionId: 'eq' });
    expect(eq.map((x) => [x.currency, x.native])).toEqual([['SGD', 41_250]]);
  });

  it('shows nothing when all cash is in rupees', () => {
    const inrOnly = assets.filter((a) => a.currency === 'INR');
    expect(foreignCash(inrOnly, live.valued, observations, fx)).toEqual([]);
  });

  it('says the rate was the one recorded with the balance when no rate is on file', () => {
    const noFx = buildPortfolio(assets, observations, fds, today);
    const g = foreignCash(assets, noFx.valued, observations, {});
    const sgd = g[0]!;
    expect(sgd.rateLive).toBe(false);
    // 41,250 at 55 and 8,750 at 55.5, as recorded
    expect(sgd.inr).toBeCloseTo(41_250 * 55 + 8_750 * 55.5, 4);
    expect(sgd.rateDate).toBe('2026-10-20');
    expect(foreignRupeeLine(sgd)).toContain('rate recorded 20 Oct');
  });

  it('does not call a rate on file the one used when the value rests on another', () => {
    const noFx = buildPortfolio(assets, observations, fds, today);
    const d = datedForeignCash(sumForeignCash([{ currency: 'SGD', native: 100, inr: 5_500 }]), {
      SGD: { rate: 56.1, date: '2026-10-27' },
    });
    expect(d[0]!.rateLive).toBe(false);
    expect(noFx.valued.length).toBe(live.valued.length);
  });
});

describe('words', () => {
  it('writes a balance in its own currency with the usual thousands grouping', () => {
    expect(formatForeign(41_250, 'SGD')).toBe('S$ 41,250');
    expect(formatForeign(1_234_567, 'SGD')).toBe('S$ 1,234,567');
    expect(formatForeign(2_000, 'USD')).toBe('US$ 2,000');
    expect(formatForeign(1500.4, 'EUR')).toBe('€ 1,500');
  });
  it('writes the code when no symbol is known', () => {
    expect(formatForeign(12_000, 'AED')).toBe('AED 12,000');
  });
  it('trims the rate to what it needs', () => {
    expect(formatRate(56.1)).toBe('56.1');
    expect(formatRate(83.5234)).toBe('83.52');
    expect(formatRate(1.2)).toBe('1.2');
    expect(formatRate(0.5612)).toBe('0.5612');
  });
  it('writes the day without the year', () => {
    expect(shortDay('2026-10-27')).toBe('27 Oct');
    expect(shortDay('2026-01-05')).toBe('5 Jan');
  });
  it('gives the small rupee line with the rate and its day', () => {
    const [sgd] = foreignCash(assets, live.valued, observations, fx);
    expect(foreignRupeeLine(sgd!)).toBe('≈ ₹28.05 L at 1 SGD = ₹56.1, rate of 27 Oct');
    expect(foreignShort(sgd!)).toBe('S$ 50,000 ≈ ₹28.05 L');
  });
});

describe('sums', () => {
  it('leaves rupees and empty balances out', () => {
    expect(
      sumForeignCash([
        { currency: 'INR', native: 5, inr: 5 },
        { currency: 'SGD', native: 0, inr: 0 },
      ]),
    ).toEqual([]);
  });
  it('merges groups and keeps the account count', () => {
    const a = sumForeignCash([{ currency: 'SGD', native: 100, inr: 5_600, asOf: '2026-10-01' }]);
    const b = sumForeignCash([
      { currency: 'SGD', native: 50, inr: 2_800, asOf: '2026-10-09' },
      { currency: 'USD', native: 10, inr: 840 },
    ]);
    const m = mergeForeignCash(a, b);
    expect(m.map((x) => [x.currency, x.native, x.accounts, x.asOf])).toEqual([
      ['SGD', 150, 2, '2026-10-09'],
      ['USD', 10, 1, null],
    ]);
  });
});

describe('through the bank blocks and the overview', () => {
  const portfolio = live;
  const blocks = buildBankBlocks({
    assets,
    observations,
    fds,
    portfolio,
    institutionNames: { eq: 'Equitas', yb: 'Yes Bank' },
    today,
  });
  const opts: OverviewOptions = { today, soonDays: 30, defaultSavingsRate: 0.03, fx };
  const ov = bankOverview(blocks, opts);

  it('gives the overview the same foreign cash as the net-worth route, with the Cash total unchanged', () => {
    expect(ov.foreign.map((x) => [x.currency, x.native, x.accounts])).toEqual([
      ['SGD', 50_000, 2],
      ['USD', 2_000, 1],
    ]);
    const fromNetWorth = foreignCash(assets, portfolio.valued, observations, fx);
    expect(ov.foreign.map((x) => x.inr)).toEqual(fromNetWorth.map((x) => x.inr));
    // the main Cash figure is the INR accounts plus every foreign account converted, as before
    const rupeeAccounts = 200_000 + 300_000;
    expect(ov.parts.cash.current).toBeCloseTo(
      rupeeAccounts + ov.foreign.reduce((s, x) => s + x.inr, 0) + savingsInterest(portfolio),
      1,
    );
    expect(ov.parts.cash.current).toBeCloseTo(portfolio.netWorth.byType.bank_account!, 1);
    expect(ov.foreign[0]!.rateDate).toBe('2026-10-27');
  });

  it('puts the part on each person, bank and section header and keeps their cash totals as they were', () => {
    const [eq, yb] = blocks;
    expect(eq!.totals.foreign.map((x) => [x.currency, x.native])).toEqual([['SGD', 41_250]]);
    expect(yb!.totals.foreign.map((x) => [x.currency, x.native])).toEqual([
      ['SGD', 8_750],
      ['USD', 2_000],
    ]);
    // a person with only rupees has none
    const beena = yb!.sections.find((s) => s.ownerId === 'b')!;
    expect(beena.totals.foreign).toEqual([]);
    const anil = yb!.sections.find((s) => s.ownerId === 'a')!;
    expect(anil.totals.foreign.length).toBe(2);
    // the person filter works the part out again
    const only = filterBlocksByOwner(blocks, 'b');
    expect(only.every((b) => b.totals.foreign.length === 0)).toBe(true);
    const mine = filterBlocksByOwner(blocks, 'a');
    expect(
      mine.flatMap((b) => b.totals.foreign.map((x) => x.native)).sort((p, q) => p - q),
    ).toEqual([2_000, 8_750, 41_250]);
    // totals still add up: cash of every block equals the overview's cash
    expect(blocks.reduce((s, b) => s + b.totals.cash, 0)).toBeCloseTo(ov.parts.cash.current, 4);
  });

  it('puts a person’s part in the overview people list', () => {
    const anil = ov.people.find((p) => p.ownerId === 'a')!;
    const beena = ov.people.find((p) => p.ownerId === 'b')!;
    expect(anil.foreign.map((x) => x.currency)).toEqual(['SGD', 'USD']);
    expect(beena.foreign).toEqual([]);
  });

  it('leaves the Home cash card total as it was and adds the part', () => {
    const base = {
      netWorth: portfolio.netWorth.total,
      fd: ov.parts.fd,
      fdToday: 0,
      awaiting: { count: 0, invested: 0, current: 0 },
      cash: ov.parts.cash,
      cashToday: 0,
      othersHeld: ov.parts.others,
      funds: null,
      earned: {},
    };
    const without = classCards(base).find((c) => c.key === 'cash')!;
    const withIt = classCards({ ...base, cashForeign: ov.foreign }).find((c) => c.key === 'cash')!;
    expect(withIt.current).toBe(without.current);
    expect(without.foreign).toEqual([]);
    expect(withIt.foreign.map((x) => x.currency)).toEqual(['SGD', 'USD']);
    // no other card carries one
    expect(
      classCards({ ...base, cashForeign: ov.foreign })
        .filter((c) => c.key !== 'cash')
        .every((c) => c.foreign.length === 0),
    ).toBe(true);
  });
});

/** Interest the rupee accounts have earned since their balances were recorded (the cash total includes it). */
function savingsInterest(p: typeof live): number {
  return ['inr1', 'inr2'].reduce((s, id) => {
    const e = p.valued.find((v) => v.assetId === id)!.estimate!;
    return s + (e.estimatedAmount - e.anchorAmount);
  }, 0);
}
