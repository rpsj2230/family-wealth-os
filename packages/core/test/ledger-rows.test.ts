import { describe, expect, it } from 'vitest';
import {
  buildLedger,
  filterLedger,
  ledgerExportRows,
  ledgerTotals,
  ledgerYears,
  NO_LEDGER_FILTER,
  sortLedger,
  type LedgerTxn,
} from '../src/ledger-rows';

const txns: LedgerTxn[] = [
  { date: '2023-01-05', kind: 'purchase', units: 100, amount: 10_000, nav: 100, balance: 100 },
  { date: '2023-02-05', kind: 'sip', units: 50, amount: 5_500, nav: 110, balance: 150 },
  { date: '2024-06-10', kind: 'redeem', units: -120, amount: -15_600, nav: 130, balance: 30 },
  {
    date: '2025-01-05',
    kind: 'sip',
    units: 10,
    amount: 1_500,
    nav: 150,
    balance: 40,
    source: 'statement',
  },
];
const navs = [
  { date: '2023-01-05', value: 100 },
  { date: '2024-06-10', value: 130 },
  { date: '2025-01-05', value: 150 },
  { date: '2026-10-26', value: 200 },
];
const build = (holdingMonths: number | null = 12) =>
  buildLedger({ txns, navs, navNow: 200, today: '2026-10-26', holdingMonths, gapDays: 10 });

describe('buildLedger', () => {
  it('sells the oldest units first and works out the gain and the term of each sale', () => {
    const rows = build();
    const sale = rows[2]!;
    // 100 units cost 10,000 and 20 of the 50 cost 2,200: cost 12,200, proceeds 15,600
    expect(sale.realisedGain).toBeCloseTo(15_600 - 12_200);
    expect(sale.term).toBe('long');
    expect(sale.group).toBe('sell');
    expect(sale.amount).toBe(-15_600);
    expect(sale.label).toBe('Sale');
  });
  it('keeps the units held and the cost of what is held after each line', () => {
    const rows = build();
    expect(rows.map((r) => r.balance)).toEqual([100, 150, 30, 40]);
    expect(rows[1]!.costHeld).toBeCloseTo(15_500);
    // 30 units left from the second purchase: 30 * 110
    expect(rows[2]!.costHeld).toBeCloseTo(3_300);
    expect(rows[2]!.valueAfter).toBeCloseTo(30 * 130);
  });
  it('says what each purchase still held is worth today', () => {
    const rows = build();
    expect(rows[0]!.unitsLeft).toBeNull();
    expect(rows[1]!.unitsLeft).toBeCloseTo(30);
    expect(rows[1]!.valueNow).toBeCloseTo(6_000);
    expect(rows[1]!.gainNow).toBeCloseTo(6_000 - 3_300);
    expect(rows[3]!.gainNowPct).toBeCloseTo(2_000 / 1_500 - 1);
    expect(rows[3]!.longTermOn).toBe('2026-01-05');
  });
  it('shows no term for a fund that is not equity, and leaves a sale with an unknown cost without a gain', () => {
    expect(build(null)[2]!.term).toBeNull();
    const rows = buildLedger({
      txns: [{ date: '2025-01-05', kind: 'redeem', units: -10, amount: -1_000, balance: 90 }],
      navs: [],
      navNow: null,
      today: '2026-10-26',
      holdingMonths: 12,
      gapDays: 10,
    });
    expect(rows[0]!.realisedGain).toBeNull();
    expect(rows[0]!.nav).toBeNull();
    expect(rows[0]!.valueAfter).toBeNull();
  });
  it('uses the published price when a line has none and says so', () => {
    const rows = buildLedger({
      txns: [{ date: '2024-06-12', kind: 'purchase', units: 10, amount: 1_300 }],
      navs,
      navNow: 200,
      today: '2026-10-26',
      holdingMonths: 12,
      gapDays: 10,
    });
    expect(rows[0]!.nav).toBe(130);
    expect(rows[0]!.navBasis).toBe('published');
    expect(rows[0]!.balance).toBe(10);
  });
  it('treats bonus units as costing nothing', () => {
    const rows = buildLedger({
      txns: [
        { date: '2024-01-01', kind: 'purchase', units: 10, amount: 1_000 },
        { date: '2024-02-01', kind: 'bonus', units: 10, amount: 0 },
      ],
      navs: [],
      navNow: 100,
      today: '2026-10-26',
      holdingMonths: 12,
      gapDays: 10,
    });
    expect(rows[1]!.costHeld).toBeCloseTo(1_000);
    expect(rows[1]!.group).toBe('buy');
  });
});

describe('ledger totals, filter, sort and export', () => {
  const rows = build();
  it('adds up what went in, what came out and the gain booked', () => {
    const t = ledgerTotals(rows);
    expect(t.lines).toBe(4);
    expect(t.boughtAmount).toBe(17_000);
    expect(t.sipAmount).toBe(7_000);
    expect(t.sipCount).toBe(2);
    expect(t.oneOffAmount).toBe(10_000);
    expect(t.soldAmount).toBe(15_600);
    expect(t.realisedGain).toBeCloseTo(3_400);
    expect(t.firstOn).toBe('2023-01-05');
    expect(t.lastOn).toBe('2025-01-05');
  });
  it('filters by type, year (calendar or financial) and words', () => {
    expect(filterLedger(rows, { ...NO_LEDGER_FILTER, type: 'sip' })).toHaveLength(2);
    expect(filterLedger(rows, { ...NO_LEDGER_FILTER, type: 'sell' })).toHaveLength(1);
    expect(filterLedger(rows, { ...NO_LEDGER_FILTER, year: '2023' })).toHaveLength(2);
    expect(filterLedger(rows, { ...NO_LEDGER_FILTER, year: '2024-25' }).map((r) => r.date)).toEqual(
      ['2024-06-10', '2025-01-05'],
    );
    expect(filterLedger(rows, { ...NO_LEDGER_FILTER, q: 'sale 2024' })).toHaveLength(1);
    expect(filterLedger(rows, { ...NO_LEDGER_FILTER, q: 'nothing like this' })).toHaveLength(0);
    expect(ledgerYears(rows, 'calendar')).toEqual(['2025', '2024', '2023']);
    expect(ledgerYears(rows, 'financial')).toEqual(['2024-25', '2022-23']);
  });
  it('sorts by a column either way with ties in date order', () => {
    expect(sortLedger(rows, 'amount', -1)[0]!.date).toBe('2024-06-10');
    expect(sortLedger(rows, 'date', -1)[0]!.date).toBe('2025-01-05');
    expect(sortLedger(rows, 'units', 1)[0]!.units).toBe(10);
  });
  it('gives the rows of the export with a header and plain numbers', () => {
    const out = ledgerExportRows(rows, false);
    expect(out[0]![0]).toBe('Date');
    expect(out).toHaveLength(5);
    expect(out[3]![4]).toBe('-15600.00');
    const withFund = ledgerExportRows([{ ...rows[0]!, fund: 'A Fund', owner: 'Anil' }], true);
    expect(withFund[0]!.slice(0, 3)).toEqual(['Date', 'Person', 'Fund']);
    expect(withFund[1]!.slice(1, 3)).toEqual(['Anil', 'A Fund']);
  });
});
