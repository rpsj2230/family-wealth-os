import { describe, expect, it } from 'vitest';
import { fifoLots, parseCas } from '../src/cas';

// Invented statement in the layout of a CAMS + KFintech consolidation by email address: several people's folios on one statement,
// the holder's name and the registrar's scheme code before each scheme's name, a folio held in demat form (no KYC flag), SIP
// cancellation markers in the transaction tables.
// invented PANs, built in pieces so that no PAN-shaped value sits in the file
const P1 = ['AAAAA', '0001A'].join('');
const P2 = ['AAAAA', '0002B'].join('');
const TEXT = `
Consolidated Account Statement
01-Oct-1986 To 27-Oct-2026
Email Id: someone@example.test
The consolidation has been carried out based on the email id entered by you.
Sample Mutual Fund
Folio No: 1111111 / 0 PAN: ${P1} KYC: OK PAN: OK
First Holder
128EFDGG-Sample Large Cap Fund - Direct Growth (Non Demat) - ISIN: INF000A01AB1(Advisor: INA200005166) Registrar :
KFINTECH
Nominee 1: Second Holder Nominee 2: Nominee 3:
Opening Unit Balance: 0.000
05-Jan-2026 Systematic Investment New Purchase with SIP (1) 9,999.50 100.000 100.000 100.000
05-Jan-2026 *** Stamp Duty *** 0.50
05-Feb-2026 Systematic Investment (1) 9,999.50 90.000 111.110 190.000
05-Feb-2026 *** Stamp Duty *** 0.50
26-Oct-2026 ***Cancelled***
Closing Unit Balance: 190.000 NAV on 26-Oct-2026: INR 120.00 Total Cost Value: 19,999.00 Market Value on 26-Oct-2026: INR 22,800.00
Other Mutual Fund
Folio No: 2222222 PAN: ${P2} KYC: OK PAN: OK
SECOND HOLDER
GD340-Other Small Cap Fund-Direct Plan-Growth (Non-Demat) - ISIN: INF000B02CD2(Advisor: DIRECT) Registrar : CAMS
Nominee 1: Nominee 2: Nominee 3:
Opening Unit Balance: 0.000
05-Jan-2026 SIP Purchase-BSE - Instalment No - 1 Online 5,000.00 50.000 100.000 50.000
05-Feb-2026 ***Cancelled***
05-Mar-2026 SIP Purchase-BSE - Instalment No - 1 Online 5,000.00 45.000 111.110 95.000
Closing Unit Balance: 95.000 NAV on 26-Oct-2026: INR 120.00 Total Cost Value: 10,000.00 Market Value on 26-Oct-2026: INR 11,400.00
Third Mutual Fund
Folio No: 3333333 / 72 PAN: ${P2} PAN: OK
Second Holder
HMCOG-Third Mid Cap Fund - Regular Plan - Growth (Demat) - ISIN: INF000C03EF3(Advisor: ARN-00000) Registrar : CAMS
Nominee 1: Nominee 2: Nominee 3:
Opening Unit Balance: 0.000
05-Jan-2026 Purchase 1,000.00 10.000 100.000 10.000
Closing Unit Balance: 10.000 NAV on 26-Oct-2026: INR 120.00 Total Cost Value: 1,000.00 Market Value on 26-Oct-2026: INR 1,200.00
`;

describe('a statement that holds several people’s folios', () => {
  const st = parseCas(TEXT);
  it('says what the consolidation is keyed on', () => {
    expect(st.basis).toBe('email');
    expect(parseCas('based on nothing').basis).toBe('unknown');
    expect(
      parseCas('The consolidation has been carried out based on the PAN entered by you.').basis,
    ).toBe('pan');
  });
  it('names each scheme without the holder and the scheme code, and keeps the holder and PAN apart', () => {
    expect(st.schemes.map((s) => s.name)).toEqual([
      'Sample Large Cap Fund - Direct Growth',
      'Other Small Cap Fund-Direct Plan-Growth',
      'Third Mid Cap Fund - Regular Plan - Growth',
    ]);
    expect(st.schemes.map((s) => s.holder)).toEqual([
      'First Holder',
      'SECOND HOLDER',
      'Second Holder',
    ]);
    expect(st.schemes.map((s) => s.folioPan)).toEqual([P1, P2, P2]);
    expect(st.schemes.every((s) => fifoLots(s).reconciled)).toBe(true);
  });
  it('reads a cancellation marker as a stopped SIP unless a SIP started again afterwards', () => {
    expect(st.schemes[0]!.sipCancelled).toEqual({ on: '2026-10-26' });
    // cancelled in February, a new SIP (instalment 1) in March: replaced, not stopped
    expect(st.schemes[1]!.sipCancelled ?? null).toBeNull();
  });
});
