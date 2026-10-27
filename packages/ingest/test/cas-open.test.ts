import { describe, expect, it } from 'vitest';
import { mentionsDemat, parseCas } from '../src/cas';
import { MAIL_PASSWORD_FAILED, openStatement, type PasswordCandidate } from '../src/cas-open';
import { PDF_EXTRA, PDF_PAN, PDF_PLAIN } from './statement-pdfs';

const PAN = 'ABCDE1234F';
const person = (extra: string[] = [], pan = PAN): PasswordCandidate => ({
  ownerId: 'o1',
  passwords: [pan, pan.toLowerCase(), ...extra],
  panLast4: pan.slice(-4),
});

describe('opening a statement PDF', () => {
  it('opens a PDF protected by the saved PAN', async () => {
    const r = await openStatement(PDF_PAN, [person()], true);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.ownerId).toBe('o1');
      expect(r.stmt.schemes).toHaveLength(2);
    }
  });
  it('opens a PDF protected by an extra statement password saved for the person', async () => {
    const r = await openStatement(PDF_EXTRA, [person(['Other#123', 'Zx9!kLm2'])], true);
    expect(r.ok).toBe(true);
  });
  it('opens an unprotected PDF and finds the person by the last four of the PAN on it', async () => {
    const r = await openStatement(PDF_PLAIN, [person()], true);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.ownerId).toBe('o1');
  });
  it('says plainly when nothing saved fits, and never repeats a password or a PAN', async () => {
    const r = await openStatement(PDF_EXTRA, [person(['wrong-one'])], true);
    expect(r).toEqual({ ok: false, ownerId: null, detail: MAIL_PASSWORD_FAILED });
    const text = JSON.stringify(r);
    for (const secret of [PAN, 'wrong-one', 'Zx9!kLm2']) expect(text).not.toContain(secret);
    expect(MAIL_PASSWORD_FAILED).toMatch(/^Could not open: none of the saved passwords fits\./);
    expect(MAIL_PASSWORD_FAILED).toContain('Statement passwords');
  });
  it('keeps the older wording for a statement uploaded by hand', async () => {
    const r = await openStatement(PDF_EXTRA, [person()], false);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.detail).toMatch(/password did not open the statement/);
  });
  it('does not accept the PDF for a person whose PAN is not on it', async () => {
    const other: PasswordCandidate = { ownerId: 'o2', passwords: [], panLast4: '9999' };
    const r = await openStatement(PDF_PLAIN, [other], true);
    expect(r.ok).toBe(false);
  });
});

describe('a combined statement that mentions demat holdings', () => {
  it('is flagged, so a fund missing from it cannot be judged sold', () => {
    expect(parseCas('Consolidated Account Statement 01-Jan-2023 To 25-Oct-2026').dematMention).toBe(
      false,
    );
    expect(mentionsDemat('ISIN: INF000A01AB1(Non-Demat) - Registrar : CAMS')).toBe(false);
    expect(mentionsDemat('Mutual Fund Units held in Demat form with NSDL')).toBe(true);
    expect(mentionsDemat('MF investments in DEMAT mode')).toBe(true);
  });
});
