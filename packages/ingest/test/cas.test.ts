import { describe, expect, it } from 'vitest';
import { casDate, casNumber, classify, cleanSchemeName, fifoLots, parseCas } from '../src/cas';

// Invented statement in the layout the CAMS and KFintech statements use.
const SAMPLE = `
Consolidated Account Statement
01-Jan-2023 To 25-Oct-2026
Email Id: someone@example.test
Sample Mutual Fund
Folio No: 12345678 / 45 PAN: ABCDE1234F KYC: OK PAN: OK
120503 - Sample Flexi Cap Fund - Direct Plan - Growth (Advisor: DIRECT) ISIN: INF000A01AB1(Non-Demat) - Registrar : CAMS
Opening Unit Balance: 0.000
05-Jan-2023 Purchase 100,000.00 1,000.000 100.00 1,000.000
05-Feb-2023 *** Stamp Duty *** 5.00
05-Feb-2023 Systematic Investment Purchase - Instalment No - 1 10,000.00 90.909 110.00 1,090.909
05-Mar-2024 Systematic Investment Purchase - Instalment No - 2 10,000.00 80.000 125.00 1,170.909
10-Sep-2026 Redemption (75,000.00) (500.000) 150.00 670.909
Closing Unit Balance: 670.909 NAV on 25-Oct-2026: INR 160.00 Total Cost Value: 54,000.00 Market Value on 25-Oct-2026: INR 107,345.44
Sample Mutual Fund
Folio No: 99887766
Sample Small Cap Fund - Regular Plan - Growth ISIN: INF000B02CD2 - Registrar : KFINTECH
Opening Unit Balance: 200.000
15-Jun-2025 Dividend Reinvested 500.00 5.000 100.00 205.000
Closing Unit Balance: 205.000 NAV on 25-Oct-2026: INR 120.00 Total Cost Value: 21,000.00 Market Value on 25-Oct-2026: INR 24,600.00
`;

describe('small readers', () => {
  it('reads dates and numbers', () => {
    expect(casDate('05-Feb-2023')).toBe('2023-02-05');
    expect(casDate('31-Feb-2023')).toBeNull();
    expect(casNumber('1,234.50')).toBe(1234.5);
    expect(casNumber('(1,000.00)')).toBe(-1000);
  });
  it('classifies transactions', () => {
    expect(classify('Systematic Investment Purchase', 10)).toBe('sip');
    expect(classify('Redemption', -5)).toBe('redeem');
    expect(classify('Switch Out to X', -5)).toBe('switch_out');
    expect(classify('Switch In from X', 5)).toBe('switch_in');
    expect(classify('Dividend Reinvested', 1)).toBe('dividend_reinvest');
    expect(classify('Purchase', 1)).toBe('purchase');
  });
  it('cleans scheme names', () => {
    expect(
      cleanSchemeName(
        'PAN: OK 120503 - Sample Flexi Cap Fund - Direct Plan - Growth (Advisor: DIRECT) ',
      ),
    ).toBe('Sample Flexi Cap Fund - Direct Plan - Growth');
  });
});

describe('parseCas', () => {
  const s = parseCas(SAMPLE);
  it('finds the investor, the period and both schemes', () => {
    expect(s.pan).toBe('ABCDE1234F');
    expect(s.periodFrom).toBe('2023-01-01');
    expect(s.periodTo).toBe('2026-10-25');
    expect(s.schemes).toHaveLength(2);
    expect(s.warnings).toEqual([]);
  });
  it('reads the first scheme completely', () => {
    const a = s.schemes[0]!;
    expect(a.name).toBe('Sample Flexi Cap Fund - Direct Plan - Growth');
    expect(a.isin).toBe('INF000A01AB1');
    expect(a.folio).toBe('12345678 / 45');
    expect(a.closingUnits).toBeCloseTo(670.909);
    expect(a.nav).toBe(160);
    expect(a.navDate).toBe('2026-10-25');
    expect(a.costValue).toBe(54000);
    expect(a.marketValue).toBeCloseTo(107345.44);
    expect(a.transactions.map((t) => t.kind)).toEqual(['purchase', 'sip', 'sip', 'redeem']);
    expect(a.transactions[3]!.units).toBeCloseTo(-500);
    expect(a.transactions[3]!.amount).toBe(-75000);
  });
  it('does not swallow a stamp-duty line into the next transaction', () => {
    const a = s.schemes[0]!;
    expect(a.transactions[1]!.description).toMatch(/^Systematic Investment Purchase/);
    expect(a.transactions[1]!.amount).toBe(10000);
  });
  it('reads a second scheme with units brought forward', () => {
    const b = s.schemes[1]!;
    expect(b.name).toBe('Sample Small Cap Fund - Regular Plan - Growth');
    expect(b.openingUnits).toBe(200);
    expect(b.transactions).toHaveLength(1);
  });
  it('works without line breaks and reports what it cannot read', () => {
    expect(parseCas(SAMPLE.replace(/\n/g, ' ')).schemes).toHaveLength(2);
    const none = parseCas('Hello there');
    expect(none.schemes).toEqual([]);
    expect(none.warnings.join(' ')).toMatch(/No folios/);
  });
  it('falls back to holdings statements without inventing transactions', () => {
    const h = parseCas(
      '01-Oct-2026 To 31-Oct-2026 INF000A01AB1 Sample Flexi Cap Fund Direct Growth 670.909 160.00 107,345.44',
    );
    expect(h.schemes).toHaveLength(1);
    expect(h.schemes[0]!.holdingsOnly).toBe(true);
    expect(h.schemes[0]!.transactions).toEqual([]);
  });
});

describe('fifoLots', () => {
  const [a, b] = parseCas(SAMPLE).schemes;
  it('sells the oldest units first and reconciles with the closing balance', () => {
    const r = fifoLots(a!);
    expect(r.reconciled).toBe(true);
    expect(r.lots).toHaveLength(3);
    expect(r.lots[0]!.units).toBeCloseTo(500); // half of the first purchase sold
    expect(r.lots[0]!.cost).toBeCloseTo(50_000);
    expect(r.realised).toHaveLength(1);
    expect(r.realised[0]!.cost).toBeCloseTo(50_000);
    expect(r.realised[0]!.proceeds).toBeCloseTo(75_000);
    expect(r.realised[0]!.acquiredOn).toBe('2023-01-05');
  });
  it('carries units from before the statement with the cost left over', () => {
    const r = fifoLots(b!);
    expect(r.priorUnits).toBe(200);
    expect(r.reconciled).toBe(true);
    expect(r.lots[0]!.acquiredOn).toBe('1900-01-01');
    expect(r.lots[0]!.cost).toBeCloseTo(21_000 - 500);
  });
  it('does not claim to be reconciled when the lots do not add up', () => {
    const r = fifoLots({ ...a!, closingUnits: 100 });
    expect(r.reconciled).toBe(false);
  });
});
