import { describe, expect, it } from 'vitest';
import { parseCas } from '../src/cas';
import {
  applyFundDiff,
  matchScheme,
  mergeReports,
  planCasImport,
  splitByOwner,
  type CasFund,
  type CasIo,
  type CasSave,
} from '../src/cas-import';
import { schemeKey, schemeKeysCompatible } from '../src/amfi';

// An invented consolidation by email address in the shape of the real ones: two people's folios on one statement (and a third person
// who is not in the family list), two folios of one scheme, a folio that closes at zero after a sale, demat-form folios, and a period
// that starts in 1986 ("from the beginning").
// PANs are built here, not typed, so no PAN-shaped value sits in the source (scripts/check-private-data.sh)
const PAN = (n: number, last: string) => ['AAAAA', String(n).padStart(4, '0'), last].join('');
const P1 = PAN(1, 'A');
const P2 = PAN(2, 'B');
const P9 = PAN(9, 'Z');

const TEXT = `
Consolidated Account Statement
01-Oct-1986 To 27-Oct-2026
Email Id: someone@example.test
The consolidation has been carried out based on the email id entered by you.
Sample Mutual Fund
Folio No: 6235 / 0 PAN: ${P1} KYC: OK PAN: OK
Holder One
SC101-Sample Small Cap Fund - Direct Growth (Non Demat) - ISIN: INF000S01SC1(Advisor: DIRECT) Registrar : CAMS
Opening Unit Balance: 0.000
05-Jan-2025 Purchase 100,000.00 2,000.000 50.00 2,000.000
05-Feb-2025 Purchase 4,538.25 90.765 50.00 2,090.765
Closing Unit Balance: 2,090.765 NAV on 27-Oct-2026: INR 60.00 Total Cost Value: 104,538.25 Market Value on 27-Oct-2026: INR 125,445.90
Sample Mutual Fund
Folio No: 1948 / 0 PAN: ${P1} KYC: OK PAN: OK
Holder One
SC101-Sample Small Cap Fund - Direct Growth (Non Demat) - ISIN: INF000S01SC1(Advisor: DIRECT) Registrar : CAMS
Opening Unit Balance: 0.000
05-Mar-2025 Purchase 85,329.40 1,706.588 50.00 1,706.588
Closing Unit Balance: 1,706.588 NAV on 27-Oct-2026: INR 60.00 Total Cost Value: 85,329.40 Market Value on 27-Oct-2026: INR 102,395.28
Sample Mutual Fund
Folio No: 7777 / 0 PAN: ${P1} KYC: OK PAN: OK
Holder One
FX202-Sample Flexi Cap Fund - Direct Growth (Non Demat) - ISIN: INF000F02FX2(Advisor: DIRECT) Registrar : CAMS
Opening Unit Balance: 0.000
05-Jan-2025 Purchase 10,000.00 100.000 100.00 100.000
05-Feb-2026 Redemption (12,000.00) (100.000) 120.00 0.000
Closing Unit Balance: 0.000 NAV on 27-Oct-2026: INR 130.00 Total Cost Value: 0.00 Market Value on 27-Oct-2026: INR 0.00
Sample Mutual Fund
Folio No: 8888 PAN: ${P1} PAN: OK
Holder One
MC303-Sample Mid Cap Fund - Regular Plan - Growth (Demat) - ISIN: INF000M03MC3(Advisor: ARN-00000) Registrar : KFINTECH
Opening Unit Balance: 0.000
05-Jan-2025 Purchase 5,000.00 50.000 100.00 50.000
Closing Unit Balance: 50.000 NAV on 27-Oct-2026: INR 120.00 Total Cost Value: 5,000.00 Market Value on 27-Oct-2026: INR 6,000.00
Other Mutual Fund
Folio No: 9999 PAN: ${P2} KYC: OK PAN: OK
Holder Two
BC404-Other Bond Fund - Direct Growth (Non Demat) - ISIN: INF000B04BC4(Advisor: DIRECT) Registrar : CAMS
Opening Unit Balance: 0.000
05-Jan-2025 Purchase 1,000.00 10.000 100.00 10.000
Closing Unit Balance: 10.000 NAV on 27-Oct-2026: INR 120.00 Total Cost Value: 1,000.00 Market Value on 27-Oct-2026: INR 1,200.00
Third Mutual Fund
Folio No: 5555 PAN: ${P9} KYC: OK PAN: OK
Holder Three
ZZ505-Third Gilt Fund - Direct Growth (Non Demat) - ISIN: INF000Z05ZZ5(Advisor: DIRECT) Registrar : CAMS
Opening Unit Balance: 0.000
05-Jan-2025 Purchase 2,000.00 20.000 100.00 20.000
Closing Unit Balance: 20.000 NAV on 27-Oct-2026: INR 120.00 Total Cost Value: 2,000.00 Market Value on 27-Oct-2026: INR 2,400.00
`;

const OWNERS = [
  { ownerId: 'A', panLast4: '001A' },
  { ownerId: 'B', panLast4: '002B' },
];

const fund = (
  assetId: string,
  name: string,
  isin: string | null,
  state: Partial<NonNullable<CasFund['state']>> = {},
  f: Partial<CasFund> = {},
): CasFund => ({
  assetId,
  name,
  amfiCode: null,
  isin,
  folioLast4: null,
  status: 'active',
  unitsAsOf: '2026-09-30',
  startedOn: '2025-01-05',
  ...f,
  state: {
    units: null,
    invested: null,
    sipMonthly: null,
    sipStopped: false,
    sipChanges: [],
    lines: [],
    latestValue: null,
    snapshots: [],
    ignored: [],
    cover: null,
    ...state,
  },
});

/** An in-memory household: saves change what the next read returns, so a second import can be told apart from the first. */
function bank(funds: CasFund[]) {
  const saves: CasSave[] = [];
  const sold: string[] = [];
  const io: CasIo = {
    async funds() {
      return funds;
    },
    async isinToAmfi() {
      return null;
    },
    async createFund() {
      throw new Error('not expected');
    },
    async markSold({ assetId }) {
      sold.push(assetId);
      funds.find((x) => x.assetId === assetId)!.status = 'closed';
    },
    async save(a) {
      saves.push(a);
      const f = funds.find((x) => x.assetId === a.assetId)!;
      const st = f.state!;
      if (a.replace) st.lines = st.lines.filter((l) => !a.replace!.keys.includes(l.key));
      for (const t of a.transactions)
        st.lines.push({
          key: t.key,
          date: t.date,
          kind: t.kind,
          amount: t.amount,
          units: t.units,
          source: a.lineSource,
        });
      if (a.position.units !== undefined) {
        st.units = a.position.units;
        f.unitsAsOf = a.position.unitsAsOf ?? f.unitsAsOf ?? null;
      }
      if (a.position.invested !== undefined) st.invested = a.position.invested;
      if (a.position.startedOn) f.startedOn = a.position.startedOn;
      if (a.position.coverTo)
        st.cover = { from: a.position.coverFrom ?? null, to: a.position.coverTo };
      if (a.valuation?.observation)
        st.latestValue = { asOf: a.valuation.asOf, amount: a.valuation.amount };
      if (a.valuation?.snapshot)
        st.snapshots = [
          { asOf: a.valuation.asOf, value: a.valuation.amount, units: a.valuation.units },
        ];
      if (a.closed) f.status = 'closed';
      return { added: a.transactions.length };
    },
  };
  return { io, saves, sold };
}

describe('one statement, several people', () => {
  const stmt = parseCas(TEXT);
  const { groups, skipped } = splitByOwner(stmt, OWNERS, null);

  it('gives each scheme to the person whose PAN is on its folio, and names the rest', () => {
    expect(stmt.basis).toBe('email');
    expect(groups.map((g) => g.ownerId)).toEqual(['A', 'B']);
    expect(groups[0]!.stmt.schemes.map((s) => s.folio)).toEqual([
      '6235 / 0',
      '1948 / 0',
      '7777 / 0',
      '8888',
    ]);
    expect(groups[1]!.stmt.schemes.map((s) => s.name)).toEqual(['Other Bond Fund - Direct Growth']);
    expect(skipped).toEqual([
      { panLast4: '009Z', holder: 'Holder Three', schemes: ['Third Gilt Fund - Direct Growth'] },
    ]);
  });
  it('gives a scheme with no PAN printed to the person who opened the file, or nobody', () => {
    const plain = { ...stmt, schemes: stmt.schemes.map((s) => ({ ...s, folioPan: null })) };
    expect(splitByOwner(plain, OWNERS, 'B').groups.map((g) => g.ownerId)).toEqual(['B']);
    expect(splitByOwner(plain, OWNERS, null).groups).toEqual([]);
  });
  it('does not guess between two people with the same last four characters', () => {
    const twins = [
      { ownerId: 'A', panLast4: '001A' },
      { ownerId: 'C', panLast4: '001A' },
      { ownerId: 'B', panLast4: '002B' },
    ];
    expect(splitByOwner(stmt, twins, null).groups.map((g) => g.ownerId)).toEqual(['B']);
  });
  it('reads the 1986 start as the statement period', () => {
    expect(stmt.periodFrom).toBe('1986-10-01');
    expect(stmt.periodTo).toBe('2026-10-27');
  });

  it('combines two folios of one scheme into the one fund on file, by ISIN', async () => {
    const f = fund('small', 'Sample Small Cap Fund Direct Growth', 'INF000S01SC1', { units: 100 });
    const { io } = bank([f]);
    const diff = await planCasImport('A', groups[0]!.stmt, io, {
      today: '2026-10-28',
      complete: true,
    });
    const small = diff.items.filter((i) => i.assetId === 'small');
    expect(small).toHaveLength(1);
    expect(small[0]!.units).toEqual({ before: 100, after: 3797.353 });
    expect(small[0]!.lines.newCount).toBe(3);
  });

  it('matches the on-file fund by a tolerant name when it has no ISIN', async () => {
    const f = fund('small', 'Sample Small Cap Growth Direct Plan', null, { units: 100 });
    const { io } = bank([f]);
    const diff = await planCasImport('A', groups[0]!.stmt, io, {
      today: '2026-10-28',
      complete: true,
    });
    expect(diff.items.find((i) => i.assetId === 'small')!.units!.after).toBe(3797.353);
    expect(diff.items.find((i) => i.assetId === 'small')!.write!.position.isin).toBe(
      'INF000S01SC1',
    );
  });

  it('ticks a fund the statement lists with zero units after a sale, as sold', async () => {
    const f = fund('flexi', 'Sample Flexi Cap Fund - Direct Growth', 'INF000F02FX2', {
      units: 100,
    });
    const { io } = bank([f]);
    const diff = await planCasImport('A', groups[0]!.stmt, io, {
      today: '2026-10-28',
      complete: true,
    });
    const i = diff.items.find((x) => x.assetId === 'flexi')!;
    expect(i.kind).toBe('sold');
    expect(i.changed).toBe(true);
  });

  it('never calls an on-file fund sold because an email-keyed statement does not list it', async () => {
    const lost = fund('lost', 'Sample Gold Fund Direct Growth', 'INF000G06GD6', { units: 10 });
    const { io } = bank([
      lost,
      fund('small', 'Sample Small Cap Fund Direct Growth', 'INF000S01SC1', { units: 1 }),
      fund('flexi', 'Sample Flexi Cap Fund Direct Growth', 'INF000F02FX2', { units: 1 }),
      fund('mid', 'Sample Mid Cap Fund Regular Growth', 'INF000M03MC3', { units: 1 }),
    ]);
    const diff = await planCasImport('A', groups[0]!.stmt, io, {
      today: '2026-10-28',
      complete: true,
    });
    const i = diff.items.find((x) => x.assetId === 'lost')!;
    expect(i.kind).toBe('review');
    expect(i.reviewKind).toBe('absent');
    expect(i.changed).toBe(false);
    // the same statement, keyed on a PAN, may say so
    const asPan = await planCasImport('A', { ...groups[0]!.stmt, basis: 'pan' }, io, {
      today: '2026-10-28',
      complete: true,
    });
    expect(asPan.items.find((x) => x.assetId === 'lost')!.kind).toBe('sold');
  });

  it('reproduces the report: four of seven funds on file are not on the statement', async () => {
    const mine = [
      fund('small', 'Sample Small Cap Fund Direct Growth', 'INF000S01SC1', { units: 3797.353 }),
      fund(
        'flexi',
        'Sample Flexi Cap Fund Direct Growth',
        'INF000F02FX2',
        { units: 0 },
        { status: 'closed' },
      ),
      fund('mid', 'Sample Mid Cap Fund Regular Growth', 'INF000M03MC3', { units: 50 }),
      ...['One', 'Two', 'Three', 'Four'].map((n, k) =>
        fund(`gone${k}`, `Registered Elsewhere ${n} Fund`, `INF00${k}Q01QQ${k}`, { units: 10 }),
      ),
    ];
    const { io } = bank(mine);
    const asPan = { ...groups[0]!.stmt, basis: 'pan' as const };
    const diff = await planCasImport('A', asPan, io, { today: '2026-10-28', complete: true });
    expect(diff.items.filter((i) => i.kind === 'sold')).toHaveLength(0);
    const review = diff.items.filter((i) => i.kind === 'review');
    expect(review.map((i) => i.name)).toHaveLength(4);
    expect(review[0]!.why).toContain('4 of your 6 funds are missing');
  });
});

describe('the statement replaces what lower sources said', () => {
  const stmt = parseCas(TEXT);
  const a = splitByOwner(stmt, OWNERS, null).groups[0]!.stmt;
  const onlySmall = { ...a, schemes: a.schemes.filter((s) => s.isin === 'INF000S01SC1') };
  const withCsv = () =>
    fund(
      'small',
      'Sample Small Cap Fund Direct Growth',
      'INF000S01SC1',
      {
        units: 3000,
        invested: 150_000,
        lines: [
          {
            key: 'csv-a',
            date: '2025-01-05',
            kind: 'purchase',
            amount: 100_000,
            units: 2000,
            source: 'csv',
          },
          {
            key: 'csv-b',
            date: '2025-02-20',
            kind: 'purchase',
            amount: 9_999,
            units: 199.98,
            source: 'csv',
          },
          {
            key: 'est-1',
            date: '2025-04-05',
            kind: 'sip',
            amount: 5_000,
            units: 100,
            source: 'estimate',
          },
          {
            key: 'man-1',
            date: '2025-06-05',
            kind: 'purchase',
            amount: 1_000,
            units: 20,
            source: 'manual',
          },
        ],
      },
      { startedOn: '2024-01-01' },
    );

  it('sets aside the lines the statement does not have, confirms the one it has, and records the period', async () => {
    const { io, saves } = bank([withCsv()]);
    const diff = await planCasImport('A', onlySmall, io, { today: '2026-10-28', complete: true });
    const i = diff.items.find((x) => x.assetId === 'small')!;
    expect(i.lines.replace!.count).toBe(3);
    expect(i.lines.duplicateCount).toBe(1); // 5 Jan 2025, 2,000 units
    expect(i.lines.newCount).toBe(2);
    const report = await applyFundDiff(diff, io, null, { statementRef: 'upload:abc123' });
    expect(saves).toHaveLength(1);
    expect(saves[0]!.lineSource).toBe('cas');
    expect(saves[0]!.replace).toMatchObject({
      keys: expect.arrayContaining(['csv-b', 'est-1', 'man-1']),
      statementRef: 'upload:abc123',
      statementOn: '2026-10-27',
    });
    expect(saves[0]!.replace!.keys).toHaveLength(3);
    expect(saves[0]!.position).toMatchObject({ coverFrom: '1986-10-01', coverTo: '2026-10-27' });
    expect(report.summary).toContain('3 replaced by the statement');
    // 4 Jan 2024 start moves to the statement's first purchase: the statement runs from the beginning and nothing else backs it
    expect(saves[0]!.position.startedOn).toBe('2025-01-05');
  });

  it('is idempotent: a second import of the same statement writes nothing at all', async () => {
    const b = bank([withCsv()]);
    const first = await planCasImport('A', onlySmall, b.io, {
      today: '2026-10-28',
      complete: true,
    });
    await applyFundDiff(first, b.io, null, { statementRef: 'upload:abc123' });
    expect(b.saves).toHaveLength(1);
    const again = await planCasImport('A', onlySmall, b.io, {
      today: '2026-10-28',
      complete: true,
    });
    expect(again.items.filter((x) => x.changed)).toHaveLength(0);
    const r = await applyFundDiff(again, b.io, null, { statementRef: 'upload:abc123' });
    expect(b.saves).toHaveLength(1);
    expect(r.summary).toContain('Nothing changed');
  });

  it('keeps the person’s own lines when the replace part is unticked, and still adds the statement’s', async () => {
    const { io, saves } = bank([withCsv()]);
    const diff = await planCasImport('A', onlySmall, io, { today: '2026-10-28', complete: true });
    await applyFundDiff(diff, io, {
      take: new Set(['A|small']),
      seen: new Set(['A|small', 'A|small#replace']),
    });
    expect(saves[0]!.replace).toBeNull();
    expect(saves[0]!.transactions).toHaveLength(2);
  });

  it('replaces nothing when the fund itself is unticked', async () => {
    const { io, saves } = bank([withCsv()]);
    const diff = await planCasImport('A', onlySmall, io, { today: '2026-10-28', complete: true });
    await applyFundDiff(diff, io, {
      take: new Set(['A|small#replace']),
      seen: new Set(['A|small', 'A|small#replace']),
    });
    expect(saves).toHaveLength(0);
  });

  it('does not let an older statement replace anything, and keeps the newer one’s values', async () => {
    const b = bank([withCsv()]);
    const first = await planCasImport('A', onlySmall, b.io, {
      today: '2026-10-28',
      complete: true,
    });
    await applyFundDiff(first, b.io, null, { statementRef: 'upload:new' });
    // the same fund, an older and shorter statement with different numbers
    const older = {
      ...onlySmall,
      periodFrom: '2025-01-01',
      periodTo: '2025-12-31',
      schemes: onlySmall.schemes.slice(0, 1).map((s) => ({
        ...s,
        closingUnits: 2_090.765,
        navDate: '2025-12-31',
        marketValue: 100_000,
      })),
    };
    const diff = await planCasImport('A', older, b.io, { today: '2026-10-28', complete: true });
    const i = diff.items.find((x) => x.assetId === 'small')!;
    expect(i.units).toBeNull();
    expect(i.invested).toBeNull();
    expect(i.lines.replace!.count).toBe(0);
    expect(i.changed).toBe(false);
    const savesBefore = b.saves.length;
    await applyFundDiff(diff, b.io, null, { statementRef: 'upload:old' });
    expect(b.saves.length).toBe(savesBefore);
  });

  it('does not replace anything when the statement’s own lines do not add up', async () => {
    const f = withCsv();
    const broken = {
      ...onlySmall,
      schemes: onlySmall.schemes.map((s) => ({ ...s, closingUnits: (s.closingUnits ?? 0) + 5 })),
    };
    const { io, saves } = bank([f]);
    const diff = await planCasImport('A', broken, io, { today: '2026-10-28', complete: true });
    const i = diff.items.find((x) => x.assetId === 'small')!;
    expect(i.lines.replace!.count).toBe(0);
    expect(i.lines.replace!.blocked).toContain('Nothing on file was replaced');
    await applyFundDiff(diff, io, null);
    expect(saves.every((s) => !s.replace && !s.position.coverTo)).toBe(true);
  });

  it('merges the reports of several people into one', async () => {
    const stmt2 = splitByOwner(parseCas(TEXT), OWNERS, null);
    const both = bank([
      fund('small', 'Sample Small Cap Fund Direct Growth', 'INF000S01SC1', { units: 1 }),
      fund('bond', 'Other Bond Fund Direct Growth', 'INF000B04BC4', { units: 1 }),
    ]);
    const reports = [];
    for (const g of stmt2.groups)
      reports.push(
        await applyFundDiff(
          await planCasImport(g.ownerId, g.stmt, both.io, { today: '2026-10-28', complete: true }),
          both.io,
        ),
      );
    const merged = mergeReports(reports);
    expect(merged.transactionsAdded).toBeGreaterThan(0);
    expect(merged.lines.length).toBe(reports.reduce((n, r) => n + r.lines.length, 0));
  });
});

describe('matching a scheme to a fund on file', () => {
  const s = (name: string, isin: string | null = null, folioLast4 = '1234') =>
    ({ name, isin, folioLast4 }) as Parameters<typeof matchScheme>[0];
  const f = (assetId: string, name: string, extra: Partial<CasFund> = {}): CasFund => ({
    assetId,
    name,
    amfiCode: null,
    isin: null,
    folioLast4: null,
    ...extra,
  });

  it('reads "Edelweiss Mid Cap Growth Direct Plan" and "Edelweiss Mid Cap Fund - Direct Plan - Growth" as one fund', () => {
    const a = schemeKey('Edelweiss Mid Cap Growth Direct Plan');
    const b = schemeKey('Edelweiss Mid Cap Fund - Direct Plan - Growth');
    expect(a.key).toBe(b.key);
    expect(a.plan).toBe('direct');
    expect(b.option).toBe('growth');
    expect(
      matchScheme(s('Edelweiss Mid Cap Fund - Direct Plan - Growth'), null, [
        f('e', 'Edelweiss Mid Cap Growth Direct Plan'),
      ]),
    ).toMatchObject({ status: 'one' });
  });
  it('ignores case, order, brackets, hyphens and "Midcap" against "Mid Cap"', () => {
    expect(schemeKey('AXIS MIDCAP FUND (erstwhile Axis Mid Cap) - DIRECT - GROWTH').key).toBe(
      schemeKey('Axis Mid-Cap Fund Growth Direct').key,
    );
    expect(schemeKey('Axis Bluechip Fund').key).toBe(schemeKey('Axis Large Cap Fund').key);
  });
  it('never mixes Direct and Regular, or Growth and IDCW, of the same scheme', () => {
    expect(
      schemeKeysCompatible(
        schemeKey('X Fund - Direct - Growth'),
        schemeKey('X Fund - Regular - Growth'),
      ),
    ).toBe(false);
    expect(
      schemeKeysCompatible(
        schemeKey('X Fund - Direct - Growth'),
        schemeKey('X Fund - Direct - IDCW'),
      ),
    ).toBe(false);
    expect(schemeKeysCompatible(schemeKey('X Fund'), schemeKey('X Fund - Direct - IDCW'))).toBe(
      true,
    );
    expect(
      matchScheme(s('Sample Flexi Cap Fund - Regular Plan - Growth'), null, [
        f('d', 'Sample Flexi Cap Fund Direct Growth'),
      ]).status,
    ).toBe('none');
  });
  it('trusts the ISIN over the name, and refuses a name match when the ISINs differ', () => {
    expect(
      matchScheme(s('Totally Different Name', 'INF000A01AB1'), null, [
        f('a', 'Sample Flexi Cap', { isin: 'INF000A01AB1' }),
      ]).status,
    ).toBe('one');
    expect(
      matchScheme(s('Sample Flexi Cap Fund - Direct Growth', 'INF000A01AB1'), null, [
        f('a', 'Sample Flexi Cap Fund Direct Growth', { isin: 'INF111A01AB1' }),
      ]).status,
    ).toBe('none');
  });
  it('uses the folio to choose between two of your funds that share an ISIN', () => {
    const two = [
      f('one', 'Sample Small Cap', { isin: 'INF000S01SC1', folioLast4: '6235' }),
      f('two', 'Sample Small Cap', { isin: 'INF000S01SC1', folioLast4: '1948' }),
    ];
    expect(matchScheme(s('Sample Small Cap', 'INF000S01SC1', '1948'), null, two)).toMatchObject({
      status: 'one',
      fund: { assetId: 'two' },
    });
    expect(matchScheme(s('Sample Small Cap', 'INF000S01SC1', '0000'), null, two).status).toBe(
      'ambiguous',
    );
  });
  it('still refuses to choose between equals and still says none for a different fund', () => {
    expect(
      matchScheme(s('Sample Flexi Cap Fund Direct Growth'), null, [
        f('a', 'Sample Flexi Cap Fund Direct Growth'),
        f('b', 'Sample Flexi Cap Fund Direct Growth'),
      ]).status,
    ).toBe('ambiguous');
    expect(
      matchScheme(s('Sample Flexi Cap Fund Direct Growth'), null, [f('a', 'Another Bond Fund')])
        .status,
    ).toBe('none');
  });
});
