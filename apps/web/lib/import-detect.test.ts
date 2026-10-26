import { describe, expect, it } from 'vitest';
import {
  KIND_CHOICES,
  detectImport,
  detectMany,
  guessOwner,
  plainCountName,
} from './import-detect';

const f = (name: string, size = 1000) => ({ name, size });

describe('detectImport', () => {
  it('an .xlsx file is the workbook', () => {
    const d = detectImport(f('Family finances 2026.xlsx'), 'PK\u0003\u0004');
    expect(d.kind).toBe('workbook');
    expect(d.confident).toBe(true);
  });

  it('an old .xls file asks for a re-save instead of failing later', () => {
    const d = detectImport(f('sheet.xls'), '');
    expect(d.kind).toBeNull();
    expect(d.message).toMatch(/Save As/);
  });

  it('a CSV with Folio and Units columns is a fund export; any other CSV needs a confirmation', () => {
    const ok = detectImport(
      f('Anil_transactions.csv'),
      'Date,Folio Number,Name of the Fund,Order,Units,NAV,Current Nav,Amount\n2025-01-01,123,X,Buy,1,1,1,1',
    );
    expect(ok).toMatchObject({ kind: 'csv', confident: true });
    const other = detectImport(f('bank.csv'), 'Date,Narration,Debit,Credit\n');
    expect(other).toMatchObject({ kind: 'csv', confident: false });
    expect(other.message).toMatch(/Folio, Units and Amount/);
  });

  it('a PDF is told apart by its name: fund statement, tax statement, or ask', () => {
    expect(detectImport(f('CAS_ABCDE1234F_2026.pdf'), '%PDF-1.7')).toMatchObject({
      kind: 'cas',
      confident: true,
    });
    expect(detectImport(f('Consolidated Account Statement.pdf'), '%PDF')).toMatchObject({
      kind: 'cas',
    });
    expect(detectImport(f('Form26AS_2025-26.pdf'), '%PDF')).toMatchObject({
      kind: 'tax',
      confident: true,
    });
    expect(detectImport(f('Rupash AIS 2025-26.pdf'), '%PDF')).toMatchObject({ kind: 'tax' });
    const unknown = detectImport(f('scan0001.pdf'), '%PDF');
    expect(unknown.kind).toBeNull();
    expect(unknown.message).toMatch(/fund statement or a tax statement/);
  });

  it('does not mistake a name that merely contains letters of a keyword', () => {
    // "raisins" contains "ais" but is not a token
    expect(detectImport(f('raisins.pdf'), '%PDF').kind).toBeNull();
  });

  it('JSON is the AIS; text or web pages are Form 26AS only when they say so', () => {
    expect(detectImport(f('ais.json'), '{').kind).toBe('tax');
    expect(detectImport(f('anything.txt'), 'FORM 26AS Annual Tax Statement').kind).toBe('tax');
    expect(detectImport(f('notes.txt'), 'shopping list').kind).toBeNull();
  });

  it('an empty file and an unknown type say what to do', () => {
    expect(detectImport(f('a.xlsx', 0), '').message).toMatch(/empty/);
    const d = detectImport(f('photo.png'), '');
    expect(d.kind).toBeNull();
    expect(d.message).toMatch(/\.xlsx/);
  });
});

describe('detectMany', () => {
  const file = (name: string, head = '') => ({ name, size: 10, head });
  it('one file is taken as it is', () => {
    expect(detectMany([file('a.xlsx')]).kind).toBe('workbook');
    expect(detectMany([]).pick).toBe(-1);
  });
  it('several fund exports go together; a mix is refused with a reason', () => {
    const csv = 'Folio Number,Units,Amount';
    expect(detectMany([file('a.csv', csv), file('b.csv', csv)])).toMatchObject({
      kind: 'csv',
      confident: true,
    });
    const mixed = detectMany([file('a.csv', csv), file('b.pdf')]);
    expect(mixed.kind).toBeNull();
    expect(mixed.message).toMatch(/one file at a time/);
  });
});

describe('guessOwner', () => {
  const owners = [
    { id: 'p1', name: 'Rupash' },
    { id: 'p2', name: 'Ragini' },
  ];
  it('uses the first name in the file name', () => {
    expect(guessOwner('Rupash__Advika_-_transactions.csv', owners)).toBe('p1');
    expect(guessOwner('ragini-cas.pdf', owners)).toBe('p2');
    expect(guessOwner('statement.pdf', owners)).toBe('');
  });
});

describe('KIND_CHOICES', () => {
  it('lists each kind once, in plain words', () => {
    expect(KIND_CHOICES.map((k) => k.kind)).toEqual(['workbook', 'cas', 'csv', 'tax']);
    expect(KIND_CHOICES.every((k) => !/observation/i.test(k.label))).toBe(true);
  });
});

describe('plainCountName', () => {
  it('replaces internal names with plain words and leaves others alone', () => {
    expect(plainCountName('observations')).toBe('balances');
    expect(plainCountName('institutions')).toBe('banks');
    expect(plainCountName('fixed deposits')).toBe('fixed deposits');
  });
});
