import { describe, expect, it } from 'vitest';
import { parseCas } from '../src/cas';
import { runCasImport, type CasFund, type CasIo, type CasSave } from '../src/cas-import';

/**
 * A fund statement settles the scheme by itself: a fund matched by ISIN gets its AMFI code, every fund the statement names gets its ISIN
 * (so a fund the list cannot place still has the statement's ISIN to be matched by on Investments), and nothing is overwritten with
 * less than it had.
 */
const TEXT = `01-Jan-2025 To 25-Oct-2026
Folio No: 12345678 / 45
120503 - Sample Flexi Cap Fund - Direct Plan - Growth ISIN: INF000A01AB1 - Registrar : CAMS
Opening Unit Balance: 0.000
05-Jan-2025 Purchase 100,000.00 1,000.000 100.00 1,000.000
Closing Unit Balance: 1,000.000 NAV on 25-Oct-2026: INR 160.00 Total Cost Value: 100,000.00 Market Value on 25-Oct-2026: INR 160,000.00
Folio No: 55555555
Sample Value Fund - Direct Plan - Growth ISIN: INF000C03EF3 - Registrar : KFINTECH
Opening Unit Balance: 0.000
01-Jul-2025 Purchase 10,000.00 100.000 100.00 100.000
Closing Unit Balance: 100.000 NAV on 25-Oct-2026: INR 120.00 Total Cost Value: 10,000.00 Market Value on 25-Oct-2026: INR 12,000.00
`;

function setup(funds: CasFund[], amfi: Record<string, string>) {
  const saved: CasSave[] = [];
  const created: { name: string; isin: string | null; amfiCode: string | null }[] = [];
  const io: CasIo = {
    async funds() {
      return funds;
    },
    async isinToAmfi(i) {
      return amfi[i] ?? null;
    },
    async createFund(a) {
      created.push({ name: a.name, isin: a.isin, amfiCode: a.amfiCode });
      return `new-${created.length}`;
    },
    async save(a) {
      saved.push(a);
      return { added: a.transactions.length };
    },
  };
  return { io, saved, created };
}

const fund = (o: Partial<CasFund> & { assetId: string; name: string }): CasFund => ({
  amfiCode: null,
  isin: null,
  folioLast4: null,
  ...o,
});

describe('a statement fills the ISIN and the scheme', () => {
  const stmt = parseCas(TEXT);
  it('a fund on file that the statement names gets its ISIN, and its AMFI code when the list knows the ISIN', async () => {
    const t = setup([fund({ assetId: 'f1', name: 'Sample Flexi Cap Fund' })], {
      INF000A01AB1: '120503',
    });
    await runCasImport('owner', stmt, t.io, { today: '2026-10-26' });
    const a = t.saved.find((x) => x.assetId === 'f1')!;
    expect(a.position.isin).toBe('INF000A01AB1');
    expect(a.position.amfiCode).toBe('120503');
  });
  it('a fund the list does not know still gets the statement’s ISIN, with no AMFI code to invent', async () => {
    const t = setup([fund({ assetId: 'f1', name: 'Sample Flexi Cap Fund' })], {});
    await runCasImport('owner', stmt, t.io, { today: '2026-10-26' });
    const a = t.saved.find((x) => x.assetId === 'f1')!;
    expect(a.position.isin).toBe('INF000A01AB1');
    expect(a.position.amfiCode).toBeUndefined();
  });
  it('a new fund is created with its ISIN, and with its AMFI code only when the ISIN is in the list', async () => {
    const t = setup([], { INF000A01AB1: '120503' });
    await runCasImport('owner', stmt, t.io, { today: '2026-10-26' });
    expect(t.created).toEqual([
      expect.objectContaining({ isin: 'INF000A01AB1', amfiCode: '120503' }),
      expect.objectContaining({ isin: 'INF000C03EF3', amfiCode: null }),
    ]);
  });
  it('a fund that already has both is not written again', async () => {
    const t = setup(
      [
        fund({
          assetId: 'f1',
          name: 'Sample Flexi Cap Fund',
          isin: 'INF000A01AB1',
          amfiCode: '120503',
        }),
      ],
      { INF000A01AB1: '120503' },
    );
    await runCasImport('owner', stmt, t.io, { today: '2026-10-26' });
    const a = t.saved.find((x) => x.assetId === 'f1');
    expect(a?.position.isin).toBeUndefined();
    expect(a?.position.amfiCode).toBeUndefined();
  });
});
