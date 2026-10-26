import { describe, expect, it } from 'vitest';
import { parseCas } from '../src/cas';
import {
  matchScheme,
  runCasImport,
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
Folio No: 55555555
Sample Large Cap Fund - Direct Plan - Growth ISIN: INF000C03EF3 - Registrar : KFINTECH
Opening Unit Balance: 0.000
01-Jul-2025 Purchase 10,000.00 100.000 100.00 100.000
01-Aug-2026 Redemption (11,000.00) (100.000) 110.00 0.000
Closing Unit Balance: 0.000 NAV on 25-Oct-2026: INR 120.00 Total Cost Value: 0.00 Market Value on 25-Oct-2026: INR 0.00
Folio No: 77777777
Sample Old Fund - Direct Plan - Growth ISIN: INF000D04GH4 - Registrar : CAMS
Opening Unit Balance: 0.000
01-Jul-2021 Purchase 10,000.00 100.000 100.00 100.000
01-Aug-2022 Redemption (11,000.00) (100.000) 110.00 0.000
Closing Unit Balance: 0.000 NAV on 25-Oct-2026: INR 120.00 Total Cost Value: 0.00 Market Value on 25-Oct-2026: INR 0.00
`;

function fakeIo(funds: CasFund[], amfi: Record<string, string> = {}) {
  const saved: CasSave[] = [];
  const created: string[] = [];
  const io: CasIo = {
    async funds() {
      return funds;
    },
    async isinToAmfi(i) {
      return amfi[i] ?? null;
    },
    async createFund(a) {
      created.push(`${a.name}${a.closed ? ' (closed)' : ''}`);
      return `new-${created.length}`;
    },
    async save(a) {
      saved.push(a);
      return { added: a.transactions.length };
    },
  };
  return { io, saved, created };
}

describe('matchScheme', () => {
  const s = parseCas(TEXT).schemes[0]!;
  const f = (o: Partial<CasFund> & { assetId: string; name: string }): CasFund => ({
    amfiCode: null,
    isin: null,
    folioLast4: null,
    ...o,
  });
  it('matches by ISIN or AMFI code before anything else', () => {
    expect(
      matchScheme(s, null, [f({ assetId: 'a', name: 'Anything', isin: 'INF000A01AB1' })]).status,
    ).toBe('one');
    expect(
      matchScheme(s, '120503', [f({ assetId: 'a', name: 'Anything', amfiCode: '120503' })]).status,
    ).toBe('one');
  });
  it('matches a well-named fund and refuses to choose between equals', () => {
    const one = matchScheme(s, null, [
      f({ assetId: 'a', name: 'Sample Flexi Cap Fund Direct Growth' }),
    ]);
    expect(one.status).toBe('one');
    const two = matchScheme(s, null, [
      f({ assetId: 'a', name: 'Sample Flexi Cap Fund Direct Growth' }),
      f({ assetId: 'b', name: 'Sample Flexi Cap Fund Direct Growth' }),
    ]);
    expect(two.status).toBe('ambiguous');
  });
  it('does not match a different fund', () => {
    expect(
      matchScheme(s, null, [f({ assetId: 'a', name: 'Another Bond Fund Direct Growth' })]).status,
    ).toBe('none');
  });
});

describe('runCasImport', () => {
  const stmt = parseCas(TEXT);
  it('updates a matched fund, creates a missing one, and ignores one sold long ago', async () => {
    const { io, saved, created } = fakeIo(
      [
        {
          assetId: 'f1',
          name: 'Sample Flexi Cap Fund',
          amfiCode: null,
          isin: null,
          folioLast4: null,
        },
      ],
      { INF000A01AB1: '120503' },
    );
    const r = await runCasImport('owner', stmt, io, { today: '2026-10-26' });
    expect(r.matched).toBe(1);
    expect(r.created).toBe(1); // sold this financial year: needed for realised gains
    expect(r.skipped).toBe(1); // sold in 2022
    expect(created).toEqual(['Sample Large Cap Fund - Direct Plan - Growth (closed)']);
    const a = saved.find((x) => x.assetId === 'f1')!;
    expect(a.position.invested).toBeCloseTo(70_000, 0); // lots reconcile: 120,000 bought, 50,000 of cost sold
    expect(a.position.startedOn).toBe('2023-01-05');
    expect(a.position.amfiCode).toBe('120503');
    expect(a.position.casAsOf).toBe('2026-10-25');
    expect(a.valuation).toEqual({ amount: 107345.44, asOf: '2026-10-25' });
    expect(r.transactionsAdded).toBe(4 + 2);
    const closed = saved.find((x) => x.assetId === 'new-1')!;
    expect(closed.closed).toBe(true);
    expect(closed.valuation).toEqual({ amount: 0, asOf: '2026-10-25' });
    expect(closed.position.invested).toBe(0);
  });
  it('reads a SIP and notices when it has stopped', async () => {
    const { io, saved } = fakeIo([
      {
        assetId: 'f1',
        name: 'Sample Flexi Cap Fund',
        amfiCode: null,
        isin: 'INF000A01AB1',
        folioLast4: null,
      },
    ]);
    await runCasImport('owner', stmt, io, { today: '2026-10-26' });
    const p = saved.find((x) => x.assetId === 'f1')!.position;
    expect(p.sipMonthly).toBe(10000);
    expect(p.sipStopped).toBe(true); // last instalment was March 2026
  });
  it('leaves an ambiguous scheme for review and carries on', async () => {
    const dup = (id: string): CasFund => ({
      assetId: id,
      name: 'Sample Flexi Cap Fund Direct Growth',
      amfiCode: null,
      isin: null,
      folioLast4: null,
    });
    const { io, saved } = fakeIo([dup('a'), dup('b')]);
    const r = await runCasImport('owner', stmt, io, { today: '2026-10-26' });
    expect(r.needsReview).toContain('Sample Flexi Cap Fund - Direct Plan - Growth');
    expect(saved.find((x) => x.assetId === 'a')).toBeUndefined();
  });
  it('keeps going when one scheme fails', async () => {
    const { io } = fakeIo([]);
    const bad: CasIo = {
      ...io,
      async createFund(a) {
        if (a.name.includes('Flexi')) throw new Error('boom');
        return 'ok';
      },
    };
    const r = await runCasImport('owner', stmt, bad, { today: '2026-10-26' });
    expect(r.needsReview).toContain('Sample Flexi Cap Fund - Direct Plan - Growth');
    expect(r.created).toBe(1);
  });
});
