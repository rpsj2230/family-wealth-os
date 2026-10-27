import { describe, expect, it } from 'vitest';
import {
  chipsOf,
  diffFundImport,
  fromInception,
  olderThanApplied,
  priorityTotals,
  replaceIsChange,
  replaceKey,
  sourceLabel,
  sourceRank,
  statementOutranks,
  statementReconciles,
  statementLineKeys,
  summariseChanges,
  SOURCE_PRECEDENCE,
  type FundImportInput,
  type OnFileFund,
  type OnFileLine,
  type OnFileState,
  type StatementFund,
  type StatementLine,
} from '../src';

const RULES = { sipMinInstalments: 3, unitTolerance: 0.001, moneyTolerance: 1 };

type Raw = { date: string; kind: string; amount: number; units: number };
const raw = (date: string, kind: string, amount: number, units: number): Raw => ({
  date,
  kind,
  amount,
  units,
});
function lines(rows: Raw[], folio = '5678'): StatementLine[] {
  const keys = statementLineKeys(folio, rows);
  let bal = 0;
  return rows.map((r, i) => {
    bal += r.units;
    return {
      key: keys[i]!,
      date: r.date,
      kind: r.kind,
      description: r.kind,
      amount: r.amount,
      units: r.units,
      nav: 100,
      balance: Math.round(bal * 1000) / 1000,
    };
  });
}
const asStored = (ls: StatementLine[], source: string): OnFileLine[] =>
  ls.map((l) => ({
    key: `${source}:${l.key}`,
    date: l.date,
    kind: l.kind,
    amount: l.amount,
    units: l.units,
    source,
  }));

/** a statement from 1 Jan 2025 to 27 Oct 2026 with three purchases: 300 units, ₹30,000 */
const STMT_ROWS = [
  raw('2025-01-10', 'purchase', 10_000, 100),
  raw('2025-06-10', 'purchase', 10_000, 100),
  raw('2026-10-27', 'purchase', 10_000, 100),
];
const STMT = lines(STMT_ROWS);

function stFund(o: Partial<StatementFund> = {}): StatementFund {
  return {
    name: 'Sample Flexi Cap Fund',
    isin: 'INF000A01AB1',
    amfiCode: null,
    folioLast4: '5678',
    lines: STMT,
    closingUnits: 300,
    openingUnits: 0,
    held: true,
    invested: 30_000,
    startedOn: '2025-01-10',
    value: { amount: 36_000, asOf: '2026-10-27', nav: 120 },
    holdingsOnly: false,
    soldThisYear: false,
    match: { status: 'one', assetId: 'f1' },
    ...o,
  };
}
function state(o: Partial<OnFileState> = {}): OnFileState {
  return {
    units: 300,
    invested: 30_000,
    sipMonthly: null,
    sipStopped: false,
    sipChanges: [],
    lines: [],
    latestValue: { asOf: '2026-10-20', amount: 35_000 },
    snapshots: [],
    ignored: [],
    cover: null,
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
    startedOn: '2025-01-10',
    state: state(),
    ...o,
  };
}
function input(o: Partial<FundImportInput> = {}): FundImportInput {
  return {
    ownerId: 'o1',
    source: 'statement',
    complete: true,
    basis: 'pan',
    periodFrom: '2025-01-01',
    periodTo: '2026-10-27',
    today: '2026-10-28',
    funds: [],
    onFile: [],
    rules: RULES,
    ...o,
  };
}
const item = (d: ReturnType<typeof diffFundImport>, key = 'o1|f1') =>
  d.items.find((i) => i.key === key)!;

describe('which record wins (the table)', () => {
  it('ranks the statement above an app export, the workbook, estimates and typed lines, in that order', () => {
    expect(SOURCE_PRECEDENCE.map((r) => r.source)).toEqual([
      'cas',
      'csv',
      'workbook',
      'estimate',
      'manual',
    ]);
    expect(sourceRank('cas')).toBeGreaterThan(sourceRank('csv'));
    expect(sourceRank('csv')).toBeGreaterThan(sourceRank('workbook'));
    expect(sourceRank('workbook')).toBeGreaterThan(sourceRank('estimate'));
    expect(sourceRank('estimate')).toBeGreaterThan(sourceRank('manual'));
    expect(sourceRank('file')).toBe(sourceRank('csv'));
    expect(sourceRank('something-new')).toBe(sourceRank('manual'));
    expect(statementOutranks('cas')).toBe(false);
    expect(statementOutranks('csv')).toBe(true);
    expect(sourceLabel('estimate')).toBe('Estimated');
  });
  it('lets only a newer or equal statement win, and reads a 1986 start as the beginning', () => {
    expect(olderThanApplied('2026-09-01', '2026-10-27')).toBe(true);
    expect(olderThanApplied('2026-10-27', '2026-10-27')).toBe(false);
    expect(olderThanApplied('2026-11-01', '2026-10-27')).toBe(false);
    expect(olderThanApplied(null, '2026-10-27')).toBe(false);
    expect(fromInception('1986-10-01')).toBe(true);
    expect(fromInception('2025-01-01')).toBe(false);
  });
});

describe('does a statement add up?', () => {
  it('checks opening plus the lines against the closing units', () => {
    expect(statementReconciles(stFund(), 0.001).ok).toBe(true);
    const bad = statementReconciles(stFund({ closingUnits: 310 }), 0.001);
    expect(bad.ok).toBe(false);
    expect(bad.reason).toContain('lead from 0 to 300 units');
  });
  it('uses the balance before the first line when the opening units are not printed', () => {
    expect(statementReconciles(stFund({ openingUnits: null }), 0.001).ok).toBe(true);
    expect(statementReconciles(stFund({ openingUnits: null, lines: [] }), 0.001).ok).toBe(false);
  });
  it('allows the unit tolerance and no more', () => {
    expect(statementReconciles(stFund({ closingUnits: 300.001 }), 0.001).ok).toBe(true);
    expect(statementReconciles(stFund({ closingUnits: 300.01 }), 0.001).ok).toBe(false);
  });
  it('never says yes to a holdings-only statement', () => {
    expect(statementReconciles(stFund({ holdingsOnly: true }), 0.001).ok).toBe(false);
  });
});

describe('the statement replaces lower-ranked lines inside its period', () => {
  const stored = (extra: OnFileLine[]) =>
    onFile({
      state: state({
        lines: extra,
        cover: { from: '2025-01-01', to: '2026-10-27' },
      }),
    });
  const L = (
    key: string,
    date: string,
    source: string,
    units = 55,
    amount = 5_500,
  ): OnFileLine => ({
    key,
    date,
    kind: 'purchase',
    amount,
    units,
    source,
  });

  it('replaces an app-export line, an estimate and a typed line that the statement does not have', () => {
    const d = diffFundImport(
      input({
        funds: [stFund()],
        onFile: [
          stored([
            L('c1', '2025-03-05', 'csv'),
            L('e1', '2025-04-05', 'estimate'),
            L('m1', '2025-05-05', 'manual'),
          ]),
        ],
      }),
    );
    const i = item(d);
    expect(i.lines.replace!.count).toBe(3);
    expect(i.lines.replace!.bySource).toEqual({ csv: 1, estimate: 1, manual: 1 });
    expect(i.write!.replace!.keys.sort()).toEqual(['c1', 'e1', 'm1']);
    expect(i.changed).toBe(true);
    expect(i.kind).toBe('update');
    expect(i.lines.newCount).toBe(3); // the statement's own lines are added
    expect(replaceIsChange(i)).toBe(true);
    expect(chipsOf(i).map((c) => c.label)).toContain('3 replaced');
  });

  it('confirms a line it has (same date and units) instead of replacing it', () => {
    const d = diffFundImport(
      input({
        funds: [stFund()],
        onFile: [
          stored([
            { ...asStored([STMT[0]!], 'csv')[0]! },
            { ...asStored([STMT[1]!], 'workbook')[0]!, units: 100.0005 },
          ]),
        ],
      }),
    );
    const i = item(d);
    expect(i.lines.replace!.count).toBe(0);
    expect(i.lines.duplicateCount).toBe(2);
    expect(i.lines.newCount).toBe(1);
  });

  it('keeps a line from an earlier statement that this one lacks, and says so', () => {
    const d = diffFundImport(
      input({ funds: [stFund()], onFile: [stored([L('s1', '2025-03-05', 'cas')])] }),
    );
    const i = item(d);
    expect(i.lines.replace!.count).toBe(0);
    expect(i.lines.keptNotOnStatement).toBe(1);
    expect(i.notes.join(' ')).toContain('not on this statement; kept');
  });

  it('touches nothing outside the period, and includes both edge days', () => {
    const d = diffFundImport(
      input({
        funds: [stFund()],
        onFile: [
          stored([
            L('before', '2024-12-31', 'csv'),
            L('first', '2025-01-01', 'csv'),
            L('last', '2026-10-27', 'csv', 60, 6_000),
            L('after', '2026-10-28', 'csv'),
          ]),
        ],
      }),
    );
    const i = item(d);
    expect(i.write!.replace!.keys.sort()).toEqual(['first', 'last']);
  });

  it('replaces nothing, and warns, when the statement does not add up', () => {
    const d = diffFundImport(
      input({
        funds: [stFund({ closingUnits: 340 })],
        onFile: [stored([L('c1', '2025-03-05', 'csv'), L('e1', '2025-04-05', 'estimate')])],
      }),
    );
    const i = item(d);
    expect(i.lines.replace!.count).toBe(0);
    expect(i.lines.replace!.blocked).toContain('Nothing on file was replaced');
    expect(i.lines.replace!.blocked).toContain(
      'lead from 0 to 300 units but it says it closes at 340',
    );
    expect(i.write?.replace ?? null).toBeNull();
    expect(i.write?.position.coverTo).toBeUndefined();
    expect(i.notes.join(' ')).toContain('Nothing on file was replaced');
  });

  it('does not replace anything when it has no lines of its own to judge by', () => {
    const d = diffFundImport(
      input({
        funds: [stFund({ lines: [], closingUnits: 0, openingUnits: 0, held: false, invested: 0 })],
        onFile: [stored([L('c1', '2025-03-05', 'csv')])],
      }),
    );
    expect(item(d).lines.replace!.count).toBe(0);
  });

  it('does not replace for a statement that names no period', () => {
    const d = diffFundImport(
      input({
        periodFrom: null,
        funds: [stFund()],
        onFile: [stored([L('c1', '2025-03-05', 'csv')])],
      }),
    );
    expect(item(d).lines.replace!.count).toBe(0);
  });

  it('counts the replaced lines in the summary only when that part is applied', () => {
    const d = diffFundImport(
      input({ funds: [stFund()], onFile: [stored([L('c1', '2025-03-05', 'csv')])] }),
    );
    const items = d.items;
    expect(summariseChanges(items)).toContain('1 replaced by the statement');
    expect(
      summariseChanges(items, {
        funds: new Set(['o1|f1']),
        sips: new Set(),
        replaces: new Set(),
      }),
    ).not.toContain('replaced');
    expect(
      summariseChanges(items, {
        funds: new Set(['o1|f1']),
        sips: new Set(),
        replaces: new Set(['o1|f1']),
      }),
    ).toContain('1 replaced by the statement');
    expect(replaceKey('o1|f1')).toBe('o1|f1#replace');
  });

  it('adds up what a preview replaces, adds and confirms', () => {
    const d = diffFundImport(
      input({
        funds: [stFund()],
        onFile: [
          stored([
            L('c1', '2025-03-05', 'csv'),
            asStored([STMT[0]!], 'csv')[0]!,
            L('e1', '2025-04-05', 'estimate'),
          ]),
        ],
      }),
    );
    expect(priorityTotals(d.items)).toEqual({
      funds: 1,
      replaced: 2,
      added: 2,
      confirmed: 1,
      bySource: { csv: 1, estimate: 1 },
    });
  });

  it('is idempotent: the same statement again, with the replaced lines set aside, changes nothing', () => {
    const first = diffFundImport(
      input({ funds: [stFund()], onFile: [stored([L('c1', '2025-03-05', 'csv')])] }),
    );
    expect(item(first).changed).toBe(true);
    // what is on file afterwards: the statement's lines, no live csv line, the period recorded
    const again = diffFundImport(
      input({
        funds: [stFund()],
        onFile: [
          onFile({
            unitsAsOf: '2026-10-27',
            state: state({
              lines: STMT.map((l) => ({
                key: l.key,
                date: l.date,
                kind: l.kind,
                amount: l.amount,
                units: l.units,
                source: 'cas',
              })),
              latestValue: { asOf: '2026-10-27', amount: 36_000 },
              snapshots: [{ asOf: '2026-10-27', value: 36_000, units: 300 }],
              cover: { from: '2025-01-01', to: '2026-10-27' },
            }),
          }),
        ],
      }),
    );
    expect(item(again).changed).toBe(false);
    expect(item(again).write).toBeNull();
    expect(item(again).lines.replace!.count).toBe(0);
  });
});

describe('the period a statement decided is recorded', () => {
  const onFileStmt = STMT.map((l) => ({
    key: l.key,
    date: l.date,
    kind: l.kind,
    amount: l.amount,
    units: l.units,
    source: 'cas',
  }));
  const settled = (cover: NonNullable<OnFileState['cover']> | null) =>
    onFile({
      unitsAsOf: '2026-10-27',
      state: state({
        lines: onFileStmt,
        latestValue: { asOf: '2026-10-27', amount: 36_000 },
        snapshots: [{ asOf: '2026-10-27', value: 36_000, units: 300 }],
        cover,
      }),
    });
  it('is written quietly when nothing else changes, so the fund is still listed as unchanged', () => {
    const d = diffFundImport(input({ funds: [stFund()], onFile: [settled(null)] }));
    const i = item(d);
    expect(i.changed).toBe(false);
    expect(i.kind).toBe('unchanged');
    expect(i.write!.position).toEqual({ coverFrom: '2025-01-01', coverTo: '2026-10-27' });
  });
  it('is not written again once it is on file', () => {
    const d = diffFundImport(
      input({
        funds: [stFund()],
        onFile: [settled({ from: '2025-01-01', to: '2026-10-27' })],
      }),
    );
    expect(item(d).write).toBeNull();
  });
  it('joins an earlier period it touches', () => {
    const d = diffFundImport(
      input({
        periodFrom: '2026-10-01',
        funds: [stFund({ lines: STMT.slice(2), closingUnits: 300, openingUnits: 200 })],
        onFile: [settled({ from: '1986-10-01', to: '2026-10-20' })],
      }),
    );
    expect(item(d).write!.position).toMatchObject({
      coverFrom: '1986-10-01',
      coverTo: '2026-10-27',
    });
  });
  it('is recorded for a new fund too, when the statement adds up', () => {
    const d = diffFundImport(input({ funds: [stFund({ match: { status: 'none' } })], onFile: [] }));
    const i = d.items[0]!;
    expect(i.kind).toBe('new');
    expect(i.write!.position).toMatchObject({ coverFrom: '2025-01-01', coverTo: '2026-10-27' });
    expect(i.write!.lineSource).toBe('cas');
    const bad = diffFundImport(
      input({ funds: [stFund({ match: { status: 'none' }, closingUnits: 1 })], onFile: [] }),
    );
    expect(bad.items[0]!.write!.position.coverTo).toBeUndefined();
  });
});

describe('an older statement cannot override a newer one', () => {
  const newer = onFile({
    unitsAsOf: '2026-10-27',
    state: state({
      units: 300,
      invested: 30_000,
      lines: [],
      cover: { from: '2025-01-01', to: '2026-10-27' },
    }),
  });
  const olderRows = [
    raw('2025-02-10', 'purchase', 5_000, 50),
    raw('2024-06-10', 'purchase', 4_000, 40),
  ];
  const olderLines = lines(olderRows.sort((a, b) => a.date.localeCompare(b.date)));
  const olderStmt = stFund({
    lines: olderLines,
    closingUnits: 90,
    openingUnits: 0,
    invested: 9_000,
    startedOn: '2024-06-10',
    value: { amount: 9_900, asOf: '2026-03-31', nav: 110 },
  });
  it('keeps units, amount invested and first purchase, replaces nothing, and says so', () => {
    const d = diffFundImport(
      input({
        periodFrom: '2024-01-01',
        periodTo: '2026-03-31',
        funds: [olderStmt],
        onFile: [
          onFile({
            ...newer,
            state: state({
              ...newer.state!,
              lines: [
                {
                  key: 'c1',
                  date: '2025-03-05',
                  kind: 'purchase',
                  amount: 5_500,
                  units: 55,
                  source: 'csv',
                },
              ],
            }),
          }),
        ],
      }),
    );
    const i = item(d);
    expect(i.units).toBeNull();
    expect(i.invested).toBeNull();
    expect(i.startedOn).toBeNull();
    expect(i.lines.replace!.count).toBe(0);
    expect(i.lines.replace!.blocked).toContain('already applied');
    expect(i.notes.join(' ')).toContain(
      'Kept: the fund statement dated 27 Oct 2026 is more accurate than this older one',
    );
    // a line inside what the newer statement covers is not added; one before it is
    expect(i.lines.replace!.coveredByStatement).toBe(1);
    expect(i.lines.newLines.map((l) => l.date)).toEqual(['2024-06-10']);
    expect(i.write?.position.coverTo).toBeUndefined();
    expect(i.sip).toBeNull();
  });
  it('lets a statement dated the same day or later win', () => {
    const same = diffFundImport(
      input({ funds: [stFund()], onFile: [onFile({ ...newer, unitsAsOf: '2026-10-20' })] }),
    );
    expect(item(same).notes.join(' ')).not.toContain('Kept:');
  });
});

describe('start date: the statement decides it', () => {
  it('moves a start date that is earlier than the first purchase, when nothing on file backs it', () => {
    const d = diffFundImport(
      input({
        periodFrom: '1986-10-01',
        funds: [stFund()],
        onFile: [onFile({ startedOn: '2019-05-01' })],
      }),
    );
    expect(item(d).startedOn).toEqual({ before: '2019-05-01', after: '2025-01-10' });
  });
  it('keeps an earlier start date that a line on file backs', () => {
    const d = diffFundImport(
      input({
        periodFrom: '1986-10-01',
        funds: [stFund()],
        onFile: [
          onFile({
            startedOn: '2019-05-01',
            state: state({
              lines: [
                {
                  key: 'old',
                  date: '2019-05-01',
                  kind: 'purchase',
                  amount: 1,
                  units: 1,
                  source: 'cas',
                },
              ],
            }),
          }),
        ],
      }),
    );
    expect(item(d).startedOn).toBeNull();
  });
  it('does not move it when the statement starts mid-way (units before it)', () => {
    const d = diffFundImport(
      input({
        funds: [stFund({ openingUnits: 100, closingUnits: 400, startedOn: null })],
        onFile: [onFile({ startedOn: '2019-05-01' })],
      }),
    );
    expect(item(d).startedOn).toBeNull();
  });
});

describe('a later app export does not overwrite a statement', () => {
  const fileRows = [
    raw('2026-01-10', 'purchase', 5_000, 50),
    raw('2026-10-20', 'purchase', 5_000, 50),
  ];
  const fileLines = lines(fileRows);
  const fileFund = stFund({
    lines: fileLines,
    closingUnits: 123,
    openingUnits: 0,
    invested: 99_999,
    startedOn: '2026-01-10',
    value: null,
  });
  const withCover = onFile({
    unitsAsOf: '2026-10-27',
    state: state({ cover: { from: '2025-01-01', to: '2026-10-27' } }),
  });
  it('keeps units, invested and first purchase when the statement is dated on or after the file', () => {
    const d = diffFundImport(
      input({
        source: 'file',
        complete: false,
        periodFrom: '2026-01-10',
        periodTo: '2026-10-28',
        funds: [fileFund],
        onFile: [withCover],
      }),
    );
    const i = item(d);
    expect(i.units).toBeNull();
    expect(i.invested).toBeNull();
    expect(i.startedOn).toBeNull();
    expect(i.notes.join(' ')).toContain(
      'Kept: the fund statement dated 27 Oct 2026 is more accurate than this file',
    );
    // both file lines fall inside the statement's period: not added
    expect(i.lines.newCount).toBe(0);
    expect(i.lines.replace!.coveredByStatement).toBe(2);
    expect(i.changed).toBe(false);
  });
  it('adds only the lines after the statement when the file is newer, and may then update the values', () => {
    const newerFile = lines([
      raw('2026-01-10', 'purchase', 5_000, 50),
      raw('2026-11-03', 'purchase', 5_000, 50),
    ]);
    const d = diffFundImport(
      input({
        source: 'file',
        complete: false,
        periodFrom: '2026-01-10',
        periodTo: '2026-11-05',
        funds: [{ ...fileFund, lines: newerFile, closingUnits: 350, invested: 40_000 }],
        onFile: [withCover],
      }),
    );
    const i = item(d);
    expect(i.lines.newLines.map((l) => l.date)).toEqual(['2026-11-03']);
    expect(i.write!.lineSource).toBe('csv');
    expect(i.write!.replace ?? null).toBeNull();
    expect(i.notes.join(' ')).toContain('inside the period of the statement dated 27 Oct 2026');
  });
  it('never replaces lines on file, whatever the file says', () => {
    const d = diffFundImport(
      input({
        source: 'file',
        complete: false,
        periodFrom: '2026-01-10',
        periodTo: '2026-10-28',
        funds: [fileFund],
        onFile: [
          onFile({
            state: state({
              cover: null,
              lines: [
                {
                  key: 'm1',
                  date: '2026-02-02',
                  kind: 'purchase',
                  amount: 1,
                  units: 1,
                  source: 'manual',
                },
              ],
            }),
          }),
        ],
      }),
    );
    expect(item(d).write?.replace ?? null).toBeNull();
    expect(item(d).lines.replace!.count).toBe(0);
  });
});

describe('"sold" is only said when the statement can know', () => {
  const funds = (n: number): OnFileFund[] =>
    Array.from({ length: n }, (_, k) =>
      onFile({
        assetId: `x${k}`,
        name: `Other Fund ${k}`,
        isin: `INF00${k}A01AB1`,
        state: state({ units: 10 }),
      }),
    );
  const base = (over: Partial<FundImportInput>, absent: number, listed = 1) =>
    input({
      funds: [stFund()],
      onFile: [onFile(), ...funds(absent + listed - 1).slice(0, absent + listed - 1)],
      ...over,
    });

  it('marks a missing fund as sold on a PAN-keyed statement that lists most of the funds', () => {
    // 1 of 7 missing; the other five are on the statement
    const listed = Array.from({ length: 5 }, (_, k) =>
      stFund({
        name: `Other Fund ${k}`,
        isin: `INF00${k}A01AB1`,
        match: { status: 'one', assetId: `x${k}` },
        lines: [],
        closingUnits: 10,
        openingUnits: 10,
        invested: 1_000,
        startedOn: null,
        value: null,
      }),
    );
    const d = diffFundImport(
      input({
        funds: [stFund(), ...listed],
        onFile: [onFile(), ...funds(6)],
      }),
    );
    const sold = d.items.filter((i) => i.kind === 'sold');
    expect(sold.map((i) => i.name)).toEqual(['Other Fund 5']);
    expect(sold[0]!.changed).toBe(true);
    expect(sold[0]!.write!.markSoldAsOf).toBe('2026-10-27');
  });

  it('reproduces the report: four of seven funds missing is not four sales', () => {
    const listed = Array.from({ length: 2 }, (_, k) =>
      stFund({
        name: `Other Fund ${k}`,
        isin: `INF00${k}A01AB1`,
        match: { status: 'one', assetId: `x${k}` },
        lines: [],
        closingUnits: 10,
        openingUnits: 10,
        invested: 1_000,
        startedOn: null,
        value: null,
      }),
    );
    const d = diffFundImport(
      input({ funds: [stFund(), ...listed], onFile: [onFile(), ...funds(6)] }),
    );
    expect(d.items.filter((i) => i.kind === 'sold')).toHaveLength(0);
    const review = d.items.filter((i) => i.kind === 'review');
    expect(review).toHaveLength(4);
    expect(review.every((i) => i.reviewKind === 'absent' && !i.changed && i.write === null)).toBe(
      true,
    );
    expect(review[0]!.why).toContain('4 of your 7 funds are missing from this statement');
    expect(chipsOf(review[0]!).map((c) => c.label)).toEqual(['Not on this statement: check']);
    expect(d.notes.join(' ')).toContain('none was marked as sold');
  });

  it('exactly half missing is still allowed to be sold; more than half is not', () => {
    const listed = (k: number) =>
      stFund({
        name: `Other Fund ${k}`,
        isin: `INF00${k}A01AB1`,
        match: { status: 'one', assetId: `x${k}` },
        lines: [],
        closingUnits: 10,
        openingUnits: 10,
        invested: 1_000,
        startedOn: null,
        value: null,
      });
    // 4 funds on file, 2 listed, 2 missing = half
    const half = diffFundImport(
      input({ funds: [stFund(), listed(0)], onFile: [onFile(), ...funds(3)] }),
    );
    expect(half.items.filter((i) => i.kind === 'sold')).toHaveLength(2);
  });

  it('never marks a fund sold on a statement keyed on an email address, or one that does not say', () => {
    for (const basis of ['email', 'unknown'] as const) {
      const d = diffFundImport(base({ basis }, 1));
      expect(d.items.filter((i) => i.kind === 'sold')).toHaveLength(0);
      const r = d.items.find((i) => i.kind === 'review')!;
      expect(r.reviewKind).toBe('absent');
      expect(r.why).toContain(
        basis === 'email' ? 'registered under another email' : 'does not say whose folios',
      );
    }
  });

  it('treats a statement with no basis stated as before (a PAN-keyed one)', () => {
    const { basis, ...rest } = input({});
    void basis;
    const d = diffFundImport({
      ...rest,
      funds: [stFund()],
      onFile: [onFile(), onFile({ assetId: 'gone', name: 'Gone Fund', isin: null })],
    });
    expect(d.items.filter((i) => i.kind === 'sold')).toHaveLength(1);
  });

  it('does not pre-tick a sale when a scheme on the statement could not be read cleanly', () => {
    const d = diffFundImport(
      input({
        funds: [
          stFund(),
          stFund({
            name: 'Unnamed scheme',
            isin: 'INF999Z99ZZ9',
            match: { status: 'none' },
            unclear: 'the scheme name could not be read cleanly',
          }),
        ],
        onFile: [onFile(), onFile({ assetId: 'gone', name: 'Gone Fund', isin: null }), ...funds(0)],
      }),
    );
    // the unclear scheme is unmatched, so the long-standing guard already holds it; the new one stands for a matched-but-unclear scheme
    expect(d.items.filter((i) => i.kind === 'sold')).toHaveLength(0);
    const matched = diffFundImport(
      input({
        funds: [stFund({ unclear: 'no closing balance was found' })],
        onFile: [onFile(), onFile({ assetId: 'gone', name: 'Gone Fund', isin: null })],
      }),
    );
    expect(matched.items.filter((i) => i.kind === 'sold')).toHaveLength(0);
    const r = matched.items.find((i) => i.kind === 'review')!;
    expect(r.why).toContain('could not be read cleanly');
  });

  it('still marks a fund sold when the statement lists its folio with zero units after a sale', () => {
    const sale = lines([
      raw('2025-02-01', 'purchase', 10_000, 100),
      raw('2026-10-26', 'redeem', -12_000, -100),
    ]);
    const d = diffFundImport(
      input({
        funds: [
          stFund({
            lines: sale,
            closingUnits: 0,
            openingUnits: 0,
            held: false,
            invested: 0,
            value: { amount: 0, asOf: '2026-10-27', nav: 120 },
          }),
        ],
        onFile: [onFile()],
      }),
    );
    const i = item(d);
    expect(i.kind).toBe('sold');
    expect(i.changed).toBe(true);
    expect(i.why).toContain('Fully redeemed');
  });

  it('keeps the long-standing guards: depository-only and unmatched schemes', () => {
    const holdings = diffFundImport(
      input({
        funds: [stFund({ holdingsOnly: true })],
        onFile: [onFile(), onFile({ assetId: 'gone', name: 'Gone Fund', isin: null })],
      }),
    );
    expect(holdings.items.filter((i) => i.kind === 'sold')).toHaveLength(0);
    expect(holdings.notes.join(' ')).toContain('only balances held with a depository');
  });
});
