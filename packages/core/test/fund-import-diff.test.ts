import { describe, expect, it } from 'vitest';
import {
  changedItems,
  chipsOf,
  diffFundImport,
  judgeSip,
  matchLines,
  readSip,
  sipIsChange,
  statementLineKeys,
  storedChanges,
  summariseChanges,
  type FundImportInput,
  type OnFileFund,
  type OnFileLine,
  type OnFileState,
  type StatementFund,
  type StatementLine,
} from '../src';

const RULES = { sipMinInstalments: 3, unitTolerance: 0.001, moneyTolerance: 1 };
const WEEKLY = ['2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24', '2026-08-31', '2026-09-07'];

type RawLine = { date: string; kind: string; amount: number; units: number };
const raw = (date: string, kind: string, amount: number, units?: number): RawLine => ({
  date,
  kind,
  amount,
  units: units ?? Math.round((amount / 100) * 1000) / 1000,
});
function lines(folio: string, rows: RawLine[]): StatementLine[] {
  const keys = statementLineKeys(folio, rows);
  return rows.map((r, i) => ({
    key: keys[i]!,
    date: r.date,
    kind: r.kind,
    description: r.kind,
    amount: r.amount,
    units: r.units,
    nav: 100,
    balance: null,
  }));
}
/** monthly SIP instalments on the 5th, from `from` for `n` months */
function monthly(from: string, n: number, amount: number): RawLine[] {
  const [y, m] = from.split('-').map(Number) as [number, number];
  return Array.from({ length: n }, (_, i) => {
    const mm = ((m - 1 + i) % 12) + 1;
    const yy = y + Math.floor((m - 1 + i) / 12);
    return raw(`${yy}-${String(mm).padStart(2, '0')}-05`, 'sip', amount);
  });
}

function stFund(o: Partial<StatementFund> = {}): StatementFund {
  return {
    name: 'Sample Flexi Cap Fund',
    isin: 'INF000A01AB1',
    amfiCode: null,
    folioLast4: '5678',
    lines: [],
    closingUnits: 100,
    openingUnits: 0,
    held: true,
    invested: 10_000,
    startedOn: '2023-01-05',
    value: { amount: 12_000, asOf: '2026-10-25', nav: 120 },
    holdingsOnly: false,
    soldThisYear: false,
    match: { status: 'one', assetId: 'f1' },
    ...o,
  };
}
function state(o: Partial<OnFileState> = {}): OnFileState {
  return {
    units: 100,
    invested: 10_000,
    sipMonthly: null,
    sipStopped: false,
    sipChanges: [],
    lines: [],
    latestValue: { asOf: '2026-10-20', amount: 11_900 },
    snapshots: [],
    ignored: [],
    ...o,
  };
}
function onFile(o: Partial<OnFileFund> & { state?: OnFileState | null } = {}): OnFileFund {
  return {
    assetId: 'f1',
    name: 'Sample Flexi Cap Fund',
    isin: 'INF000A01AB1',
    amfiCode: null,
    folioLast4: '5678',
    status: 'active',
    unitsAsOf: '2026-10-20',
    startedOn: '2023-01-05',
    state: state(),
    ...o,
  };
}
function input(o: Partial<FundImportInput> = {}): FundImportInput {
  return {
    ownerId: 'o1',
    source: 'statement',
    complete: true,
    periodFrom: '2023-01-01',
    periodTo: '2026-10-25',
    today: '2026-10-26',
    funds: [],
    onFile: [],
    rules: RULES,
    ...o,
  };
}
const asOnFile = (ls: StatementLine[], source = 'cas'): OnFileLine[] =>
  ls.map((l) => ({
    key: l.key,
    date: l.date,
    kind: l.kind,
    amount: l.amount,
    units: l.units,
    source,
  }));
const item = (d: ReturnType<typeof diffFundImport>, key = 'o1|f1') =>
  d.items.find((i) => i.key === key)!;

describe('new funds', () => {
  it('proposes a fund that is not on file when it is held, with every line', () => {
    const ls = lines('5678', [raw('2025-01-05', 'purchase', 10_000)]);
    const d = diffFundImport(
      input({ funds: [stFund({ lines: ls, match: { status: 'none' } })], onFile: [] }),
    );
    const i = d.items[0]!;
    expect(i.kind).toBe('new');
    expect(i.assetId).toBeNull();
    expect(i.lines.newCount).toBe(1);
    expect(i.write!.create).toMatchObject({ name: 'Sample Flexi Cap Fund', closed: false });
    expect(i.write!.position).toMatchObject({
      invested: 10_000,
      units: 100,
      startedOn: '2023-01-05',
    });
    expect(i.write!.valuation).toMatchObject({ amount: 12_000, snapshot: true, observation: true });
    expect(chipsOf(i).map((c) => c.label)).toEqual(['New fund', '+1 transaction']);
  });

  it('keeps a fund sold this financial year (for the tax on the sale) and skips one sold long ago', () => {
    const sold = stFund({
      name: 'Sold This Year',
      isin: 'INF000C03EF3',
      held: false,
      closingUnits: 0,
      invested: 0,
      soldThisYear: true,
      match: { status: 'none' },
      value: { amount: 0, asOf: '2026-10-25', nav: 120 },
    });
    const old = stFund({
      name: 'Sold Long Ago',
      isin: 'INF000D04GH4',
      held: false,
      closingUnits: 0,
      invested: 0,
      match: { status: 'none' },
    });
    const d = diffFundImport(input({ funds: [sold, old] }));
    expect(d.items).toHaveLength(1);
    expect(d.items[0]!.write!.create!.closed).toBe(true);
    expect(chipsOf(d.items[0]!)[0]!.label).toBe('New fund, already sold');
    expect(d.skipped).toBe(1);
  });

  it('leaves an ambiguous scheme for review', () => {
    const d = diffFundImport(input({ funds: [stFund({ match: { status: 'ambiguous' } })] }));
    expect(d.items[0]!.kind).toBe('review');
    expect(d.items[0]!.write).toBeNull();
  });

  it('records the SIP of a new fund, and a SIP that has already ended', () => {
    const running = stFund({
      match: { status: 'none' },
      lines: lines('5678', monthly('2026-07-05', 4, 5000)),
    });
    const a = diffFundImport(input({ funds: [running] })).items[0]!;
    expect(a.sip).toMatchObject({ kind: 'new', after: 5000, effectiveOn: '2026-07-05' });
    const ended = stFund({
      match: { status: 'none' },
      lines: lines('5678', monthly('2025-01-05', 6, 5000)),
    });
    const b = diffFundImport(input({ funds: [ended] })).items[0]!;
    expect(b.sip!.kind).toBe('stopped');
    expect(b.sip!.write).toEqual([
      { monthly: 5000, effectiveOn: '2025-01-05' },
      { monthly: 0, effectiveOn: '2025-07-06' },
    ]);
  });
});

describe('sold', () => {
  const other = stFund({
    name: 'Another Fund',
    isin: 'INF000E05IJ5',
    match: { status: 'one', assetId: 'f2' },
  });
  const files = [
    onFile({ assetId: 'f2', name: 'Another Fund', isin: 'INF000E05IJ5', state: state() }),
    onFile({
      assetId: 'gone',
      name: 'Fund Not On The Statement',
      isin: 'INF999Z99ZZ9',
      state: state({ units: 50, invested: 5000, sipMonthly: 2000 }),
    }),
  ];

  it('a fund missing from a COMPLETE statement is sold, with the reason in plain words', () => {
    const d = diffFundImport(input({ funds: [other], onFile: files }));
    const i = item(d, 'o1|gone');
    expect(i.kind).toBe('sold');
    expect(i.why).toBe('Not on the statement dated 25 Oct 2026, which lists all your funds.');
    expect(i.write).toMatchObject({ close: true, markSoldAsOf: '2026-10-25' });
    expect(i.units).toEqual({ before: 50, after: 0 });
    expect(chipsOf(i).map((c) => c.label)).toContain('Sold');
    expect(i.ignore).toEqual({ verdict: 'sold', basis: '2026-10-25' });
  });

  it('is not claimed from a statement that is not complete', () => {
    const d = diffFundImport(input({ complete: false, funds: [other], onFile: files }));
    expect(d.items.find((i) => i.assetId === 'gone')).toBeUndefined();
  });

  it('is not claimed when a scheme on the statement could not be matched, and says why', () => {
    const stranger = stFund({
      name: 'Brand New Scheme',
      isin: 'INF000F06KL6',
      match: { status: 'none' },
    });
    const d = diffFundImport(input({ funds: [other, stranger], onFile: files }));
    expect(d.items.find((i) => i.assetId === 'gone')).toBeUndefined();
    expect(d.notes.join(' ')).toContain('could not be matched');
    expect(d.notes.join(' ')).toContain('Brand New Scheme');
  });

  it('is not claimed when a scheme is ambiguous', () => {
    const d = diffFundImport(
      input({ funds: [other, stFund({ match: { status: 'ambiguous' } })], onFile: files }),
    );
    expect(d.items.find((i) => i.assetId === 'gone')).toBeUndefined();
  });

  it('is not claimed from a statement that lists balances held with a depository only', () => {
    const d = diffFundImport(input({ funds: [{ ...other, holdingsOnly: true }], onFile: files }));
    expect(d.items.find((i) => i.assetId === 'gone')).toBeUndefined();
    expect(d.notes.join(' ')).toContain('depository');
  });

  it('is not claimed for a fund that started or was counted after the statement', () => {
    const later = [
      files[0]!,
      { ...files[1]!, assetId: 'new1', startedOn: '2026-11-02' },
      { ...files[1]!, assetId: 'new2', unitsAsOf: '2026-11-01' },
      { ...files[1]!, assetId: 'shut', status: 'closed' },
    ];
    const d = diffFundImport(input({ funds: [other], onFile: later }));
    expect(d.items.filter((i) => i.kind === 'sold')).toHaveLength(0);
  });

  it('is not claimed twice once the person overruled it for this statement', () => {
    const f = {
      ...files[1]!,
      state: state({ ignored: [{ verdict: 'sold' as const, basis: '2026-10-25' }] }),
    };
    const d = diffFundImport(input({ funds: [other], onFile: [files[0]!, f] }));
    const i = item(d, 'o1|gone');
    expect(i.kind).toBe('unchanged');
    expect(i.write).toBeNull();
    expect(changedItems(d)).toHaveLength(0);
    // a later statement raises it again
    const later = diffFundImport(
      input({ periodTo: '2026-11-25', funds: [other], onFile: [files[0]!, f] }),
    );
    expect(item(later, 'o1|gone').kind).toBe('sold');
  });

  it('a fund the statement shows fully redeemed is sold, and its SIP stops with it', () => {
    const redeemed = stFund({
      held: false,
      closingUnits: 0,
      invested: 0,
      lines: lines('5678', [raw('2026-09-10', 'redeem', -12_000, -100)]),
      value: { amount: 0, asOf: '2026-10-25', nav: 120 },
    });
    const f = onFile({ state: state({ sipMonthly: 5000 }) });
    const i = item(diffFundImport(input({ funds: [redeemed], onFile: [f] })));
    expect(i.kind).toBe('sold');
    expect(i.why).toContain('Fully redeemed');
    expect(i.write!.close).toBe(true);
    expect(i.write!.position.units).toBe(0);
    expect(i.sip).toMatchObject({ kind: 'stopped', effectiveOn: '2026-09-10' });
    expect(i.sip!.write).toEqual([{ monthly: 0, effectiveOn: '2026-09-10' }]);
    expect(i.invested).toEqual({ before: 10_000, after: 0 });
  });

  it('zero units with no sale on the statement is not a sale', () => {
    const empty = stFund({ held: false, closingUnits: 0, invested: 0, lines: [] });
    const d = diffFundImport(
      input({ funds: [empty], onFile: [onFile({ state: state({ units: 0, invested: 0 }) })] }),
    );
    expect(item(d).kind).not.toBe('sold');
  });

  it('a fund already closed on file is not "sold" again', () => {
    const redeemed = stFund({
      held: false,
      closingUnits: 0,
      invested: 0,
      lines: lines('5678', [raw('2026-09-10', 'redeem', -12_000, -100)]),
    });
    const f = onFile({ status: 'closed', state: state({ units: 0, invested: 0 }) });
    const i = item(diffFundImport(input({ funds: [redeemed], onFile: [f] })));
    expect(i.kind).not.toBe('sold');
  });
});

describe('transactions', () => {
  const stmtLines = lines('5678', [
    raw('2026-08-05', 'sip', 5000),
    raw('2026-09-05', 'sip', 5000),
    raw('2026-10-05', 'sip', 5000),
  ]);

  it('writes only the lines that are not on file, and counts the ones that are', () => {
    const f = onFile({
      state: state({ units: 100, sipMonthly: 5000, lines: asOnFile(stmtLines.slice(0, 2)) }),
    });
    const i = item(
      diffFundImport(
        input({ funds: [stFund({ lines: stmtLines, closingUnits: 100 })], onFile: [f] }),
      ),
    );
    expect(i.lines.newCount).toBe(1);
    expect(i.lines.duplicateCount).toBe(2);
    expect(i.write!.lines.map((l) => l.date)).toEqual(['2026-10-05']);
    expect(i.lines.newLines).toEqual([
      { date: '2026-10-05', kind: 'sip', amount: 5000, units: 50 },
    ]);
  });

  it('takes the same line from another file or app as the same line (date, units and amount)', () => {
    const other = stmtLines.map((l) => ({
      key: `other|${l.date}|csv`,
      date: l.date,
      kind: 'purchase',
      amount: l.amount + 0.4,
      units: l.units,
      source: 'cas',
    }));
    const m = matchLines(stmtLines, other, { units: 0.001, money: 1 });
    expect(m.fresh).toHaveLength(0);
    expect(m.duplicates).toBe(3);
  });

  it('two identical lines on one day are two lines', () => {
    const twice = lines('5678', [
      raw('2026-10-05', 'purchase', 1000),
      raw('2026-10-05', 'purchase', 1000),
    ]);
    expect(twice[0]!.key).not.toBe(twice[1]!.key);
    const m = matchLines(twice, asOnFile(twice.slice(0, 1)), { units: 0.001, money: 1 });
    expect(m.fresh).toHaveLength(1);
    expect(m.duplicates).toBe(1);
  });

  it('lines on file that the statement lacks are kept and reported, never written or removed', () => {
    const extra: OnFileLine = {
      key: 'manual-1',
      date: '2026-09-20',
      kind: 'purchase',
      amount: 777,
      units: 7.77,
      source: 'manual',
    };
    const f = onFile({ state: state({ lines: [...asOnFile(stmtLines), extra] }) });
    const i = item(diffFundImport(input({ funds: [stFund({ lines: stmtLines })], onFile: [f] })));
    expect(i.notes).toContain('1 line on file is not on this statement; kept.');
    expect(i.lines.keptNotOnStatement).toBe(1);
    expect(i.changed).toBe(false);
    expect(i.write).toBeNull();
  });

  it('stored estimates are not lines: a real line is still new, and the estimates are left to the database', () => {
    const est: OnFileLine = {
      key: 'est:2026-10-05',
      date: '2026-10-05',
      kind: 'sip',
      amount: 5000,
      units: 50,
      source: 'estimate',
    };
    const f = onFile({
      state: state({ units: 100, lines: [...asOnFile(stmtLines.slice(0, 2)), est] }),
    });
    const i = item(diffFundImport(input({ funds: [stFund({ lines: stmtLines })], onFile: [f] })));
    expect(i.lines.newCount).toBe(1);
    expect(i.lines.keptNotOnStatement).toBe(0);
  });
});

describe('nothing changed', () => {
  it('is left completely alone: no write, no item to apply', () => {
    const ls = lines('5678', monthly('2026-07-05', 4, 5000));
    const f = onFile({
      state: state({ sipMonthly: 5000, lines: asOnFile(ls), snapshots: [] }),
    });
    const d = diffFundImport(input({ funds: [stFund({ lines: ls })], onFile: [f] }));
    const i = item(d);
    expect(i.kind).toBe('unchanged');
    expect(i.write).toBeNull();
    expect(i.sip!.kind).toBe('unchanged');
    expect(sipIsChange(i.sip)).toBe(false);
    expect(changedItems(d)).toEqual([]);
    expect(summariseChanges(d.items)).toBe('Nothing changed');
  });

  it('a new price alone is not a change: units times the live price already follows the market', () => {
    const f = onFile({ state: state({ latestValue: { asOf: '2026-09-25', amount: 11_000 } }) });
    const i = item(diffFundImport(input({ funds: [stFund()], onFile: [f] })));
    expect(i.kind).toBe('unchanged');
    expect(i.write).toBeNull();
  });

  it('values within the tolerance are not rewritten', () => {
    const f = onFile({ state: state({ units: 100.0004, invested: 10_000.6 }) });
    const i = item(diffFundImport(input({ funds: [stFund()], onFile: [f] })));
    expect(i.write).toBeNull();
  });
});

describe('what is new or changed in the values', () => {
  const ls = lines('5678', [raw('2026-10-05', 'purchase', 2000, 20)]);
  it('writes only the changed fields, with before and after', () => {
    const f = onFile({ state: state({ units: 80, invested: 8000 }) });
    const i = item(diffFundImport(input({ funds: [stFund({ lines: ls })], onFile: [f] })));
    expect(i.units).toEqual({ before: 80, after: 100 });
    expect(i.invested).toEqual({ before: 8000, after: 10_000 });
    expect(i.write!.position).toEqual({
      units: 100,
      unitsAsOf: '2026-10-25',
      invested: 10_000,
      casAsOf: '2026-10-25',
    });
    expect(i.write!.valuation).toMatchObject({ amount: 12_000, observation: true, snapshot: true });
    expect(i.value).toEqual({ before: 11_900, after: 12_000, asOf: '2026-10-25' });
  });

  it('does not rewrite the stored value that is already on file for the date', () => {
    const f = onFile({
      state: state({
        units: 80,
        latestValue: { asOf: '2026-10-25', amount: 12_000 },
        snapshots: [{ asOf: '2026-10-25', value: 12_000, units: 100 }],
      }),
    });
    const i = item(diffFundImport(input({ funds: [stFund({ lines: ls })], onFile: [f] })));
    expect(i.write!.valuation).toBeNull();
  });

  it('does not replace a unit count dated after the statement', () => {
    const f = onFile({ unitsAsOf: '2026-10-30', state: state({ units: 130, invested: 13_000 }) });
    const i = item(diffFundImport(input({ funds: [stFund({ lines: ls })], onFile: [f] })));
    expect(i.units).toBeNull();
    expect(i.invested).toBeNull();
    expect(i.write!.position.units).toBeUndefined();
    expect(i.notes.join(' ')).toContain('newer than this statement');
  });

  it('a statement that starts long after the fund did cannot lower the units or the amount invested', () => {
    const f = onFile({
      startedOn: '2019-04-02',
      state: state({ units: 400, invested: 40_000 }),
    });
    const s = stFund({
      lines: ls,
      closingUnits: 20,
      invested: 2000,
      startedOn: '2026-10-05',
      openingUnits: 0,
    });
    const i = item(diffFundImport(input({ funds: [s], onFile: [f] })));
    expect(i.units).toBeNull();
    expect(i.invested).toBeNull();
    expect(i.startedOn).toBeNull();
    expect(i.notes.join(' ')).toContain('starts on');
    expect(i.write!.lines).toHaveLength(1);
  });

  it('an earlier first purchase is taken, a later one never replaces the known start date', () => {
    const earlier = diffFundImport(
      input({ funds: [stFund({ startedOn: '2022-12-01' })], onFile: [onFile()] }),
    );
    expect(item(earlier).startedOn).toEqual({ before: '2023-01-05', after: '2022-12-01' });
    const later = diffFundImport(
      input({ funds: [stFund({ startedOn: '2024-02-01' })], onFile: [onFile()] }),
    );
    expect(item(later).startedOn).toBeNull();
  });

  it('every value is taken as changed when nothing is known of what is stored', () => {
    const f = onFile({ state: null });
    const i = item(diffFundImport(input({ funds: [stFund()], onFile: [f] })));
    expect(i.kind).toBe('update');
    expect(i.write!.position).toMatchObject({ units: 100, invested: 10_000 });
  });
});

describe('reading a SIP from its own instalments', () => {
  it('finds the usual gap, how far an instalment strays from its due date, the run and the amount', () => {
    const r = readSip(
      lines('1', [...monthly('2026-01-05', 4, 5000), ...monthly('2026-05-05', 3, 8000)]),
      [],
      RULES,
    );
    expect(r.cadence).toEqual({ days: 31, deviation: 3, basis: 7 }); // months are 28 to 31 days: the SIP's own history says how much
    expect(r.runLength).toBe(7);
    expect(r.amount).toBe(8000);
    expect(r.amountSince).toBe('2026-05-05');
    expect(r.last).toBe('2026-07-05');
    expect(r.similar).toBe(true);
  });

  it('a weekly SIP has a weekly cadence and no lateness, a quarterly one a quarterly cadence', () => {
    const weekly = readSip(
      lines(
        '1',
        WEEKLY.map((d) => raw(d, 'sip', 1000)),
      ),
      [],
      RULES,
    );
    expect(weekly.cadence!.days).toBe(7);
    const quarterly = readSip(
      lines('1', [
        raw('2025-10-05', 'sip', 9000),
        raw('2026-01-05', 'sip', 9000),
        raw('2026-04-05', 'sip', 9000),
        raw('2026-07-05', 'sip', 9000),
      ]),
      [],
      RULES,
    );
    expect(quarterly.cadence!.days).toBe(91);
  });

  it('one odd instalment does not change the amount', () => {
    const r = readSip(
      lines('1', [...monthly('2026-01-05', 4, 5000), raw('2026-05-05', 'sip', 9000)]),
      [],
      RULES,
    );
    expect(r.amount).toBe(5000);
  });

  it('a missed due date ends the run; the gap does not count as lateness', () => {
    const r = readSip(
      lines('1', [...monthly('2026-01-05', 4, 5000), ...monthly('2026-08-05', 3, 5000)]),
      [],
      RULES,
    );
    expect(r.runLength).toBe(3);
    expect(r.runStart).toBe('2026-08-05');
    expect(r.cadence!.deviation).toBe(3);
  });

  it('only instalments count: purchases and sales do not, and fewer than the minimum is no pattern', () => {
    const none = readSip(
      lines('1', [raw('2026-05-05', 'purchase', 5000), raw('2026-06-05', 'redeem', -5000, -50)]),
      [],
      RULES,
    );
    expect(none.runLength).toBe(0);
    expect(none.cadence).toBeNull();
    expect(readSip(lines('1', monthly('2026-08-05', 2, 5000)), [], RULES).cadence).toBeNull();
  });

  it('instalments already stored count with those on the statement', () => {
    const stored = asOnFile(lines('1', monthly('2026-05-05', 3, 5000)));
    const r = readSip(lines('1', monthly('2026-08-05', 2, 5000)), stored, RULES);
    expect(r.instalments).toHaveLength(5);
    expect(r.cadence).not.toBeNull();
    expect(r.runLength).toBe(5);
  });
});

describe('SIP verdicts', () => {
  const run = (
    f: OnFileFund,
    ls: RawLine[],
    o: Partial<FundImportInput> = {},
    s: Partial<StatementFund> = {},
  ) =>
    item(
      diffFundImport(
        input({
          funds: [stFund({ lines: lines('5678', ls), ...s })],
          onFile: [f],
          ...o,
        }),
      ),
    ).sip;
  const withSip = (st: Partial<OnFileState> = {}, o: Partial<OnFileFund> = {}) =>
    onFile({ ...o, state: state({ sipMonthly: 5000, ...st }) });

  it('new SIP: none on file, a regular run found', () => {
    const v = run(onFile(), monthly('2026-07-05', 4, 3000))!;
    expect(v.kind).toBe('new');
    expect(v.after).toBe(3000);
    expect(v.effectiveOn).toBe('2026-07-05');
    expect(v.write).toEqual([{ monthly: 3000, effectiveOn: '2026-07-05' }]);
    expect(v.why).toContain('4 instalments of ₹3,000 monthly');
  });

  it('no SIP is invented from one-off purchases, too few instalments or uneven amounts', () => {
    expect(run(onFile(), [raw('2026-10-05', 'sip', 3000)])).toBeNull();
    expect(run(onFile(), monthly('2026-09-05', 2, 3000))).toBeNull();
    expect(
      run(onFile(), [
        raw('2026-07-05', 'sip', 3000),
        raw('2026-08-05', 'sip', 3000),
        raw('2026-09-05', 'sip', 9000),
      ]),
    ).toBeNull();
    expect(
      run(onFile(), [
        raw('2026-07-05', 'purchase', 3000),
        raw('2026-08-05', 'purchase', 3000),
        raw('2026-09-05', 'purchase', 3000),
      ]),
    ).toBeNull();
    expect(
      run(onFile(), [
        raw('2026-02-05', 'sip', 3000),
        raw('2026-06-05', 'sip', 3000),
        raw('2026-10-05', 'sip', 3000),
      ])!.kind,
    ).not.toBe('stopped'); // three instalments four months apart are a SIP at that cadence, not a stopped monthly one
  });

  it('the number of instalments that make a SIP is a setting', () => {
    const v = run(onFile(), monthly('2026-08-05', 3, 3000), {
      rules: { ...RULES, sipMinInstalments: 4 },
    });
    expect(v).toBeNull();
  });

  it('SIP stopped: the next due date and the usual lateness have passed and no instalment came', () => {
    const v = run(withSip(), monthly('2025-10-05', 6, 5000))!;
    expect(v.kind).toBe('stopped');
    // last instalment 5 Mar 2026, a gap of 31 days: due 5 Apr, up to 3 days late before; recorded from the first missed due date
    expect(v.effectiveOn).toBe('2026-04-05');
    expect(v.write).toEqual([{ monthly: 0, effectiveOn: '2026-04-05' }]);
    expect(v.why).toContain('The last instalment was on 5 Mar 2026');
    expect(v.why).toContain('due 5 Apr 2026');
    expect(v.why).toContain('up to 3 days late in the past');
  });

  it('on track: the next due date has not come, so nothing is called stopped', () => {
    const v = run(withSip(), monthly('2026-05-05', 6, 5000))!;
    expect(v.kind).toBe('unchanged');
    expect(v.why).toContain('the next is due 5 Nov 2026');
  });

  it('cannot tell yet: the due date has passed but this SIP has been that late before', () => {
    const v = run(withSip(), monthly('2026-05-05', 5, 5000), { periodTo: '2026-10-07' })!;
    expect(v.kind).toBe('cannot_tell');
    expect(v.write).toEqual([]);
    expect(v.why).toContain('Cannot tell yet');
    expect(run(withSip(), monthly('2026-05-05', 5, 5000), { periodTo: '2026-10-08' })!.kind).toBe(
      'stopped',
    );
  });

  it('the SIP is judged by its own pattern: a weekly SIP stops sooner than a monthly one, a quarterly later', () => {
    const weekly = WEEKLY.map((d) => raw(d, 'sip', 1000));
    expect(run(withSip({ sipMonthly: 1000 }), weekly, { periodTo: '2026-09-13' })!.kind).toBe(
      'unchanged',
    );
    expect(run(withSip({ sipMonthly: 1000 }), weekly, { periodTo: '2026-09-14' })!.kind).toBe(
      'cannot_tell',
    );
    expect(run(withSip({ sipMonthly: 1000 }), weekly, { periodTo: '2026-09-15' })!.kind).toBe(
      'stopped',
    );
    const quarterly = [
      raw('2025-10-05', 'sip', 9000),
      raw('2026-01-05', 'sip', 9000),
      raw('2026-04-05', 'sip', 9000),
      raw('2026-07-05', 'sip', 9000),
    ];
    // 40 days after the last instalment is far past a monthly due date and nothing for a quarterly SIP
    expect(run(withSip({ sipMonthly: 9000 }), quarterly, { periodTo: '2026-08-14' })!.kind).toBe(
      'unchanged',
    );
    expect(run(withSip({ sipMonthly: 9000 }), quarterly, { periodTo: '2026-10-25' })!.kind).toBe(
      'stopped',
    );
  });

  it('SIP stopped is also called from the lines already on file when the statement has none of them', () => {
    const f = withSip({ lines: asOnFile(lines('5678', monthly('2025-10-05', 6, 5000))) });
    const v = run(f, [], { periodFrom: '2026-04-01' }, { lines: [] })!;
    expect(v.kind).toBe('stopped');
    expect(v.effectiveOn).toBe('2026-04-05');
  });

  it('cannot tell: the statement starts after the missed due date, so it is no evidence', () => {
    const f = withSip({ lines: asOnFile(lines('5678', monthly('2025-10-05', 6, 5000))) });
    const v = run(f, [], { periodFrom: '2026-08-25' }, { lines: [] })!;
    expect(v.kind).toBe('cannot_tell');
    expect(v.why).toContain('starts on 25 Aug 2026');
    const d = diffFundImport(input({ periodFrom: '2026-08-25', funds: [stFund()], onFile: [f] }));
    expect(d.notes.join(' ')).toContain('could not be judged');
    expect(item(d).kind).toBe('unchanged');
    expect(item(d).write).toBeNull();
  });

  it('cannot tell: a fund with no instalments anywhere is left as recorded, "not verified by a statement"', () => {
    const v = run(withSip(), [], {}, { lines: [] })!;
    expect(v.kind).toBe('cannot_tell');
    expect(v.why).toContain('not verified by a statement');
    expect(v.write).toEqual([]);
    const few = run(withSip(), monthly('2026-09-05', 2, 5000))!;
    expect(few.kind).toBe('cannot_tell');
    expect(few.why).toContain('not verified by a statement');
  });

  it('cannot tell: a statement of balances only', () => {
    const v = run(withSip(), [], {}, { holdingsOnly: true })!;
    expect(v.kind).toBe('cannot_tell');
    expect(v.why).toContain('balances only');
  });

  it('a statement that says the SIP was cancelled is an explicit stop', () => {
    const v = run(
      withSip(),
      monthly('2026-05-05', 6, 5000),
      {},
      { sipCancelled: { on: '2026-10-12' } },
    )!;
    expect(v.kind).toBe('stopped');
    expect(v.effectiveOn).toBe('2026-10-12');
    expect(v.why).toContain('cancelled on 12 Oct 2026');
  });

  it('a new fund whose SIP ended in a cancellation says so, not that an instalment was missed', () => {
    const cancelled = stFund({
      match: { status: 'none' },
      lines: lines('5678', monthly('2026-01-05', 10, 10000)),
      sipCancelled: { on: '2026-10-26' },
    });
    const sip = diffFundImport(input({ funds: [cancelled] })).items[0]!.sip!;
    expect(sip.kind).toBe('stopped');
    expect(sip.effectiveOn).toBe('2026-10-26');
    expect(sip.why).toContain('cancelled on 26 Oct 2026');
    expect(sip.why).not.toContain('none came');
  });

  it('SIP resumed: stopped on file, instalments again after the stop date', () => {
    const f = withSip({
      sipStopped: true,
      sipChanges: [
        { from: '2023-01-05', monthly: 5000 },
        { from: '2026-04-05', monthly: 0 },
      ],
    });
    const v = run(f, [...monthly('2025-10-05', 6, 5000), ...monthly('2026-08-05', 3, 6000)])!;
    expect(v.kind).toBe('resumed');
    expect(v.after).toBe(6000);
    expect(v.effectiveOn).toBe('2026-08-05');
    expect(v.write).toEqual([{ monthly: 6000, effectiveOn: '2026-08-05' }]);
  });

  it('a SIP stopped on file stays stopped without new instalments, or with too few', () => {
    const f = withSip({ sipStopped: true, sipChanges: [{ from: '2026-04-05', monthly: 0 }] });
    expect(run(f, monthly('2025-10-05', 6, 5000))!.kind).toBe('unchanged');
    expect(
      run(f, [...monthly('2025-10-05', 6, 5000), ...monthly('2026-09-05', 2, 5000)])!.kind,
    ).toBe('unchanged');
  });

  it('SIP amount changed: from X to Y, dated from the first instalment at the new amount', () => {
    const v = run(withSip(), [
      ...monthly('2026-05-05', 2, 5000),
      ...monthly('2026-07-05', 4, 8000),
    ])!;
    expect(v.kind).toBe('changed');
    expect(v.before).toBe(5000);
    expect(v.after).toBe(8000);
    expect(v.effectiveOn).toBe('2026-07-05');
    expect(v.write).toEqual([{ monthly: 8000, effectiveOn: '2026-07-05' }]);
    expect(
      chipsOf({
        ...item(diffFundImport(input({ funds: [stFund()], onFile: [onFile()] }))),
        sip: v,
      }).map((c) => c.label),
    ).toContain('SIP ₹5,000 → ₹8,000');
  });

  it('the dated history decides what was in force: an old statement does not flag a change already recorded', () => {
    // the SIP was raised from 5000 to 8000 on 1 Jun 2026 and the history says so; an older statement still shows 5000
    const f = withSip({
      sipMonthly: 8000,
      sipChanges: [
        { from: '2023-01-05', monthly: 5000 },
        { from: '2026-06-01', monthly: 8000 },
      ],
    });
    const old = run(f, monthly('2026-01-05', 4, 5000), { periodTo: '2026-04-30' });
    expect(old!.kind).toBe('unchanged');
    expect(old!.before).toBe(5000);
    const now = run(f, monthly('2026-06-05', 5, 8000));
    expect(now!.kind).toBe('unchanged');
    // raised again after the last recorded change
    const raised = run(f, [...monthly('2026-06-05', 2, 8000), ...monthly('2026-08-05', 3, 10_000)]);
    expect(raised).toMatchObject({
      kind: 'changed',
      before: 8000,
      after: 10_000,
      effectiveOn: '2026-08-05',
    });
  });

  it('SIP unchanged: the same amount, running', () => {
    const v = run(withSip(), monthly('2026-07-05', 4, 5000))!;
    expect(v.kind).toBe('unchanged');
    expect(v.write).toEqual([]);
  });

  it('a few rupees of stamp duty on an instalment is the same amount', () => {
    const v = run(withSip(), [
      raw('2026-08-05', 'sip', 4999.75),
      raw('2026-09-05', 'sip', 4999.75),
      raw('2026-10-05', 'sip', 4999.75),
    ])!;
    expect(v.kind).toBe('unchanged');
  });

  it('a verdict the person overruled for these facts is not proposed again', () => {
    const f = withSip({ ignored: [{ verdict: 'sip_stopped', basis: '2026-03-05' }] });
    const v = run(f, monthly('2025-10-05', 6, 5000))!;
    expect(v.kind).toBe('ignored');
    expect(v.write).toEqual([]);
    expect(sipIsChange(v)).toBe(false);
    // the same SIP stopping again later has other facts and is raised again
    const again = run(
      withSip({ ignored: [{ verdict: 'sip_stopped', basis: '2026-03-05' }] }),
      monthly('2025-09-05', 8, 5000),
    )!;
    expect(again.kind).toBe('stopped');
  });

  it('no SIP verdict for a fund that is closed on file or not held', () => {
    expect(run(withSip({}, { status: 'closed' }), monthly('2025-10-05', 6, 5000))).toBeNull();
  });

  it('judgeSip: a new fund with a single instalment has no SIP', () => {
    expect(
      judgeSip({
        read: readSip(lines('1', [raw('2026-10-05', 'sip', 1000)]), [], RULES),
        end: '2026-10-25',
        periodFrom: '2026-01-01',
        rules: RULES,
        fund: null,
        held: true,
        holdingsOnly: false,
        hasLines: true,
        cancelled: null,
      }),
    ).toBeNull();
  });
});

describe('estimated lines and the dated history', () => {
  it('estimated SIP lines never count as the last instalment, so a real stop is still seen', () => {
    const est: OnFileLine[] = ['2026-08-05', '2026-09-05', '2026-10-05'].map((d) => ({
      key: `est:${d}`,
      date: d,
      kind: 'sip',
      amount: 5000,
      units: 50,
      source: 'estimate',
    }));
    const f = onFile({
      state: state({
        sipMonthly: 5000,
        lines: [...asOnFile(lines('5678', monthly('2025-10-05', 6, 5000))), ...est],
      }),
    });
    const d = diffFundImport(
      input({
        funds: [stFund({ lines: lines('5678', monthly('2025-10-05', 6, 5000)) })],
        onFile: [f],
      }),
    );
    expect(item(d).sip!.kind).toBe('stopped');
    expect(item(d).lines.newCount).toBe(0);
  });
});

describe('the write set never deletes or replaces', () => {
  it('carries only new lines and changed fields, whatever the statement lacks', () => {
    const have = lines('5678', [
      raw('2025-01-05', 'purchase', 5000),
      raw('2025-02-05', 'purchase', 5000),
    ]);
    const f = onFile({ state: state({ units: 100, invested: 10_000, lines: asOnFile(have) }) });
    const s = stFund({
      lines: lines('5678', [
        raw('2025-02-05', 'purchase', 5000),
        raw('2026-10-05', 'purchase', 1000),
      ]),
      closingUnits: 110,
      invested: 11_000,
    });
    const i = item(diffFundImport(input({ funds: [s], onFile: [f] })));
    expect(i.write!.lines.map((l) => l.date)).toEqual(['2026-10-05']);
    expect(Object.keys(i.write!)).toEqual(
      expect.arrayContaining(['create', 'lines', 'position', 'valuation', 'close', 'markSoldAsOf']),
    );
    expect(i.write!.close).toBe(false);
    expect(i.write!.markSoldAsOf).toBeNull();
    expect(i.notes).toContain('1 line on file is not on this statement; kept.');
  });
});

describe('words', () => {
  it('summarises what changed in one line', () => {
    const ls = lines('5678', [
      raw('2026-10-05', 'purchase', 2000, 20),
      raw('2026-10-06', 'purchase', 1000, 10),
    ]);
    const sold = onFile({
      assetId: 'gone',
      name: 'Gone Fund',
      isin: 'INF999Z99ZZ9',
      state: state({ units: 50, invested: 5000 }),
    });
    const stopped = onFile({
      assetId: 'f3',
      name: 'Stopped Fund',
      isin: 'INF000G07MN7',
      state: state({
        sipMonthly: 5000,
        lines: asOnFile(lines('9', monthly('2025-10-05', 6, 5000))),
      }),
    });
    const d = diffFundImport(
      input({
        funds: [
          stFund({ lines: ls, closingUnits: 130, invested: 13_000 }),
          stFund({
            name: 'Stopped Fund',
            isin: 'INF000G07MN7',
            match: { status: 'one', assetId: 'f3' },
            lines: lines('9', monthly('2025-10-05', 6, 5000)),
          }),
        ],
        onFile: [onFile({ state: state({ units: 100, invested: 10_000 }) }), sold, stopped],
      }),
    );
    expect(summariseChanges(d.items)).toBe(
      '1 fund updated: +2 transactions; 1 SIP stopped; 1 fund sold',
    );
    const stored = storedChanges(d.items, { funds: new Set(['o1|f1']), sips: new Set() });
    expect(stored.every((s) => !('write' in s))).toBe(true);
    expect(stored.find((s) => s.assetId === 'f1')!.applied).toBe(true);
    expect(stored.find((s) => s.assetId === 'gone')!.applied).toBe(false);
  });

  it('counts only what was applied', () => {
    const ls = lines('5678', [raw('2026-10-05', 'purchase', 2000, 20)]);
    const d = diffFundImport(
      input({
        funds: [stFund({ lines: ls, closingUnits: 120, invested: 12_000 })],
        onFile: [onFile()],
      }),
    );
    expect(summariseChanges(d.items, { funds: new Set(), sips: new Set() })).toBe(
      'Nothing changed',
    );
    expect(summariseChanges(d.items)).toBe('1 fund updated: +1 transaction');
  });

  it('names a new fund and the amount of a changed SIP', () => {
    const d = diffFundImport(
      input({
        funds: [
          stFund({
            match: { status: 'none' },
            lines: lines('5678', monthly('2026-07-05', 4, 3000)),
          }),
        ],
      }),
    );
    expect(summariseChanges(d.items)).toBe('1 new fund: +4 transactions; 1 SIP new');
  });
});
