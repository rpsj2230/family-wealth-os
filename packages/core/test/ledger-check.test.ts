import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG,
  ledgerAdvice,
  ledgerCheck,
  ledgerSummary,
  openingFlow,
  orderLines,
  valuationUnits,
  type LedgerLine,
} from '../src';

const TOL = {
  units: DEFAULT_CONFIG.funds.unitTolerance,
  money: DEFAULT_CONFIG.funds.moneyTolerance,
};
const FROM = DEFAULT_CONFIG.funds.historyFrom;

/** A synthetic statement: lines with a running balance, starting from `opening` units. */
function statement(
  rows: [date: string, units: number, nav: number, kind?: string][],
  opening = 0,
  source = 'cas',
): LedgerLine[] {
  let bal = opening;
  return rows.map(([date, units, nav, kind]) => {
    bal = Math.round((bal + units) * 1000) / 1000;
    return {
      date,
      kind: kind ?? (units > 0 ? 'sip' : 'redeem'),
      units,
      amount:
        units > 0 ? Math.round(units * nav * 100) / 100 : -Math.round(-units * nav * 100) / 100,
      nav,
      balance: bal,
      source,
    };
  });
}

const SIPS: [string, number, number][] = [
  ['2021-02-05', 100, 50],
  ['2021-03-05', 98.5, 50.76],
  ['2021-04-05', 95.2, 52.5],
  ['2021-05-05', 90.1, 55.5],
];

const check = (
  lines: LedgerLine[],
  units: number | null,
  unitsAsOf: string | null = '2021-05-31',
) =>
  ledgerCheck({
    lines,
    position: { units, unitsAsOf, invested: null, startedOn: null },
    tolerance: TOL,
    historyFrom: FROM,
  });

describe('ledgerCheck', () => {
  it('a history from the first instalment that adds up is complete', () => {
    const v = check(statement(SIPS), 383.8);
    expect(v.status).toBe('complete');
    expect(v.reliable).toBe(true);
    expect(v.figuresEstimated).toBe(false);
    expect(v.firstTxnOn).toBe('2021-02-05');
    expect(v.lastTxnOn).toBe('2021-05-05');
    expect(v.txnCount).toBe(4);
    expect(v.sources).toEqual(['cas']);
    expect(v.openingUnits).toBe(0);
    expect(v.ledgerUnits).toBeCloseTo(383.8, 3);
    expect(v.statementUnits).toBeCloseTo(383.8, 3);
    expect(v.chip.label).toBe('Reconciled');
    expect(v.fix).toBeNull();
  });

  it('units held before the first line are named, with their count', () => {
    const v = check(statement(SIPS, 250), 633.8);
    expect(v.status).toBe('starts_midway');
    expect(v.openingUnits).toBeCloseTo(250, 3);
    expect(v.reliable).toBe(false);
    expect(v.figuresEstimated).toBe(true);
    expect(v.chip.label).toBe('Starts midway: 250 units before first line');
    expect(v.notes.join(' ')).toContain('250 units were already held before the first line');
    expect(v.fix).toContain('DETAILED');
    expect(v.fix).toContain('1 Jan 2021');
  });

  it('a missing line is a gap, with the dates around it', () => {
    const lines = statement(SIPS);
    lines.splice(2, 1); // the April instalment is not on file
    const v = check(lines, 383.8);
    expect(v.status).toBe('gap');
    expect(v.breaks).toHaveLength(1);
    expect(v.breaks[0]).toMatchObject({ from: '2021-03-05', to: '2021-05-05' });
    expect(v.breaks[0]!.unexplained).toBeCloseTo(95.2, 3);
    expect(v.chip.label).toBe('Gap: 5 Mar 2021 to 5 May 2021');
    expect(v.notes.join(' ')).toContain('95.2 units appear between 5 Mar 2021 and 5 May 2021');
  });

  it('a line on file twice is a break the other way round', () => {
    const lines = statement(SIPS);
    lines.splice(2, 0, { ...lines[1]!, source: 'manual' });
    const v = check(lines, 383.8);
    expect(v.status).toBe('gap');
    expect(v.breaks[0]!.unexplained).toBeLessThan(0);
    expect(v.duplicates).toHaveLength(1);
    expect(v.duplicates[0]!.sources).toEqual(['cas', 'manual']);
    expect(v.notes.join(' ')).toContain('may be on file twice');
  });

  it('lines that chain but lead to a different unit count do not match', () => {
    const v = check(statement(SIPS), 400);
    expect(v.status).toBe('mismatch');
    expect(v.positionDiffers).toBe(true);
    expect(v.positionDifference).toBeCloseTo(16.2, 3);
    expect(v.chip.icon).toBe('✗');
    expect(v.chip.label).toBe("Doesn't match: ledger 383.8 vs statement 400");
  });

  it('compares with the unit count on its own date, not with today', () => {
    // 100 + 98.5 = 198.5 on 31 March; a count of 193.7 that day is a mismatch even though later lines exist
    const v = check(statement(SIPS), 193.7, '2021-03-31');
    expect(v.ledgerUnitsAtPositionDate).toBeCloseTo(198.5, 3);
    expect(v.positionDiffers).toBe(true);
    expect(check(statement(SIPS), 198.5, '2021-03-31').status).toBe('complete');
  });

  it('the tolerance is a setting: a rounding difference passes, a larger one does not', () => {
    expect(check(statement(SIPS), 383.8004).status).toBe('complete');
    const strict = ledgerCheck({
      lines: statement(SIPS),
      position: { units: 383.8004, unitsAsOf: '2021-05-31', invested: null, startedOn: null },
      tolerance: { units: 0.0001, money: 1 },
    });
    expect(strict.status).toBe('mismatch');
  });

  it('lines assumed from the plan are counted but never trusted', () => {
    const real = statement(SIPS);
    const est: LedgerLine[] = [
      {
        date: '2021-06-05',
        kind: 'sip',
        units: 90,
        amount: 5000,
        nav: 55.5,
        balance: null,
        source: 'estimate',
        description: 'Estimated SIP instalment, not yet on a statement',
      },
    ];
    const v = check([...real, ...est], 383.8);
    expect(v.status).toBe('complete');
    expect(v.txnCount).toBe(4);
    expect(v.estimatedCount).toBe(1);
    expect(v.estimatedUnits).toBe(90);
    expect(v.sources).toEqual(['cas']);
    expect(v.notes.join(' ')).toContain('assumed from the plan');
    // only estimates: nothing real to rely on
    const only = check(est, null);
    expect(only.status).toBe('estimated');
    expect(only.figuresEstimated).toBe(true);
    expect(only.chip.label).toBe('Estimated');
  });

  it('no lines at all is its own state', () => {
    const v = check([], 100);
    expect(v.status).toBe('no_transactions');
    expect(v.txnCount).toBe(0);
    expect(v.fix).toContain('Add a transaction');
  });

  it('lines without a running balance are checked against the unit count only', () => {
    const lines = statement(SIPS).map((l) => ({ ...l, balance: null, source: 'manual' }));
    expect(check(lines, 383.8).status).toBe('complete');
    expect(check(lines, 383.8).basis).toBe('unit_count');
    expect(check(lines, 500).status).toBe('mismatch');
    // nothing to check against
    expect(check(lines, null).status).toBe('estimated');
  });

  it('a manual line after a statement keeps the chain', () => {
    const lines = statement(SIPS);
    lines.push({
      date: '2021-06-01',
      kind: 'purchase',
      units: 10,
      amount: 600,
      nav: 60,
      balance: null,
      source: 'manual',
    });
    const v = check(lines, 393.8, '2021-06-30');
    expect(v.status).toBe('complete');
    expect(v.ledgerClosingUnits).toBeCloseTo(393.8, 3);
  });

  it('two folios keep their own balances and are not read as a break', () => {
    const a = statement([['2021-02-05', 100, 50]]).map((l) => ({ ...l, folio: 'A1' }));
    const b = statement([['2021-02-20', 40, 51]]).map((l) => ({ ...l, folio: 'B2' }));
    const c = statement([['2021-03-05', 20, 52]], 100).map((l) => ({ ...l, folio: 'A1' }));
    const v = check([...a, ...b, ...c], 160);
    expect(v.status).toBe('complete');
    expect(v.folios).toBe(2);
    // the unit count of one folio only is a mismatch, and the note says why
    const one = check([...a, ...b, ...c], 120);
    expect(one.status).toBe('mismatch');
    expect(one.notes.join(' ')).toContain('2 folios');
  });

  it('cost of the units held against the recorded amount, only when the comparison is fair', () => {
    const lines = statement(SIPS);
    const held = lines.reduce((x, l) => x + l.amount, 0);
    const same = ledgerCheck({
      lines,
      position: { units: 383.8, unitsAsOf: '2021-05-31', invested: held, startedOn: null },
      heldCost: held,
      tolerance: TOL,
    });
    expect(same.investedDifference).toBeNull();
    const off = ledgerCheck({
      lines,
      position: { units: 383.8, unitsAsOf: '2021-05-31', invested: held + 500, startedOn: null },
      heldCost: held,
      tolerance: TOL,
    });
    expect(off.investedDifference).toBeCloseTo(-500, 2);
    expect(off.notes.join(' ')).toContain('cost of the units held');
    expect(off.netMoneyIn).toBeCloseTo(held, 2);
    // units from before the first line: the comparison is not fair, so none is made
    const mid = ledgerCheck({
      lines: statement(SIPS, 250),
      position: { units: 633.8, unitsAsOf: '2021-05-31', invested: 99999, startedOn: null },
      heldCost: held,
      tolerance: TOL,
    });
    expect(mid.investedDifference).toBeNull();
  });
});

describe('orderLines', () => {
  it('puts the lines of one day in the order the running balance gives', () => {
    // a purchase and a full sale on the same day, stored in the wrong order
    const ok: LedgerLine[] = [
      { date: '2021-02-05', units: 100, amount: 5000, balance: 100 },
      { date: '2021-03-05', units: 50, amount: 2500, balance: 150 },
      { date: '2021-03-05', units: -150, amount: -7600, balance: 0 },
    ];
    const jumbled = [ok[0]!, ok[2]!, ok[1]!];
    expect(orderLines(jumbled, 0.001).map((l) => l.balance)).toEqual([100, 150, 0]);
    // and the verdict does not break on it
    const v = ledgerCheck({ lines: jumbled, position: null, tolerance: TOL });
    expect(v.breaks).toHaveLength(0);
  });

  it('with no balances, purchases come before sales on the same day', () => {
    const out = orderLines(
      [
        { date: '2021-03-05', units: -10, amount: -500 },
        { date: '2021-03-05', units: 5, amount: 250 },
      ],
      0.001,
    );
    expect(out.map((l) => l.units)).toEqual([5, -10]);
  });
});

describe('opening flow and valuation units', () => {
  it('units before the first line are valued at the first line price', () => {
    const lines = statement(SIPS, 250);
    expect(openingFlow(lines, 0.001)).toEqual({ date: '2021-02-05', units: 250, amount: 12500 });
    expect(openingFlow(statement(SIPS), 0.001)).toBeNull();
    expect(openingFlow([], 0.001)).toBeNull();
  });

  it('value is worked out from the ledger only when it reconciles and is newer than the recorded count', () => {
    const lines = statement(SIPS);
    const fresh = ledgerCheck({
      lines,
      position: { units: 198.5, unitsAsOf: '2021-03-31', invested: null, startedOn: null },
      tolerance: TOL,
    });
    // the recorded count is older than the last line and consistent with the lines up to its date
    expect(fresh.status).toBe('complete');
    expect(valuationUnits(fresh)).toEqual({ units: 383.8, from: 'ledger' });
    const same = check(lines, 383.8, '2021-05-31');
    expect(valuationUnits(same)).toEqual({ units: 383.8, from: 'recorded' });
    const broken = check(lines, 400);
    expect(valuationUnits(broken)).toEqual({ units: 400, from: 'recorded' });
    expect(valuationUnits(check([], null))).toEqual({ units: null, from: 'none' });
  });
});

describe('ledgerSummary', () => {
  const mk = (
    id: string,
    name: string,
    v: ReturnType<typeof check>,
    startedOn: string | null = null,
  ) => ({ assetId: id, name, startedOn, verdict: v });
  const ok = check(statement(SIPS), 383.8);
  const mid = check(statement(SIPS, 250), 633.8);
  const gap = (() => {
    const l = statement(SIPS);
    l.splice(2, 1);
    return check(l, 383.8);
  })();

  it('counts funds per person and lists those that need history', () => {
    const [p] = ledgerSummary(
      [
        {
          ownerId: 'a',
          name: 'Asha',
          funds: [
            mk('1', 'One', ok),
            mk('2', 'Two', mid),
            mk('3', 'Three', gap),
            mk('4', 'Four', check([], null)),
          ],
        },
      ],
      { historyFrom: FROM, unitTolerance: TOL.units },
    );
    expect(p!.funds).toBe(4);
    expect(p!.complete).toBe(1);
    expect(p!.byStatus).toMatchObject({
      complete: 1,
      starts_midway: 1,
      gap: 1,
      no_transactions: 1,
    });
    expect(p!.headline).toBe(
      '1 of 4 funds reconciles with their statements. 1 need earlier history; 1 has missing lines; 1 has no statement lines yet.',
    );
    expect(p!.need.map((n) => n.name)).toEqual(['Two', 'Three', 'Four']);
    expect(p!.need[0]!.why).toContain('250 units');
    expect(p!.fix).toContain('DETAILED');
  });

  it('flags a person whose earliest transaction is later than the history date while funds started earlier', () => {
    const late = check(statement([['2023-02-05', 10, 50]], 40), 50, '2023-03-01');
    const [p] = ledgerSummary(
      [{ ownerId: 'a', name: 'Asha', funds: [mk('1', 'One', late, '2020-05-01')] }],
      { historyFrom: FROM, unitTolerance: TOL.units },
    );
    expect(p!.earliestTxnOn).toBe('2023-02-05');
    expect(p!.startsLate).toBe(true);
    expect(p!.lateNote).toContain('5 Feb 2023');
    expect(p!.lateNote).toContain('1 Jan 2021');
    // a person whose funds all began after the history date is fine
    const [q] = ledgerSummary(
      [
        {
          ownerId: 'b',
          name: 'Bala',
          funds: [mk('1', 'One', check(statement(SIPS), 383.8), '2021-02-05')],
        },
      ],
      { historyFrom: FROM, unitTolerance: TOL.units },
    );
    expect(q!.startsLate).toBe(false);
    expect(q!.fix).toBeNull();
    // the date is a setting, not a constant
    const [r] = ledgerSummary(
      [{ ownerId: 'a', name: 'Asha', funds: [mk('1', 'One', late, '2020-05-01')] }],
      { historyFrom: '2023-06-01', unitTolerance: TOL.units },
    );
    expect(r!.startsLate).toBe(false);
  });

  it('advice names the history date from Settings', () => {
    expect(ledgerAdvice('starts_midway', '2019-04-01')).toContain('1 Apr 2019');
    expect(ledgerAdvice('complete')).toBeNull();
  });
});
