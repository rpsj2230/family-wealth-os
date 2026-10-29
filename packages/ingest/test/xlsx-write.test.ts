import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { crc32, excelDate, tablesToXlsx, type ReportTable } from '@fwos/core';

const table: ReportTable = {
  id: 'fds',
  title: 'Deposits: by bank / test',
  note: 'Running deposits only.',
  columns: [
    { key: 'bank', label: 'Bank', kind: 'text' },
    { key: 'on', label: 'Matures', kind: 'date' },
    { key: 'n', label: 'Deposits', kind: 'int' },
    { key: 'amt', label: 'Principal', kind: 'money' },
    { key: 'rate', label: 'Rate', kind: 'rate' },
  ],
  rows: [
    { bank: 'Sample & <Co>', on: '2027-03-31', n: 2, amt: 150000.5, rate: 0.0725 },
    { bank: 'Second', on: null, n: 1, amt: 50000, rate: null },
  ],
  total: { bank: 'Total', on: null, n: 3, amt: 200000.5, rate: null },
};

describe('tablesToXlsx', () => {
  it('writes a workbook Excel can read: title, note, header, typed cells and a bold total', async () => {
    const bytes = tablesToXlsx([table, { ...table, id: 'b' }], ['Period: FY 2026-27']);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      'Deposits by bank test',
      'Deposits by bank test 2',
    ]);
    const ws = wb.worksheets[0]!;
    expect(ws.getCell('A1').value).toBe('Deposits: by bank / test');
    expect(ws.getCell('A2').value).toBe('Running deposits only.');
    expect(ws.getCell('A3').value).toBe('Period: FY 2026-27');
    expect(ws.getRow(5).values).toEqual([
      undefined,
      'Bank',
      'Matures',
      'Deposits',
      'Principal',
      'Rate',
    ]);
    expect(ws.getCell('A6').value).toBe('Sample & <Co>');
    const d = ws.getCell('B6').value as Date;
    expect(d.toISOString().slice(0, 10)).toBe('2027-03-31');
    expect(ws.getCell('C6').value).toBe(2);
    expect(ws.getCell('D6').value).toBe(150000.5);
    expect(ws.getCell('D6').numFmt).toBe('#,##,##0.00');
    expect(ws.getCell('E6').value).toBe(0.0725);
    expect(ws.getCell('E6').numFmt).toBe('0.00%');
    expect(ws.getCell('B7').value).toBeNull();
    expect(ws.getCell('D8').value).toBe(200000.5);
    expect(ws.getCell('D8').font?.bold).toBe(true);
  });

  it('an empty report still opens, with a note', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(tablesToXlsx([])) as unknown as ArrayBuffer);
    expect(wb.worksheets[0]!.getCell('A4').value).toBe('Nothing matched the filters.');
  });

  it('helpers: CRC-32 and Excel day numbers', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    expect(excelDate('1900-03-01')).toBe(61);
    expect(excelDate('2026-10-29')).toBe(46324);
  });
});
