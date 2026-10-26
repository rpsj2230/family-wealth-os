import { describe, expect, it } from 'vitest';
import { compareCells, matchesFilter, matchesSearch, parseCell, sortKeyed, toCsv } from './listing';

describe('parseCell', () => {
  it('reads rupee amounts, signs, percents and units as numbers', () => {
    expect(parseCell('₹1,23,456')).toEqual({ kind: 'num', n: 123456 });
    expect(parseCell('+₹500')).toEqual({ kind: 'num', n: 500 });
    expect(parseCell('−₹2,000')).toEqual({ kind: 'num', n: -2000 });
    expect(parseCell('+4.2%')).toEqual({ kind: 'num', n: 4.2 });
    expect(parseCell('12 L')).toEqual({ kind: 'num', n: 1_200_000 });
    expect(parseCell('45 days')).toEqual({ kind: 'num', n: 45 });
  });
  it('reads dates', () => {
    expect(parseCell('2026-11-01')).toEqual({ kind: 'date', t: Date.UTC(2026, 10, 1) });
    expect(parseCell('1 Nov 2026')).toEqual({ kind: 'date', t: Date.UTC(2026, 10, 1) });
  });
  it('treats blanks and dashes as empty and anything else as text', () => {
    expect(parseCell(' – ')).toEqual({ kind: 'empty' });
    expect(parseCell('')).toEqual({ kind: 'empty' });
    expect(parseCell('HDFC Bank')).toEqual({ kind: 'text', s: 'hdfc bank' });
  });
});

describe('sorting', () => {
  const rows = ['₹300', '₹1,000', '–', '₹20'];
  it('sorts numbers by value with empties last, both ways', () => {
    expect(sortKeyed(rows, parseCell, 1)).toEqual(['₹20', '₹300', '₹1,000', '–']);
    expect(sortKeyed(rows, parseCell, -1)).toEqual(['₹1,000', '₹300', '₹20', '–']);
  });
  it('sorts text naturally and keeps ties in their order', () => {
    expect(sortKeyed(['b 10', 'b 2', 'a'], parseCell, 1)).toEqual(['a', 'b 2', 'b 10']);
    expect(compareCells(parseCell('x'), parseCell('x'))).toBe(0);
  });
  it('sorts dates in time order', () => {
    expect(sortKeyed(['2027-01-05', '2026-12-31'], parseCell, 1)).toEqual([
      '2026-12-31',
      '2027-01-05',
    ]);
  });
});

describe('filters and search', () => {
  it('filters text, numbers, ranges and dates', () => {
    expect(matchesFilter('HDFC Bank', 'hdfc')).toBe(true);
    expect(matchesFilter('HDFC Bank', '!hdfc')).toBe(false);
    expect(matchesFilter('₹50,000', '>10000')).toBe(true);
    expect(matchesFilter('₹50,000', '>=50000,<60000')).toBe(true);
    expect(matchesFilter('₹50,000', '1000..40000')).toBe(false);
    expect(matchesFilter('7.25%', '>7')).toBe(true);
    expect(matchesFilter('2026-12-01', '2026-11-01..2027-03-31')).toBe(true);
    expect(matchesFilter('NRE', '=nre')).toBe(true);
    expect(matchesFilter('–', '>0')).toBe(false);
    expect(matchesFilter('anything', '')).toBe(true);
  });
  it('searches by all words in any order', () => {
    expect(matchesSearch('Rupash HDFC Bank savings', 'hdfc rupash')).toBe(true);
    expect(matchesSearch('Rupash HDFC Bank savings', 'hdfc ragini')).toBe(false);
    expect(matchesSearch('x', '  ')).toBe(true);
  });
});

describe('toCsv', () => {
  it('quotes commas and quotes, and neutralises formulas', () => {
    const csv = toCsv([
      ['Name', 'Note'],
      ['A, B', '=SUM(1)'],
      ['-₹5,000', '-x'],
      ['say "hi"', ''],
    ]);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('"A, B",\'=SUM(1)');
    expect(csv).toContain('"-₹5,000",\'-x');
    expect(csv).toContain('"say ""hi"""');
  });
});
