import { describe, expect, it } from 'vitest';
import { fundCsvToStatement, parseTxnCsv } from '../src/txn-csv';

const HEAD = 'Date, Folio Number, Name of the Fund, Order, Units, NAV, Current Nav, Amount (INR)';
const csv = (...lines: string[]) => [HEAD, ...lines].join('\n');

describe('parseTxnCsv', () => {
  it('reads the export layout, trimming the spaces around each cell', () => {
    const r = parseTxnCsv(
      csv(
        '    2026-10-05,15428736,Alpha Flexi Cap Growth Direct Plan,buy,112.655,88.762,88.9695,9999.5',
        '    2026-09-07,8250319/48,Beta Small Cap Growth Direct Plan,sell,10.5,57.83,53.461,607.2',
      ),
    );
    expect(r.warnings).toEqual([]);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toEqual({
      date: '2026-10-05',
      folio: '15428736',
      fund: 'Alpha Flexi Cap Growth Direct Plan',
      order: 'buy',
      units: 112.655,
      nav: 88.762,
      currentNav: 88.9695,
      amount: 9999.5,
    });
    expect(r.rows[1]!.order).toBe('sell');
    expect(r.rows[1]!.folio).toBe('8250319/48');
  });

  it('keeps a quoted empty folio as empty and tolerates a BOM and Windows line ends', () => {
    const r = parseTxnCsv(
      '﻿' + csv('2021-10-01,"",Gold,buy,0.004,4754.69,14011.3,20.0').replace(/\n/g, '\r\n'),
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]!.folio).toBe('');
  });

  it('reports unreadable lines instead of guessing', () => {
    const r = parseTxnCsv(
      csv(
        '2026-13-45,1,Fund,buy,1,1,1,1',
        '2026-10-05,1,Fund,dividend,1,1,1,1',
        '2026-10-05,1,Fund,buy,abc,1,1,1',
        '2026-10-05,1,Fund,buy,0,1,1,1',
        '2026-10-05,1,Fund,buy,2,50,50,100',
      ),
    );
    expect(r.rows).toHaveLength(1);
    expect(r.warnings).toHaveLength(4);
    expect(r.warnings[0]).toContain('line 2');
    expect(r.warnings[1]).toContain('dividend');
  });

  it('refuses a file that is not this export', () => {
    const r = parseTxnCsv('Name,Age\nA,3');
    expect(r.rows).toEqual([]);
    expect(r.warnings[0]).toContain('does not look like');
  });
});

describe('fundCsvToStatement', () => {
  const rows = parseTxnCsv(
    csv(
      // a monthly SIP of 10,000 across two folios of one fund, a one-time purchase and a part sale
      '2026-01-05,111,Alpha Fund Growth Direct Plan,buy,100,100,120,10000',
      '2026-02-05,111,Alpha Fund Growth Direct Plan,buy,90,111.11,120,10000',
      '2026-03-05,222,Alpha Fund Growth Direct Plan,buy,80,125,120,10000',
      '2026-03-20,111,Alpha Fund Growth Direct Plan,buy,50,200,120,10000.5',
      '2026-04-01,111,Alpha Fund Growth Direct Plan,sell,100,150,120,15000',
      '2026-01-05,"",Digital Gold,buy,0.004,4754.69,14011.3,20',
      '2026-01-06,333,Beta Fund Growth Direct Plan,buy,10,10,12,100',
    ),
  ).rows;

  it('combines folios into one holding with units, cost, value and a SIP flag', () => {
    const { statement, notes } = fundCsvToStatement(rows, '2026-10-26');
    const alpha = statement.schemes.find((s) => s.name.startsWith('Alpha'))!;
    expect(alpha.closingUnits).toBeCloseTo(220, 3); // 100 + 90 + 80 + 50 - 100
    expect(alpha.nav).toBe(120);
    expect(alpha.navDate).toBe('2026-10-26');
    expect(alpha.marketValue).toBeCloseTo(26400, 2);
    // first-in-first-out: the sale takes the January lot (cost 10,000)
    expect(alpha.costValue).toBeCloseTo(10000 + 10000 + 10000.5, 2);
    expect(alpha.folio).toBe('111'); // the folio of the latest line
    expect(alpha.folioLast4).toBe('111');
    expect(alpha.transactions.map((t) => t.kind)).toEqual([
      'sip',
      'sip',
      'sip',
      'purchase',
      'redeem',
    ]);
    const sale = alpha.transactions[4]!;
    expect(sale.units).toBe(-100);
    expect(sale.amount).toBe(-15000);
    expect(sale.balance).toBeCloseTo(220, 3);
    expect(notes.some((n) => n.includes('Alpha Fund Growth Direct Plan: 2 folios'))).toBe(true);
    expect(notes.some((n) => n.includes('Digital Gold'))).toBe(true);
    expect(statement.schemes.map((s) => s.name)).not.toContain('Digital Gold');
    expect(statement.periodFrom).toBe('2026-01-05');
    expect(statement.periodTo).toBe('2026-10-26');
  });

  it('treats two purchases of the same amount only a few days apart as one-time purchases', () => {
    const r = parseTxnCsv(
      csv(
        '2026-01-05,1,Gamma,buy,1,10,10,100',
        '2026-01-07,1,Gamma,buy,1,10,10,100',
        '2026-01-09,1,Gamma,buy,1,10,10,100',
      ),
    ).rows;
    const g = fundCsvToStatement(r, '2026-10-26').statement.schemes[0]!;
    expect(g.transactions.every((t) => t.kind === 'purchase')).toBe(true);
  });

  it('shows a fund sold in full as holding nothing, and leaves out one whose history is incomplete', () => {
    const full = parseTxnCsv(
      csv('2026-01-05,1,Delta,buy,10,10,12,100', '2026-02-05,1,Delta,sell,10,12,12,120'),
    ).rows;
    const d = fundCsvToStatement(full, '2026-10-26').statement.schemes[0]!;
    expect(d.closingUnits).toBe(0);
    expect(d.costValue).toBe(0);
    const short = parseTxnCsv(csv('2026-02-05,1,Eps,sell,10,12,12,120')).rows;
    const e = fundCsvToStatement(short, '2026-10-26').statement;
    expect(e.schemes).toEqual([]);
    expect(e.warnings[0]).toContain('Eps');
  });
});
