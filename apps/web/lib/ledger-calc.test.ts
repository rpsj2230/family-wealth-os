import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG,
  estimateFundUnitsWithSip,
  flowsOfFund,
  ledgerCheck,
  monthlyContributions,
  openingFlow,
  returnsFor,
  xirr,
  type FundForReturns,
  type LedgerLine,
} from '@fwos/core';
import { fundLedger } from './fund-ledger';
import type { CasTxn } from '@fwos/ingest';

/**
 * A synthetic fund that starts in 2021 with monthly instalments, takes in a switch and a reinvested dividend, charges a stamp duty
 * line, is partly redeemed and then switched out in part. Every figure below is worked out by hand in the comments, so the code under
 * test (lots, cost, sales, flows, the return, the value) is checked against arithmetic and not against itself.
 */
const L = (
  date: string,
  kind: CasTxn['kind'],
  units: number,
  amount: number,
  nav: number,
  balance: number,
): CasTxn => ({ date, kind, description: '', amount, units, nav, balance });

const TXNS: CasTxn[] = [
  L('2021-03-05', 'sip', 100, 5000, 50, 100), // lot 1: 100 units, cost 5000
  L('2021-03-05', 'other', 0, 0.25, 50, 100), // stamp duty: no units
  L('2021-04-05', 'sip', 98, 5000, 51.0204, 198), // lot 2: 98 units, cost 5000
  L('2021-05-05', 'sip', 95, 5000, 52.6316, 293), // lot 3: 95 units, cost 5000
  L('2021-06-10', 'switch_in', 180, 9900, 55, 473), // lot 4: 180 units, cost 9900
  L('2022-03-01', 'dividend_reinvest', 10, 600, 60, 483), // lot 5: 10 units, cost 600
  L('2022-08-01', 'redeem', -150, -10500, 70, 333), // 100 of lot 1 + 50 of lot 2
  L('2023-01-10', 'switch_out', -100, -7500, 75, 233), // 48 of lot 2 + 52 of lot 3
];

describe('lots, cost and sales on a ledger that starts in 2021', () => {
  const led = fundLedger({ txns: TXNS, costValue: null, unitsHeld: 233 });

  it('adds up to the closing balance and sells the oldest units first', () => {
    expect(led.reconciled).toBe(true);
    expect(led.lots.map((l) => l.acquiredOn)).toEqual(['2021-05-05', '2021-06-10', '2022-03-01']);
    // lot 3 has 95 - 52 = 43 units left
    expect(led.lots[0]!.units).toBeCloseTo(43, 6);
    expect(led.lots[1]!.units).toBeCloseTo(180, 6);
    expect(led.lots[2]!.units).toBeCloseTo(10, 6);
    expect(led.lots.reduce((a, l) => a + l.units, 0)).toBeCloseTo(233, 6);
  });

  it('keeps the cost of what is still held in proportion (invested is not the money put in)', () => {
    // lot 3: 5000 x 43/95 = 2263.1579; lot 4: 9900; lot 5: 600
    const held = led.lots.reduce((a, l) => a + (l.cost ?? 0), 0);
    expect(led.lots[0]!.cost).toBeCloseTo(2263.1579, 3);
    expect(held).toBeCloseTo(2263.1579 + 9900 + 600, 3);
    // net money in is a different number: 5000x3 + 9900 + 600 - 10500 - 7500 = 7500
    const netIn = TXNS.filter((t) => t.units > 0).reduce((a, t) => a + t.amount, 0) - 18000;
    expect(netIn).toBeCloseTo(7500 + 0.0, 0);
    expect(held).not.toBeCloseTo(netIn, 0);
  });

  it('books each sale against the purchases it used', () => {
    // sale 1: 150 units @ 70: 100 units of lot 1 (cost 5000) and 50 of lot 2 (cost 5000 x 50/98)
    const r = led.realised;
    expect(r).toHaveLength(4);
    expect(r[0]).toMatchObject({ soldOn: '2022-08-01', acquiredOn: '2021-03-05', units: 100 });
    expect(r[0]!.cost).toBeCloseTo(5000, 6);
    expect(r[0]!.proceeds).toBeCloseTo(7000, 6);
    expect(r[1]).toMatchObject({ soldOn: '2022-08-01', acquiredOn: '2021-04-05' });
    expect(r[1]!.units).toBeCloseTo(50, 6);
    expect(r[1]!.cost).toBeCloseTo((5000 * 50) / 98, 6);
    expect(r[1]!.proceeds).toBeCloseTo(3500, 6);
    // sale 2 (a switch out): 48 units left of lot 2 and 52 of lot 3, at 75 a unit
    expect(r[2]).toMatchObject({ soldOn: '2023-01-10', acquiredOn: '2021-04-05' });
    expect(r[2]!.units).toBeCloseTo(48, 6);
    expect(r[3]!.units).toBeCloseTo(52, 6);
    expect(r[3]!.cost).toBeCloseTo((5000 * 52) / 95, 6);
    // all the proceeds are accounted for
    expect(r.reduce((a, x) => a + x.proceeds, 0)).toBeCloseTo(18000, 6);
  });

  it('the stamp duty line is not a purchase or a sale', () => {
    expect(led.lots.some((l) => l.units === 0)).toBe(false);
    expect(led.realised.every((x) => x.units > 0)).toBe(true);
  });

  it('is reconciled by the data check, with no break and the first line as the start', () => {
    const lines: LedgerLine[] = TXNS.map((t) => ({ ...t, source: 'cas' }));
    const v = ledgerCheck({
      lines,
      position: {
        units: 233,
        unitsAsOf: '2026-10-26',
        invested: 12763.1579,
        startedOn: '2021-03-05',
      },
      heldCost: led.lots.reduce((a, l) => a + (l.cost ?? 0), 0),
      tolerance: {
        units: DEFAULT_CONFIG.funds.unitTolerance,
        money: DEFAULT_CONFIG.funds.moneyTolerance,
      },
    });
    expect(v.status).toBe('complete');
    expect(v.breaks).toEqual([]);
    expect(v.openingUnits).toBe(0);
    expect(v.firstTxnOn).toBe('2021-03-05');
    expect(v.boughtAmount).toBeCloseTo(5000 * 3 + 9900 + 600 + 0.25 * 0, 6);
    expect(v.soldAmount).toBe(18000);
    expect(v.investedDifference).toBeNull();
  });
});

describe('the return (XIRR) and the flows', () => {
  const lines = TXNS.map((t) => ({
    date: t.date,
    units: t.units,
    amount: Math.abs(t.amount),
    kind: t.kind,
    nav: t.nav,
    balance: t.balance,
  }));
  const plan = { invested: 12763.16, startedOn: '2021-03-05', sipMonthly: null, sipStopped: true };

  it('money in is negative, money out and the value today are positive, and a dividend reinvested is no cash flow', () => {
    const f: FundForReturns = {
      assetId: 'a',
      ownerId: 'o',
      name: 'Synthetic',
      value: 233 * 80,
      txns: lines,
      plan,
    };
    const r = returnsFor([f], '2026-10-26');
    // by hand: 3 SIPs and a switch in go out (-5000, -5000, -5000, -9900); 10500 and 7500 come back; the value 18640 comes back
    const by = [
      { date: new Date('2021-03-05T00:00:00Z'), amount: -5000 },
      { date: new Date('2021-04-05T00:00:00Z'), amount: -5000 },
      { date: new Date('2021-05-05T00:00:00Z'), amount: -5000 },
      { date: new Date('2021-06-10T00:00:00Z'), amount: -9900 },
      { date: new Date('2022-08-01T00:00:00Z'), amount: 10500 },
      { date: new Date('2023-01-10T00:00:00Z'), amount: 7500 },
      { date: new Date('2026-10-26T00:00:00Z'), amount: 18640 },
    ];
    const expected = xirr(by);
    expect(r.xirr).toBeCloseTo(expected.rate!, 6);
    expect(r.invested).toBe(24900); // the 600 reinvested is not money put in
    expect(r.redeemed).toBe(18000);
    expect(r.gain).toBe(Math.round(18640 + 18000 - 24900));
  });

  it('the stamp duty line (no units) moves no money in the flows', () => {
    const fl = flowsOfFund({ txns: lines, plan, today: '2026-10-26' });
    expect(fl.flows.some((x) => x.amount === 0.25)).toBe(false);
    // 3 SIPs + a switch in + 2 sales (the dividend is left out)
    expect(fl.flows).toHaveLength(6);
    expect(fl.flows.filter((x) => x.amount > 0)).toHaveLength(4);
    expect(fl.estimated).toBe(false);
  });

  it('units held before the first line are counted as put in on that day, at that day price', () => {
    const mid = TXNS.map((t) => ({ ...t, balance: (t.balance ?? 0) + 250 }));
    const o = openingFlow(mid, DEFAULT_CONFIG.funds.unitTolerance);
    expect(o).toEqual({ date: '2021-03-05', units: 250, amount: 12500 });
    const base: FundForReturns = {
      assetId: 'a',
      ownerId: 'o',
      name: 'S',
      value: 483 * 80,
      txns: lines,
      plan,
    };
    const without = returnsFor([{ ...base, value: (233 + 250) * 80 }], '2026-10-26');
    const withOpening = returnsFor(
      [{ ...base, value: (233 + 250) * 80, txns: [...lines, o!] }],
      '2026-10-26',
    );
    // ignoring the 250 units' cost overstates the return
    expect(without.xirr!).toBeGreaterThan(withOpening.xirr!);
    expect(withOpening.invested).toBe(24900 + 12500);
  });

  it('a purchase on the same day as a full sale is ordered by the balance, not by the order stored', () => {
    const day: CasTxn[] = [
      L('2024-01-01', 'purchase', 100, 1000, 10, 100),
      L('2024-06-01', 'redeem', -100, -1500, 15, 0),
      L('2024-06-01', 'purchase', 40, 600, 15, 40),
    ];
    // stored the wrong way round: the sale first, then the purchase, then the opening purchase
    const jumbled = [day[2]!, day[1]!, day[0]!];
    // the purchase of 40 starts from 0 (after the sale), so its balance chain puts it last
    const ok = fundLedger({ txns: jumbled, costValue: null, unitsHeld: 40 });
    expect(ok.reconciled).toBe(true);
    expect(ok.lots).toHaveLength(1);
    expect(ok.lots[0]).toMatchObject({ acquiredOn: '2024-06-01' });
    expect(ok.lots[0]!.units).toBeCloseTo(40, 6);
    expect(ok.realised[0]).toMatchObject({ acquiredOn: '2024-01-01', units: 100 });
  });
});

describe('the value is units times the price', () => {
  it('value = units x the latest price when no instalment is assumed', () => {
    const e = estimateFundUnitsWithSip({
      units: 233,
      unitsAsOf: new Date('2026-10-01T00:00:00Z'),
      anchorAmount: 17000,
      anchorAsOf: new Date('2026-10-01T00:00:00Z'),
      navToday: 80.5,
      navOn: () => 79,
      sip: null,
      today: new Date('2026-10-26T00:00:00Z'),
    });
    expect(e.estimatedAmount).toBeCloseTo(233 * 80.5, 6);
    expect(e.basis).toBe('calculated');
  });

  it('an assumed instalment since the units were counted adds the units it would have bought, and is marked estimated', () => {
    const e = estimateFundUnitsWithSip({
      units: 233,
      unitsAsOf: new Date('2026-09-20T00:00:00Z'),
      anchorAmount: 17000,
      anchorAsOf: new Date('2026-09-20T00:00:00Z'),
      navToday: 80,
      navOn: () => 78,
      sip: { monthly: 5000, startedOn: '2021-03-05', stopped: false },
      today: new Date('2026-10-26T00:00:00Z'),
    });
    // one instalment (5 Oct) bought at 78 is worth 5000 x 80/78 today
    expect(e.estimatedAmount).toBeCloseTo(233 * 80 + (5000 * 80) / 78, 4);
    expect(e.basis).toBe('estimated');
  });
});

describe('monthly money in, by month', () => {
  it('counts SIP instalments, one-off and moved money apart, and leaves the stamp duty and a dividend out of "SIP"', () => {
    const rows = TXNS.map((t) => ({
      date: t.date,
      kind: t.kind,
      units: t.units,
      amount: t.amount,
    }));
    const m = monthlyContributions(rows, '2021-06-30', 4);
    const by = Object.fromEntries(m.map((x) => [x.month, x]));
    expect(by['2021-03']).toMatchObject({ sip: 5000, lump: 0, moved: 0, out: 0 });
    expect(by['2021-06']).toMatchObject({ sip: 0, moved: 9900 });
  });
});
