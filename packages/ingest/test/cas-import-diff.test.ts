import { statementLineKeys } from '@fwos/core';
import { describe, expect, it } from 'vitest';
import { parseCas } from '../src/cas';
import {
  applyFundDiff,
  planCasImport,
  runCasImport,
  sipKey,
  type CasFund,
  type CasIo,
  type CasSave,
} from '../src/cas-import';

const TEXT = `01-Jan-2023 To 25-Oct-2026
Folio No: 12345678 / 45 PAN: ABCDE1234F
120503 - Sample Flexi Cap Fund - Direct Plan - Growth (Advisor: DIRECT) ISIN: INF000A01AB1 - Registrar : CAMS
Opening Unit Balance: 0.000
05-Jan-2023 Purchase 100,000.00 1,000.000 100.00 1,000.000
05-Feb-2023 Systematic Investment Purchase - Instalment No - 1 10,000.00 90.909 110.00 1,090.909
05-Mar-2026 Systematic Investment Purchase - Instalment No - 2 10,000.00 80.000 125.00 1,170.909
10-Sep-2026 Redemption (75,000.00) (500.000) 150.00 670.909
Closing Unit Balance: 670.909 NAV on 25-Oct-2026: INR 160.00 Total Cost Value: 70,000.00 Market Value on 25-Oct-2026: INR 107,345.44
`;

const SIP_TEXT = `01-Jan-2025 To 25-Oct-2026
Folio No: 12345678 / 45 PAN: ABCDE1234F
120503 - Sample Flexi Cap Fund - Direct Plan - Growth (Advisor: DIRECT) ISIN: INF000A01AB1 - Registrar : CAMS
Opening Unit Balance: 0.000
05-Oct-2025 Systematic Investment Purchase - Instalment No - 1 10,000.00 100.000 100.00 100.000
05-Nov-2025 Systematic Investment Purchase - Instalment No - 2 10,000.00 100.000 100.00 200.000
05-Dec-2025 Systematic Investment Purchase - Instalment No - 3 10,000.00 100.000 100.00 300.000
05-Jan-2026 Systematic Investment Purchase - Instalment No - 4 10,000.00 100.000 100.00 400.000
05-Feb-2026 Systematic Investment Purchase - Instalment No - 5 10,000.00 100.000 100.00 500.000
05-Mar-2026 Systematic Investment Purchase - Instalment No - 6 10,000.00 100.000 100.00 600.000
Closing Unit Balance: 600.000 NAV on 25-Oct-2026: INR 160.00 Total Cost Value: 60,000.00 Market Value on 25-Oct-2026: INR 96,000.00
`;

function fakeIo(funds: CasFund[]) {
  const saved: CasSave[] = [];
  const created: string[] = [];
  const sold: { assetId: string; asOf: string }[] = [];
  const ignored: { assetId: string; verdict: string; basis: string }[] = [];
  const io: CasIo = {
    async markSold(a) {
      sold.push(a);
    },
    async rememberIgnored(a) {
      ignored.push(a);
    },
    async funds() {
      return funds;
    },
    async isinToAmfi() {
      return null;
    },
    async createFund(a) {
      created.push(a.name);
      return `new-${created.length}`;
    },
    async save(a) {
      saved.push(a);
      return { added: a.transactions.length };
    },
  };
  return { io, saved, created, sold, ignored };
}

describe('only what is new or changed is written', () => {
  const one = { ...parseCas(TEXT), basis: 'pan' as const };
  const scheme = one.schemes[0]!;
  const keys = statementLineKeys(scheme.folio, scheme.transactions);
  const stored = (n = 4) =>
    scheme.transactions.slice(0, n).map((t, i) => ({
      key: keys[i]!,
      date: t.date,
      kind: t.kind,
      amount: t.amount,
      units: t.units,
      source: 'cas',
    }));
  const fund = (
    over: Partial<NonNullable<CasFund['state']>> = {},
    f: Partial<CasFund> = {},
  ): CasFund => ({
    assetId: 'f1',
    name: 'Sample Flexi Cap Fund',
    amfiCode: null,
    isin: 'INF000A01AB1',
    folioLast4: '7845',
    status: 'active',
    unitsAsOf: '2026-10-25',
    startedOn: '2023-01-05',
    ...f,
    state: {
      units: 670.909,
      invested: 70_000,
      sipMonthly: 10_000,
      sipStopped: true,
      sipChanges: [
        { from: '2023-02-05', monthly: 10_000 },
        { from: '2026-03-06', monthly: 0 },
      ],
      lines: stored(),
      latestValue: { asOf: '2026-10-25', amount: 107_345.44 },
      snapshots: [{ asOf: '2026-10-25', value: 107_345.44, units: 670.909 }],
      ignored: [],
      cover: { from: '2023-01-01', to: '2026-10-25' },
      ...over,
    },
  });
  /** the fund as it was before the sale of 10 Sep: three lines stored */
  const behind = () => fund({ units: 1170.909, invested: 120_000, lines: stored(3) });

  it('writes nothing for a fund with nothing new, and says so', async () => {
    const { io, saved, sold } = fakeIo([fund()]);
    const r = await runCasImport('owner', one, io, { today: '2026-10-26' });
    expect(saved).toEqual([]);
    expect(sold).toEqual([]);
    expect(r.transactionsAdded).toBe(0);
    expect(r.unchanged).toBe(1);
    expect(r.summary).toBe('Nothing changed: 1 fund already up to date');
  });

  it('writes only the lines that are not stored yet, and only the values that moved', async () => {
    const { io, saved } = fakeIo([
      fund({
        units: 1170.909,
        invested: 120_000,
        lines: stored(3),
        latestValue: null,
        snapshots: [],
      }),
    ]);
    const r = await runCasImport('owner', one, io, { today: '2026-10-26' });
    expect(saved).toHaveLength(1);
    const s = saved[0]!;
    expect(s.transactions.map((t) => t.date)).toEqual(['2026-09-10']);
    expect(s.transactions[0]!.key).toBe(keys[3]);
    expect(s.position).toEqual({
      units: 670.909,
      unitsAsOf: '2026-10-25',
      invested: 70_000,
      casAsOf: '2026-10-25',
    });
    expect(s.sip).toEqual([]);
    expect(s.closed).toBe(false);
    expect(r.summary).toBe('1 fund updated: +1 transaction');
    expect(r.lines).toContain('updated: Sample Flexi Cap Fund (1 new transactions)');
  });

  it('the same statement imported twice writes nothing the second time', async () => {
    const first = fakeIo([behind()]);
    const diff = await planCasImport('owner', one, first.io, { today: '2026-10-26' });
    expect(diff.items[0]!.lines.newCount).toBe(1);
    const second = fakeIo([fund()]);
    const again = await runCasImport('owner', one, second.io, { today: '2026-10-26' });
    expect(second.saved).toEqual([]);
    expect(again.summary).toContain('Nothing changed');
  });

  it('applies only the items chosen, and remembers the ones that were shown and not chosen', async () => {
    const sipStmt = { ...parseCas(SIP_TEXT), basis: 'pan' as const };
    const sk = statementLineKeys(sipStmt.schemes[0]!.folio, sipStmt.schemes[0]!.transactions);
    const have = sipStmt.schemes[0]!.transactions.slice(0, 5).map((t, i) => ({
      key: sk[i]!,
      date: t.date,
      kind: t.kind,
      amount: t.amount,
      units: t.units,
      source: 'cas',
    }));
    const missing = {
      assetId: 'gone',
      name: 'Fund Not On The Statement',
      amfiCode: null,
      isin: 'INF999Z99ZZ9',
      folioLast4: null,
      status: 'active',
    } as CasFund;
    const active = fund({
      sipStopped: false,
      sipChanges: [],
      units: 500,
      invested: 50_000,
      lines: have,
    });
    const a = fakeIo([active, missing]);
    const diff = await planCasImport('owner', sipStmt, a.io, {
      today: '2026-10-26',
      complete: true,
    });
    const shown = diff.items.flatMap((i) => [i.key, sipKey(i.key)]);
    // take the new line and the sale of the missing fund, but not the SIP stop
    const report = await applyFundDiff(diff, a.io, {
      take: new Set(['owner|f1', 'owner|gone']),
      seen: new Set(shown),
    });
    expect(a.saved).toHaveLength(1);
    expect(a.saved[0]!.sip).toEqual([]);
    expect(a.saved[0]!.transactions.map((t) => t.date)).toEqual(['2026-03-05']);
    expect(a.sold).toEqual([{ assetId: 'gone', asOf: '2026-10-25' }]);
    expect(a.ignored).toContainEqual({
      assetId: 'f1',
      verdict: 'sip_stopped',
      basis: '2026-03-05',
    });
    expect(report.summary).toBe('1 fund updated: +1 transaction; 1 fund sold');
    // the other way round: the sale is not taken, so it is remembered for this statement; the SIP stop is taken
    const b = fakeIo([active, missing]);
    const d2 = await planCasImport('owner', sipStmt, b.io, { today: '2026-10-26', complete: true });
    await applyFundDiff(d2, b.io, {
      take: new Set(['owner|f1', sipKey('owner|f1')]),
      seen: new Set(d2.items.flatMap((i) => [i.key, sipKey(i.key)])),
    });
    expect(b.sold).toEqual([]);
    expect(b.ignored).toContainEqual({ assetId: 'gone', verdict: 'sold', basis: '2026-10-25' });
    expect(b.saved[0]!.sip).toEqual([{ monthly: 0, effectiveOn: '2026-04-05' }]);
  });

  it('a verdict remembered as overruled is not proposed again for the same statement', async () => {
    const sipStmt = parseCas(SIP_TEXT);
    const f = fund({
      sipStopped: false,
      sipChanges: [],
      units: 600,
      invested: 60_000,
      lines: [],
      ignored: [{ verdict: 'sip_stopped', basis: '2026-03-05' }],
    });
    const { io } = fakeIo([f]);
    const diff = await planCasImport('owner', sipStmt, io, { today: '2026-10-26' });
    expect(diff.items[0]!.sip!.kind).toBe('ignored');
    expect(diff.items[0]!.sip!.write).toEqual([]);
  });

  it('an item that was not shown is never applied, nor remembered', async () => {
    const { io, saved, ignored } = fakeIo([behind()]);
    const diff = await planCasImport('owner', one, io, { today: '2026-10-26' });
    await applyFundDiff(diff, io, { take: new Set(), seen: new Set() });
    expect(saved).toEqual([]);
    expect(ignored).toEqual([]);
  });

  it('a new fund and its SIP go in together, or not at all', async () => {
    const { io, created, saved } = fakeIo([]);
    const diff = await planCasImport('owner', one, io, { today: '2026-10-26' });
    const key = diff.items[0]!.key;
    await applyFundDiff(diff, io, { take: new Set(), seen: new Set([key, sipKey(key)]) });
    expect(created).toEqual([]);
    expect(saved).toEqual([]);
    await applyFundDiff(diff, io, { take: new Set([key]), seen: new Set([key]) });
    expect(created).toHaveLength(1);
    expect(saved[0]!.transactions).toHaveLength(4);
  });

  it('a transactions file does not mark funds as sold', async () => {
    const other = {
      assetId: 'gone',
      name: 'Other',
      amfiCode: null,
      isin: null,
      folioLast4: null,
      status: 'active',
    } as CasFund;
    const { io, sold } = fakeIo([fund(), other]);
    const diff = await planCasImport('owner', one, io, { today: '2026-10-26', source: 'file' });
    expect(diff.items.some((i) => i.kind === 'sold')).toBe(false);
    expect(sold).toEqual([]);
  });

  it('two folios of one fund are one holding, written once', async () => {
    const two = parseCas(`${TEXT}
Folio No: 99999999
Sample Flexi Cap Fund - Direct Plan - Growth ISIN: INF000A01AB1 - Registrar : CAMS
Opening Unit Balance: 0.000
01-Jun-2026 Purchase 1,000.00 10.000 100.00 10.000
Closing Unit Balance: 10.000 NAV on 25-Oct-2026: INR 160.00 Total Cost Value: 1,000.00 Market Value on 25-Oct-2026: INR 1,600.00
`);
    const { io, saved } = fakeIo([fund()]);
    await runCasImport('owner', two, io, { today: '2026-10-26' });
    const writes = saved.filter((x) => x.assetId === 'f1');
    expect(writes).toHaveLength(1);
    expect(writes[0]!.position.units).toBeCloseTo(680.909, 3);
    expect(writes[0]!.transactions.some((t) => t.date === '2026-06-01')).toBe(true);
  });

  it('a fund the importer knows nothing stored about is written in full, as before', async () => {
    const bare: CasFund = {
      assetId: 'f1',
      name: 'Sample Flexi Cap Fund',
      amfiCode: null,
      isin: 'INF000A01AB1',
      folioLast4: null,
    };
    const { io, saved } = fakeIo([bare]);
    await runCasImport('owner', one, io, { today: '2026-10-26' });
    expect(saved[0]!.transactions).toHaveLength(4);
    expect(saved[0]!.position.invested).toBe(70_000);
  });
});
