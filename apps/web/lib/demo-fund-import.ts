/**
 * Invented data for the public sample of the fund-statement preview. It is built by the real comparison (`diffFundImport`), from a
 * made-up statement and made-up stored funds, so the sample shows exactly what a real preview shows. No real names or amounts.
 */
import {
  diffFundImport,
  schemeLinkKey,
  statementLineKeys,
  type FundImportDiff,
  type FundImportInput,
  type OnFileFund,
  type OnFileState,
  type StatementFund,
  type StatementLine,
} from '@fwos/core';
import { toView, type PersonPreview } from './fund-import';

const RULES = { sipMinInstalments: 3, unitTolerance: 0.001, moneyTolerance: 1 };
const END = '2026-10-25';

type Raw = { date: string; kind: string; amount: number; units: number };
const monthly = (from: string, n: number, amount: number, nav = 100): Raw[] => {
  const [y, m] = from.split('-').map(Number) as [number, number];
  return Array.from({ length: n }, (_, i) => {
    const mm = ((m - 1 + i) % 12) + 1;
    const yy = y + Math.floor((m - 1 + i) / 12);
    return {
      date: `${yy}-${String(mm).padStart(2, '0')}-05`,
      kind: 'sip',
      amount,
      units: Math.round((amount / nav) * 1000) / 1000,
    };
  });
};
const toLines = (folio: string, rows: Raw[]): StatementLine[] => {
  const keys = statementLineKeys(folio, rows);
  return rows.map((r, i) => ({
    key: keys[i]!,
    date: r.date,
    kind: r.kind,
    description: r.kind === 'sip' ? 'Systematic Investment Purchase' : 'Redemption',
    amount: r.amount,
    units: r.units,
    nav: 100,
    balance: null,
  }));
};
const stored = (ls: StatementLine[]) =>
  ls.map((l) => ({
    key: l.key,
    date: l.date,
    kind: l.kind,
    amount: l.amount,
    units: l.units,
    source: 'cas',
  }));

function state(o: Partial<OnFileState>): OnFileState {
  return {
    units: null,
    invested: null,
    sipMonthly: null,
    sipStopped: false,
    sipChanges: [],
    lines: [],
    latestValue: { asOf: '2026-09-30', amount: 100_000 },
    snapshots: [],
    ignored: [],
    ...o,
  };
}

function onFile(
  id: string,
  name: string,
  isin: string,
  s: Partial<OnFileState>,
  folio: string | null = '5678',
): OnFileFund {
  return {
    assetId: id,
    name,
    isin,
    amfiCode: null,
    folioLast4: folio,
    status: 'active',
    unitsAsOf: '2026-09-30',
    startedOn: '2021-03-05',
    state: state(s),
  };
}

function stmt(id: string, name: string, isin: string, o: Partial<StatementFund>): StatementFund {
  return {
    name,
    isin,
    amfiCode: null,
    folioLast4: '5678',
    lines: [],
    closingUnits: 1000,
    openingUnits: 0,
    held: true,
    invested: 100_000,
    startedOn: '2021-03-05',
    value: { amount: 120_000, asOf: END, nav: 120 },
    holdingsOnly: false,
    soldThisYear: false,
    match: id ? { status: 'one', assetId: id } : { status: 'none' },
    ...o,
  };
}

function build(
  ownerId: string,
  funds: StatementFund[],
  files: OnFileFund[],
  basis: 'email' | 'pan' = 'pan',
): FundImportInput {
  return {
    ownerId,
    source: 'statement',
    complete: true,
    periodFrom: '2021-01-01',
    periodTo: END,
    today: '2026-10-26',
    funds,
    onFile: files,
    rules: RULES,
    basis,
  };
}

/**
 * The real comparison, plus (as the app's planner does) what each folio would become under each answer, so the sample can show the
 * changes after an answer. Here only the folio being answered is changed; the real planner also keeps the other suggestions.
 */
function planWithOutcomes(input: FundImportInput): FundImportDiff {
  const base = diffFundImport(input);
  for (const item of base.items) {
    const p = item.prompt;
    if (!p || p.kind !== 'ambiguous') continue;
    const at = input.funds.findIndex(
      (f) =>
        f.match.status === 'ambiguous' &&
        `${input.ownerId}|review:${f.folioLast4}|${schemeLinkKey(f)}` === item.key,
    );
    const sf = input.funds[at];
    if (!sf) continue;
    for (const o of p.suggestion.options) {
      if (!o.id.startsWith('link:') && o.id !== 'new') continue;
      const forced: StatementFund = {
        ...sf,
        match: o.id === 'new' ? { status: 'none' } : { status: 'one', assetId: o.id.slice(5) },
        chosen: [item.key],
      };
      const after = diffFundImport({
        ...input,
        funds: input.funds.map((f, n) => (n === at ? forced : f)),
      });
      p.outcomes[o.id] = after.items
        .filter((x) => x.chosen?.includes(item.key))
        .map((x) => {
          const { write, ...rest } = x;
          void write;
          return { ...rest, sip: null, sipPrompt: null, prompt: null };
        });
    }
  }
  return base;
}

/** Anil: a fund with new lines, a SIP that stopped, a SIP raised, a new SIP, a fund that is gone and two that are unchanged. */
export function demoFundPreview(): PersonPreview[] {
  const flexiOld = toLines('5678', monthly('2026-03-05', 6, 10_000));
  const flexiNew = toLines('5678', monthly('2026-03-05', 8, 10_000));
  const largeCap = toLines('2211', monthly('2025-10-05', 6, 5_000));
  const index = toLines('3344', [
    ...monthly('2026-02-05', 3, 5_000),
    ...monthly('2026-05-05', 6, 8_000),
  ]);
  const mid = toLines('7788', monthly('2026-07-05', 4, 3_000));
  const calm = toLines('9900', monthly('2026-05-05', 6, 2_000));

  const anil = diffFundImport(
    build(
      'p1',
      [
        stmt('f1', 'Sample Flexi Cap Fund - Direct Growth', 'INF000A01AB1', {
          lines: flexiNew,
          closingUnits: 1_450.5,
          invested: 180_000,
        }),
        stmt('f2', 'Sample Large Cap Fund - Direct Growth', 'INF000C03EF3', {
          lines: largeCap,
          closingUnits: 300,
          invested: 30_000,
        }),
        stmt('f3', 'Sample Index Fund - Direct Growth', 'INF000E05IJ5', {
          lines: index,
          closingUnits: 800,
          invested: 59_000,
        }),
        stmt('f5', 'Sample Balanced Fund - Direct Growth', 'INF000H08OP8', {
          lines: calm,
          closingUnits: 200,
          invested: 12_000,
        }),
      ],
      [
        onFile('f1', 'Sample Flexi Cap Fund - Direct Growth', 'INF000A01AB1', {
          units: 1_200.25,
          invested: 150_000,
          sipMonthly: 10_000,
          lines: stored(flexiOld),
        }),
        onFile('f2', 'Sample Large Cap Fund - Direct Growth', 'INF000C03EF3', {
          units: 300,
          invested: 30_000,
          sipMonthly: 5_000,
          lines: stored(largeCap),
        }),
        onFile('f3', 'Sample Index Fund - Direct Growth', 'INF000E05IJ5', {
          units: 600,
          invested: 40_000,
          sipMonthly: 5_000,
          sipChanges: [{ from: '2021-03-05', monthly: 5_000 }],
          lines: stored(index.slice(0, 5)),
        }),
        onFile('f4', 'Sample Old Fund - Direct Growth', 'INF000D04GH4', {
          units: 250,
          invested: 20_000,
          sipMonthly: 2_000,
        }),
        onFile('f5', 'Sample Balanced Fund - Direct Growth', 'INF000H08OP8', {
          units: 200,
          invested: 12_000,
          sipMonthly: 2_000,
          lines: stored(calm),
          latestValue: { asOf: END, amount: 24_000 },
          snapshots: [{ asOf: END, value: 24_000, units: 200 }],
        }),
      ],
    ),
  );
  // Beena's statement is keyed on an e-mail address. One fund of hers is on file twice with the same ISIN, so two statement folios
  // could each be either: the folio settles one and the units settle the other. A third scheme has no evidence at all.
  const VALUE = 'INF000V10ST1';
  const HYBRID = 'INF000Y11UV2';
  const beena = planWithOutcomes(
    build(
      'p2',
      [
        stmt('', 'Sample Mid Cap Fund - Direct Growth', 'INF000G07MN7', {
          lines: mid,
          closingUnits: 120,
          invested: 12_000,
          startedOn: '2026-07-05',
        }),
        stmt('g1', 'Sample Gilt Fund - Direct Growth', 'INF000K09QR9', {
          closingUnits: 90,
          invested: 9_000,
        }),
        stmt('', 'Sample Value Fund - Direct Growth', VALUE, {
          folioLast4: '8540',
          closingUnits: 700,
          invested: 70_000,
          match: { status: 'ambiguous', candidates: ['v1', 'v2'] },
        }),
        stmt('', 'Sample Value Fund - Direct Growth', VALUE, {
          folioLast4: '3820',
          closingUnits: 3_047.333,
          invested: 300_000,
          match: { status: 'ambiguous', candidates: ['v1', 'v2'] },
        }),
        stmt('', 'Sample Hybrid Fund - Direct Growth', HYBRID, {
          folioLast4: '6601',
          closingUnits: 410.5,
          invested: 41_000,
          match: { status: 'ambiguous', candidates: ['h1', 'h2'] },
        }),
      ],
      [
        onFile('g1', 'Sample Gilt Fund - Direct Growth', 'INF000K09QR9', {
          units: 90,
          invested: 9_000,
          latestValue: { asOf: END, amount: 10_800 },
          snapshots: [{ asOf: END, value: 10_800, units: 90 }],
        }),
        onFile(
          'v1',
          'Sample Value Fund - Direct Growth',
          VALUE,
          { units: 700, invested: 70_000 },
          '8540',
        ),
        onFile(
          'v2',
          'Sample Value Fund - Direct Growth',
          VALUE,
          { units: 3_047.333, invested: 300_000 },
          null,
        ),
        onFile(
          'h1',
          'Sample Hybrid Fund - Direct Growth',
          HYBRID,
          { units: 100, invested: 10_000 },
          '2200',
        ),
        onFile(
          'h2',
          'Sample Hybrid Fund - Direct Growth',
          HYBRID,
          { units: 200, invested: 20_000 },
          '2201',
        ),
      ],
      'email',
    ),
  );

  // Chitra's statement is also keyed on an e-mail address. A SIP is a few days late (it has been before, so it cannot be called
  // stopped yet), and a dormant fund of hers is not listed (the statement may simply not include that folio).
  const late = toLines(
    '4455',
    ['2026-04-23', '2026-05-26', '2026-06-23', '2026-07-25', '2026-08-23', '2026-09-23'].map(
      (date) => ({ date, kind: 'sip', amount: 3_000, units: 30 }),
    ),
  );
  const chitra = diffFundImport(
    build(
      'p3',
      [
        stmt('b1', 'Sample Bond Fund - Direct Growth', 'INF000B12WX3', {
          folioLast4: '4455',
          lines: late,
          closingUnits: 400,
          invested: 40_000,
        }),
      ],
      [
        onFile(
          'b1',
          'Sample Bond Fund - Direct Growth',
          'INF000B12WX3',
          {
            units: 400,
            invested: 40_000,
            sipMonthly: 3_000,
            lines: stored(late),
            latestValue: { asOf: END, amount: 48_000 },
            snapshots: [{ asOf: END, value: 48_000, units: 400 }],
          },
          '4455',
        ),
        onFile(
          'd1',
          'Sample Dormant Fund - Direct Growth',
          'INF000D13YZ4',
          { units: 50, invested: 5_000 },
          '9001',
        ),
      ],
      'email',
    ),
  );
  return [
    { ownerId: 'p1', name: 'Anil', files: [], diff: toView(anil), notes: [] },
    { ownerId: 'p2', name: 'Beena', files: [], diff: toView(beena), notes: [] },
    { ownerId: 'p3', name: 'Chitra', files: [], diff: toView(chitra), notes: [] },
  ];
}
