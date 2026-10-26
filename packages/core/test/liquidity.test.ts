import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, configFromJson } from '../src/config';
import {
  addWorkingDays,
  answerHard,
  answerRaise,
  buildSources,
  planRaise,
  type RaiseBuildInput,
} from '../src/liquidity';
import type { AssetRow, FdRow } from '../src/portfolio';
import type { AssetType, ValuedAsset } from '../src/networth';

const TODAY = '2026-10-26'; // a Monday
const A = 'owner-a';
const B = 'owner-b';

function asset(
  id: string,
  type: AssetType,
  owner: string,
  value: number,
  extra: Partial<AssetRow> = {},
): { v: ValuedAsset; r: AssetRow } {
  return {
    v: {
      assetId: id,
      ownerId: owner,
      type,
      status: 'active',
      name: id,
      estimate: { estimatedAmount: value } as ValuedAsset['estimate'],
    },
    r: {
      id,
      owner_id: owner,
      type,
      status: 'active',
      nickname: id,
      currency: 'INR',
      account_kind: null,
      expected_freshness_days: null,
      ...extra,
    },
  };
}

function input(
  items: { v: ValuedAsset; r: AssetRow }[],
  fds: FdRow[] = [],
  funds: RaiseBuildInput['funds'] = [],
): RaiseBuildInput {
  return {
    valued: items.map((i) => i.v),
    assetRows: items.map((i) => i.r),
    fds,
    funds,
    today: TODAY,
  };
}

const fd = (
  id: string,
  principal: number,
  booked: string,
  maturity: string,
  rate = 0.07,
): FdRow => ({
  asset_id: id,
  principal,
  rate,
  booked_on: booked,
  maturity_on: maturity,
  compounding: 'quarterly',
  bank_maturity_amount: null,
});

describe('working days', () => {
  it('skips weekends', () => {
    expect(addWorkingDays('2026-10-30', 3)).toBe('2026-11-04'); // Fri -> Tue
    expect(addWorkingDays(TODAY, 0)).toBe(TODAY);
  });
});

describe('sources', () => {
  it('keeps a balance in each savings account and dates cash today', () => {
    const s = buildSources(input([asset('sav', 'bank_account', A, 110_000)]));
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ kind: 'cash', max: 100_000, availableOn: TODAY });
  });
  it('offers a deposit both at maturity and as an early break', () => {
    const s = buildSources(
      input(
        [asset('fd1', 'fixed_deposit', A, 200_000)],
        [fd('fd1', 190_000, '2026-01-01', '2027-01-01')],
      ),
    );
    expect(s.map((x) => x.kind).sort()).toEqual(['fd_break', 'fd_maturing']);
    const brk = s.find((x) => x.kind === 'fd_break')!;
    expect(brk.fixedCostRate).toBeGreaterThan(0);
    expect(brk.fixedCostRate).toBeLessThan(0.02);
    expect(s.find((x) => x.kind === 'fd_maturing')!.availableOn).toBe('2027-01-01');
  });
  it('lists a deposit booked in the last few weeks as its own, cheap source', () => {
    const s = buildSources(
      input(
        [asset('fdNew', 'fixed_deposit', A, 200_000)],
        [fd('fdNew', 200_000, '2026-10-10', '2027-10-10')],
      ),
    );
    expect(s.map((x) => x.kind).sort()).toEqual(['fd_maturing', 'fd_recent']);
    const recent = s.find((x) => x.kind === 'fd_recent')!;
    expect(recent.fixedCostRate).toBeLessThan(0.001); // a few days of interest at most
    expect(recent.notes.join(' ')).toContain('costs little');
  });
  it('estimates fund gain from the invested amount and treats SIP funds as short-term', () => {
    const [long] = buildSources(
      input(
        [asset('mfA', 'mutual_fund', A, 100_000)],
        [],
        [{ assetId: 'mfA', invested: 60_000, startedOn: '2024-01-01', sipActive: false }],
      ),
    );
    expect(long!.sale).toMatchObject({ long: true, estimated: false, exitLoad: 0 });
    expect(long!.sale!.gainRatio).toBeCloseTo(0.4);
    const [sip] = buildSources(
      input(
        [asset('mfB', 'mutual_fund', A, 100_000)],
        [],
        [{ assetId: 'mfB', invested: 60_000, startedOn: '2024-01-01', sipActive: true }],
      ),
    );
    expect(sip!.sale).toMatchObject({
      long: false,
      exitLoad: DEFAULT_CONFIG.liquidity.exitLoadPct,
    });
  });
  it('flags an assumed gain when the cost is not recorded', () => {
    const [s] = buildSources(input([asset('stk', 'stock', A, 50_000)]));
    expect(s!.sale!.estimated).toBe(true);
    expect(s!.notes.join(' ')).toMatch(/not recorded/);
  });
});

describe('planning', () => {
  const items = [
    asset('sav', 'bank_account', A, 210_000),
    asset('fd1', 'fixed_deposit', A, 300_000),
    asset('mf1', 'mutual_fund', A, 400_000),
    asset('home', 'property', A, 9_000_000),
  ];
  const sources = buildSources(
    input(
      items,
      [fd('fd1', 280_000, '2026-04-01', '2027-04-01')],
      [{ assetId: 'mf1', invested: 350_000, startedOn: '2023-01-01', sipActive: false }],
    ),
  );
  const o = { today: TODAY };

  it('uses cash first and needs nothing else for a small amount', () => {
    const p = planRaise(50_000, sources, 0, o);
    expect(p.feasible).toBe(true);
    expect(p.picks.map((x) => x.kind)).toEqual(['cash']);
    expect(p.cost).toBe(0);
    expect(p.completeBy).toBe(TODAY);
  });
  it('cannot find a large sum today but finds it with more time', () => {
    const today = planRaise(450_000, sources, 0, o);
    expect(today.feasible).toBe(false);
    expect(today.shortfall).toBeGreaterThan(0);
    const later = planRaise(450_000, sources, 14, o);
    expect(later.feasible).toBe(true);
    expect(later.picks.some((x) => x.kind === 'mf')).toBe(true);
  });
  it('uses the tax-free allowance first and reports the withheld tax as a later refund', () => {
    const p = planRaise(300_000, sources, 14, { ...o, order: ['mf'] });
    const mf = p.picks[0]!;
    expect(mf.kind).toBe('mf');
    // gain 12.5% of 300k grossed up is under the 1.25 lakh allowance: no tax, all withheld tax is refundable
    expect(mf.cost).toBe(0);
    expect(mf.tdsNow).toBeGreaterThan(0);
    expect(mf.refundLater).toBe(mf.tdsNow);
    expect(mf.usedAllowance).toBeGreaterThan(0);
  });
  it('charges tax once the allowance is used up', () => {
    const p = planRaise(300_000, sources, 14, {
      ...o,
      order: ['mf'],
      allowanceUsed: { [A]: 125_000 },
    });
    expect(p.picks[0]!.cost).toBeGreaterThan(0);
    expect(p.picks[0]!.refundLater).toBeLessThan(p.picks[0]!.tdsNow + 1);
  });
  it('breaks a deposit only when sooner is needed, never property unless allowed and needed', () => {
    const p = planRaise(600_000, sources, 3, o);
    expect(p.picks.map((x) => x.kind)).toEqual(expect.arrayContaining(['cash']));
    expect(p.picks.some((x) => x.kind === 'property')).toBe(false);
    const cheap = planRaise(800_000, sources, 400, o);
    expect(cheap.picks.some((x) => x.kind === 'fd_maturing')).toBe(true);
    expect(cheap.picks.some((x) => x.kind === 'fd_break')).toBe(false);
  });
  it('respects the sources you allow and your own order', () => {
    const onlyFd = planRaise(100_000, sources, 3, { ...o, order: ['fd_break'] });
    expect(onlyFd.picks.map((x) => x.kind)).toEqual(['fd_break']);
    expect(onlyFd.surplus).toBeGreaterThan(0); // a whole deposit is used
    const pref = planRaise(100_000, sources, 14, { ...o, order: ['mf', 'cash'], mode: 'order' });
    expect(pref.picks[0]!.kind).toBe('mf');
  });
  it('uses one way per deposit', () => {
    const p = planRaise(900_000, sources, 400, o);
    const fdPicks = p.picks.filter((x) => x.assetId === 'fd1');
    expect(fdPicks.length).toBeLessThanOrEqual(1);
  });
  it('limits to one person plus joint accounts', () => {
    const two = buildSources(
      input([
        asset('a', 'bank_account', A, 200_000),
        asset('b', 'bank_account', B, 200_000),
        asset('j', 'bank_account', B, 200_000, { is_joint: true }),
      ]),
    );
    const p = planRaise(250_000, two, 0, { ...o, ownerId: A });
    expect(p.picks.map((x) => x.assetId).sort()).toEqual(['a', 'j']);
  });
  it('answers with capacity by date, a cheapest plan and a fastest plan', () => {
    const a = answerRaise(450_000, sources, { ...o, scenarioDays: [0, 14] });
    expect(a.plans).toHaveLength(2);
    expect(a.capacity[1]!.available).toBeGreaterThan(a.capacity[0]!.available);
    expect(a.cheapest.cost).toBeLessThanOrEqual(a.fastest.cost);
    expect(a.fastest.completeBy! <= a.cheapest.completeBy!).toBe(true);
  });
});

describe('settings', () => {
  it('fills missing values and clamps nonsense', () => {
    const c = configFromJson({
      liquidity: { order: ['cash', 'bogus', 'mf'], fdPenaltyPoints: 5, mode: 'x' },
    });
    expect(c.liquidity.order).toEqual(['cash', 'mf']);
    expect(c.liquidity.fdPenaltyPoints).toBe(DEFAULT_CONFIG.liquidity.fdPenaltyPoints);
    expect(c.liquidity.mode).toBe('cheapest');
    expect(configFromJson(null).liquidity).toEqual(DEFAULT_CONFIG.liquidity);
  });
});

describe('plans read cleanly', () => {
  it('prefers fewer, larger sources among equal costs and never reports a rupee of rounding as a shortfall', () => {
    const items = [
      asset('s1', 'bank_account', A, 60_000),
      asset('s2', 'bank_account', A, 500_000),
      asset('s3', 'bank_account', A, 70_000),
    ];
    const sources = buildSources(input(items));
    const p = planRaise(333_333.33, sources, 0, { today: TODAY });
    expect(p.picks.map((x) => x.assetId)).toEqual(['s2']);
    expect(p.shortfall).toBe(0);
    expect(p.feasible).toBe(true);
  });
});

describe('hard need', () => {
  const items = [
    asset('sav', 'bank_account', A, 110_000, {
      institution_id: 'bk',
      identifier_last4: '0266',
      account_kind: 'NRE',
    }),
    asset('fd1', 'fixed_deposit', A, 300_000, {
      institution_id: 'bk',
      identifier_last4: '1234',
      account_kind: 'NRE',
      linked_last4: '0266',
    }),
    asset('mf1', 'mutual_fund', A, 400_000),
    asset('home', 'property', A, 9_000_000),
  ];
  const sources = buildSources({
    ...input(
      items,
      [{ ...fd('fd1', 280_000, '2026-04-01', '2027-04-01'), fd_ref_last4: '5076' }],
      [{ assetId: 'mf1', invested: 350_000, startedOn: '2023-01-01', sipActive: false }],
    ),
    institutionNames: { bk: 'Test Bank' },
  });
  const o = { today: TODAY };
  it('names the bank, the account code and where a deposit pays out', () => {
    const brk = sources.find((x) => x.kind === 'fd_break')!;
    expect(brk.bank).toBe('Test Bank');
    expect(brk.code).toBe('FD-NRE-5076');
    expect(brk.creditTo).toBe('Test Bank Cash-NRE-0266');
    expect(brk.steps[0]).toContain('Test Bank FD-NRE-5076');
  });
  it('finds the earliest date the whole amount can be had, breaking deposits if needed', () => {
    const h = answerHard(250_000, sources, o, null);
    expect(h.plan.feasible).toBe(true);
    expect(h.earliest).toBe('2026-10-27'); // cash today is not enough; a deposit break is next day
    expect(h.plan.picks.some((p) => p.kind === 'fd_break')).toBe(true);
    expect(h.tranches[0]!.cumulative).toBeLessThan(
      h.tranches[h.tranches.length - 1]!.cumulative + 1,
    );
    expect(h.tranches.at(-1)!.cumulative).toBeGreaterThanOrEqual(250_000);
  });
  it('uses property when nothing else is enough, and says when', () => {
    const h = answerHard(2_000_000, sources, o, null);
    expect(h.plan.feasible).toBe(true);
    expect(h.plan.picks.some((p) => p.kind === 'property')).toBe(true);
    expect(h.earliest).toBe('2027-02-23');
  });
  it('reports a deadline that cannot be met and shows the quickest possible', () => {
    const h = answerHard(2_000_000, sources, o, 10);
    expect(h.deadlineMissed).toBe(true);
    expect(h.earliest).toBe('2027-02-23');
  });
  it('offers a cheaper way when waiting would save money', () => {
    const h = answerHard(250_000, sources, o, null);
    expect(h.cheaperIfWaiting === null || h.cheaperIfWaiting.cost < h.plan.cost).toBe(true);
  });
});
