import { describe, expect, it } from 'vitest';
import { casPdfText, pageLines } from '../src/cas-pdf';
import { parseCas } from '../src/cas';

/** A one-page PDF whose text pieces are drawn in the order given (each at its own position). Invented content only. */
function makePdf(pieces: { s: string; x: number; y: number }[]): Uint8Array {
  const esc = (s: string) => s.replace(/([\\()])/g, '\\$1');
  const stream = pieces
    .map((p) => `BT /F1 9 Tf 1 0 0 1 ${p.x} ${p.y} Tm (${esc(p.s)}) Tj ET`)
    .join('\n');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(out);
}

// Every piece of one scheme, laid out like the statement reads on paper, but DRAWN with the title and ISIN last and each table
// cell on its own (as the registrars' PDFs do).
const LAYOUT = [
  { s: 'Folio No: 12345678 / 45', x: 40, y: 700 },
  { s: 'PAN: ABCDE1234F', x: 200, y: 700 },
  { s: '128EFDGG-Sample Large Cap Fund - Direct Growth (Advisor: DIRECT)', x: 40, y: 686 },
  { s: 'ISIN: INF000A01AB1(Non-Demat)', x: 380, y: 686 },
  { s: 'SOME INVESTOR NAME', x: 40, y: 672 },
  { s: 'Nominee 1: SOMEONE ELSE', x: 200, y: 672 },
  { s: 'Opening Unit Balance: 0.000', x: 40, y: 658 },
  { s: '13-Oct-2021', x: 40, y: 640 },
  { s: 'Systematic Investment Purchase - Instalment No - 1', x: 100, y: 640 },
  { s: '4,999.75', x: 330, y: 640 },
  { s: '53.849', x: 380, y: 640 },
  { s: '92.8500', x: 430, y: 640 },
  { s: '53.849', x: 490, y: 640 },
  { s: '13-Nov-2021', x: 40, y: 626 },
  { s: 'Systematic Investment Purchase - Instalment No - 2', x: 100, y: 626 },
  { s: '4,999.75', x: 330, y: 626 },
  { s: '50.000', x: 380, y: 626 },
  { s: '99.9950', x: 430, y: 626 },
  { s: '103.849', x: 490, y: 626 },
  { s: 'Closing Unit Balance: 103.849', x: 40, y: 606 },
  { s: 'NAV on 28-Mar-2026: INR 100.00', x: 200, y: 606 },
  { s: 'Total Cost Value: 9,999.50', x: 380, y: 606 },
  { s: 'Market Value on 28-Mar-2026: INR 10,384.90', x: 40, y: 592 },
];

describe('reading a statement PDF by position', () => {
  it('rebuilds visual lines from pieces drawn out of order', () => {
    const lines = pageLines([
      { str: '5.00', x: 300, y: 500, width: 20, height: 9 },
      { str: 'Second line', x: 40, y: 480, width: 60, height: 9 },
      { str: 'First', x: 40, y: 500.4, width: 25, height: 9 },
      { str: 'line', x: 68, y: 500, width: 18, height: 9 },
    ]);
    expect(lines).toEqual(['First line 5.00', 'Second line']);
  });

  it('keeps columns apart and reads the scheme with its own name, however the page was drawn', async () => {
    const drawnLast = (name: string) => [
      ...LAYOUT.filter((p) => !/^(128EFDGG|ISIN)/.test(p.s)),
      ...LAYOUT.filter((p) => /^(128EFDGG|ISIN)/.test(p.s)).map((p) => ({ ...p, s: p.s })),
      { s: name, x: 0, y: 0 },
    ];
    const text = await casPdfText(makePdf(drawnLast('end')));
    const lines = text.split('\n');
    // reading order: the title line sits above the table
    expect(lines.findIndex((l) => l.includes('Sample Large Cap Fund'))).toBeLessThan(
      lines.findIndex((l) => l.includes('Opening Unit Balance')),
    );
    expect(text).toContain('4,999.75 53.849 92.8500 53.849');
    const st = parseCas(`01-Oct-2021 To 28-Mar-2026\n${text}`);
    expect(st.schemes).toHaveLength(1);
    const s = st.schemes[0]!;
    expect(s.name).toBe('Sample Large Cap Fund - Direct Growth');
    expect(s.transactions.map((t) => t.units)).toEqual([53.849, 50]);
    expect(s.closingUnits).toBe(103.849);
  });
});

describe('a statement whose text comes out with each title after its own table', () => {
  // the order the text came out in on a real statement (invented content): folio, holder, nominees, table, totals, then the title
  const TEXT = `
Consolidated Account Statement
01-Oct-2021 To 28-Mar-2026
Sample Mutual Fund
Folio No: 111111 PAN: ABCDE1234F SOME INVESTOR Nominee 1: SOMEONE ELSE Nominee 2: Nominee 3:
Opening Unit Balance: 0.000
13-Oct-2021 Systematic Investment Purchase - Instalment No - 1 4,999.75 53.849 92.8500 53.849
13-Nov-2021 Systematic Investment Purchase - Instalment No - 2 4,999.75 50.000 99.9950 103.849
Closing Unit Balance: 103.849 NAV on 28-Mar-2026: INR 100.00 Market Value on 28-Mar-2026: INR 10,384.90 Total Cost Value: 9,999.50
128EFDGG-Sample Large Cap Fund - Direct Growth (Advisor: DIRECT) ISIN: INF000A01AB1(Non-Demat) - Registrar : CAMS
Other Mutual Fund
Folio No: 222222 PAN: ABCDE1234F SOME INVESTOR Nominee 1: Nominee 2: Nominee 3:
Opening Unit Balance: 10.000
Closing Unit Balance: 10.000 NAV on 28-Mar-2026: INR 20.00 Market Value on 28-Mar-2026: INR 200.00 Total Cost Value: 150.00
GD340-Other Small Cap Fund-Direct Plan-Growth ISIN: INF000B02CD2 - Registrar : KFINTECH
`;
  it('names each scheme from the title after its table, not from the holder and nominee text', () => {
    const st = parseCas(TEXT);
    expect(st.schemes.map((s) => s.name)).toEqual([
      'Sample Large Cap Fund - Direct Growth',
      'Other Small Cap Fund-Direct Plan-Growth',
    ]);
    expect(st.schemes[0]!.transactions).toHaveLength(2);
    expect(st.schemes[0]!.closingUnits).toBe(103.849);
    expect(st.schemes[1]!.openingUnits).toBe(10);
    expect(st.schemes[1]!.closingUnits).toBe(10);
  });
});

describe('a scheme name that is really statement text', () => {
  it('is cut short and reported, never shown as a page of text', () => {
    const junk = 'Words '.repeat(60);
    const st = parseCas(
      `Folio No: 1\n${junk} ISIN: INF000A01AB1\nOpening Unit Balance: 0.000\nClosing Unit Balance: 1.000`,
    );
    expect(st.schemes[0]!.name.length).toBeLessThan(130);
    expect(st.warnings.some((w) => /could not be read cleanly/.test(w))).toBe(true);
  });
});
