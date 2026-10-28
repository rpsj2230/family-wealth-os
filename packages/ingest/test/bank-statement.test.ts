import { describe, expect, it } from 'vitest';
import {
  fromAccountOpening,
  gridFromCsv,
  gridFromHtml,
  gridFromSpreadsheetML,
  readBankStatement,
  readStatementGrid,
  readStatementText,
  statementAmount,
  statementDate,
  statementFileKind,
} from '../src/bank-statement';

// Every name, number and amount below is invented.
describe('dates and amounts as statements write them', () => {
  it('reads the day first, in every common form', () => {
    expect(statementDate('31/03/2024')).toBe('2024-03-31');
    expect(statementDate('31-03-24')).toBe('2024-03-31');
    expect(statementDate('31-Mar-2024')).toBe('2024-03-31');
    expect(statementDate('31 Mar 24')).toBe('2024-03-31');
    expect(statementDate('01 Sept 2024')).toBe('2024-09-01');
    expect(statementDate('2024-03-31 00:00:00')).toBe('2024-03-31');
    expect(statementDate(45382)).toBe('2024-03-31');
    expect(statementDate(new Date(Date.UTC(2024, 2, 31)))).toBe('2024-03-31');
    expect(statementDate('31/02/2024')).toBeNull();
    expect(statementDate('Opening Balance')).toBeNull();
  });

  it('reads Indian grouping, Cr/Dr marks and brackets', () => {
    expect(statementAmount('1,23,456.78')).toBe(123456.78);
    expect(statementAmount('₹ 500')).toBe(500);
    expect(statementAmount('500.00 Cr')).toBe(500);
    expect(statementAmount('500.00 Dr')).toBe(-500);
    expect(statementAmount('(250.00)')).toBe(-250);
    expect(statementAmount('-')).toBeNull();
    expect(statementAmount('')).toBeNull();
    expect(statementAmount('NEFT')).toBeNull();
  });
});

describe('a statement laid out as a table', () => {
  const grid = [
    ['Sample Bank Ltd'],
    ['Account No : XXXXXXXX1234', '', 'Statement from 01/04/2024 to 30/04/2024'],
    [],
    [
      'Date',
      'Narration',
      'Chq./Ref.No.',
      'Value Dt',
      'Withdrawal Amt.',
      'Deposit Amt.',
      'Closing Balance',
    ],
    [
      '01/04/24',
      'NEFT CR-SAMPLE PAYER-RENT APR',
      'N0001',
      '01/04/24',
      '',
      '25,000.00',
      '1,25,000.00',
    ],
    ['05/04/24', 'UPI/123456789012/GROCER', '', '05/04/24', '1,500.00', '', '1,23,500.00'],
    ['', 'SHOP NO 4', '', '', '', '', ''],
    ['30/04/24', 'INT.PD:01-01-24 TO 31-03-24', '', '30/04/24', '', '812.00', '1,24,312.00'],
    ['', 'Closing balance', '', '', '', '', '1,24,312.00'],
  ];

  it('finds the heading, every line, the account digits and the balances before and after', () => {
    const s = readStatementGrid(grid);
    expect(s.layout).toBe('debit-credit');
    expect(s.last4).toBe('1234');
    expect(s.lines).toHaveLength(3);
    expect(s.lines[0]).toMatchObject({
      date: '2024-04-01',
      credit: 25000,
      debit: 0,
      balance: 125000,
    });
    expect(s.from).toBe('2024-04-01');
    expect(s.to).toBe('2024-04-30');
    expect(s.opening).toBe(100000);
    expect(s.closing).toBe(124312);
    expect(s.breaks).toBe(0);
    expect(s.warnings).toEqual([]);
  });

  it('joins a narration carried on to the next row, and cuts long numbers to their last four digits', () => {
    const s = readStatementGrid(grid);
    expect(s.lines[1]!.narration).toBe('UPI/…9012/GROCER SHOP NO 4');
  });

  it('turns a newest-first statement round', () => {
    const s = readStatementGrid([grid[3]!, grid[7]!, grid[5]!, grid[4]!]);
    expect(s.lines.map((l) => l.date)).toEqual(['2024-04-01', '2024-04-05', '2024-04-30']);
    expect(s.breaks).toBe(0);
  });

  it('reports a line that is missing from the chain', () => {
    const s = readStatementGrid([grid[3]!, grid[4]!, grid[7]!]);
    expect(s.breaks).toBe(1);
    expect(s.warnings.join(' ')).toMatch(/does not follow/);
  });

  it('reads one amount column with a Dr/Cr column', () => {
    const s = readStatementGrid([
      ['Transaction Date', 'Description', 'Amount', 'Dr / Cr', 'Balance'],
      ['02-04-2024', 'IMPS TO SELF', '10,000.00', 'DR', '90,000.00 CR'],
      ['03-04-2024', 'INWARD REMITTANCE SGD', '2,00,000.00', 'CR', '2,90,000.00 CR'],
    ]);
    expect(s.layout).toBe('amount-drcr');
    expect(s.lines.map((l) => [l.debit, l.credit])).toEqual([
      [10000, 0],
      [0, 200000],
    ]);
    expect(s.opening).toBe(100000);
  });

  it('reads a negative withdrawal as a charge put back', () => {
    const s = readStatementGrid([
      ['Transaction Date', 'Description', 'Withdrawals', 'Deposits', 'Running Balance'],
      ['27 Feb 2022', 'CHARGE', '100.00', '', '1,000.00'],
      ['27 Feb 2022', 'CHARGE REVERSAL', '-100.00', '', '1,100.00'],
    ]);
    expect(s.lines.map((l) => [l.debit, l.credit])).toEqual([
      [100, 0],
      [0, 100],
    ]);
    expect(s.breaks).toBe(0);
  });

  it('reads an Excel 2003 XML statement and the account opening date', () => {
    const xml =
      '<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet><Table>' +
      '<Row><Cell ss:Index="5"><Data>Account No :</Data></Cell><Cell><Data>123456789012 (SAVING)</Data></Cell>' +
      '<Cell><Data>A/C Opening Date :</Data></Cell><Cell><Data>25/04/2016 </Data></Cell></Row>' +
      '<Row><Cell><Data>Transaction Date</Data></Cell><Cell><Data>Value Date</Data></Cell><Cell><Data>Cheque No/Reference No</Data></Cell>' +
      '<Cell><Data>Description</Data></Cell><Cell><Data>Withdrawals</Data></Cell><Cell><Data>Deposits</Data></Cell><Cell><Data>Running Balance</Data></Cell></Row>' +
      '<Row><Cell><Data>10 May 2016</Data></Cell><Cell><Data>10 May 2016</Data></Cell><Cell/><Cell><Data>CHARGES</Data></Cell><Cell><Data>200.00</Data></Cell><Cell/><Cell><Data>300.00</Data></Cell></Row>' +
      '<Row><Cell><Data>09 May 2016</Data></Cell><Cell><Data>09 May 2016</Data></Cell><Cell/><Cell><Data>NEFT CR</Data></Cell><Cell/><Cell><Data>500.00</Data></Cell><Cell><Data>500.00</Data></Cell></Row>' +
      '</Table></Worksheet></Workbook>';
    expect(statementFileKind(new TextEncoder().encode(xml))).toBe('spreadsheetml');
    const s = readStatementGrid(gridFromSpreadsheetML(xml));
    expect(s.last4).toBe('9012');
    expect(s.openedOn).toBe('2016-04-25');
    expect(s.lines.map((l) => [l.date, l.debit, l.credit])).toEqual([
      ['2016-05-09', 0, 500],
      ['2016-05-10', 200, 0],
    ]);
    expect(s.opening).toBe(0);
  });

  it('says so when the file has no statement heading', () => {
    const s = readStatementGrid([
      ['Name', 'Amount'],
      ['x', '1'],
    ]);
    expect(s.lines).toEqual([]);
    expect(s.warnings[0]).toMatch(/No heading row/);
  });
});

describe('other file forms', () => {
  it('reads a CSV export, with quoted amounts', () => {
    const csv =
      'Txn Date,Description,Debit,Credit,Balance\n' +
      '01/05/2024,"ATM WDL, MG ROAD","2,000.00",,"48,000.00"\n' +
      '02/05/2024,SALARY,,"1,00,000.00","1,48,000.00"\n';
    const s = readStatementGrid(gridFromCsv(csv));
    expect(s.lines).toHaveLength(2);
    expect(s.lines[0]!.narration).toBe('ATM WDL, MG ROAD');
    expect(s.opening).toBe(50000);
  });

  it('reads the web page some banks send as .xls', () => {
    const html =
      '<table><tr><th>Date</th><th>Particulars</th><th>Debit</th><th>Credit</th><th>Balance</th></tr>' +
      '<tr><td>01/06/2024</td><td>TRF TO FD&amp;NBSP</td><td>50,000.00</td><td></td><td>10,000.00</td></tr></table>';
    const s = readStatementGrid(gridFromHtml(html));
    expect(s.lines[0]).toMatchObject({ debit: 50000, balance: 10000 });
  });

  it('tells the file kinds apart from their first bytes', () => {
    const enc = (s: string) => new TextEncoder().encode(s);
    expect(statementFileKind(enc('%PDF-1.7'))).toBe('pdf');
    expect(statementFileKind(new Uint8Array([0x50, 0x4b, 3, 4]))).toBe('xlsx');
    expect(statementFileKind(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]))).toBe('xls-binary');
    expect(statementFileKind(enc('<html><table>'))).toBe('html');
    expect(statementFileKind(enc('Date,Narration'))).toBe('csv');
  });
});

describe('a statement read from PDF text', () => {
  it('takes the amount and its direction from how the balance moved', () => {
    const s = readStatementText([
      'Sample Bank   Account Number: 000012345678',
      'Date Value Date Description Debit Credit Balance',
      'Opening Balance 1,00,000.00',
      '01-04-2024 01-04-2024 NEFT CR SAMPLE PAYER 25,000.00 1,25,000.00',
      '05-04-2024 05-04-2024 UPI GROCER 1,500.00 1,23,500.00',
      'SHOP NO 4',
      '30-04-2024 30-04-2024 Int.Pd 812.00 1,24,312.00',
      'Page 1 of 1',
    ]);
    expect(s.layout).toBe('balance-moves');
    expect(s.last4).toBe('5678');
    expect(s.lines.map((l) => [l.debit, l.credit])).toEqual([
      [0, 25000],
      [1500, 0],
      [0, 812],
    ]);
    expect(s.lines[1]!.narration).toBe('UPI GROCER SHOP NO 4');
    expect(s.opening).toBe(100000);
    expect(s.warnings).toEqual([]);
  });

  it('reports a line whose printed amount does not match the balance', () => {
    const s = readStatementText([
      'Opening Balance 1,000.00',
      '01/04/2024 A 100.00 1,100.00',
      '03/04/2024 B 50.00 1,300.00',
    ]);
    expect(s.warnings.join(' ')).toMatch(/does not match how far the balance moved/);
  });
});

describe('a download from the day the account was opened, with no balances', () => {
  const csv = [
    'Date,Payment type,Transaction description,Category,Sub-category,Amount,Currency',
    '"30 Sep, 2024",Others,Monthly Interest Credit,Interests,Interests,310.00,INR',
    '"14 Sep, 2024",Single Transfer,Sample Person,Self Transfer,Self,-20000.00,INR',
    '"5 Sep, 2024",Single Transfer,Sample Person,Self Transfer,Self,100000.00,INR',
    '"1 Sep, 2024",Single Transfer,Sample Person,Others (In),Others,50.00,INR',
  ].join('\n');
  it('works the balances out from nothing, oldest first', async () => {
    const s = fromAccountOpening(await readBankStatement(new TextEncoder().encode(csv)));
    expect(s.lines.map((l) => l.balance)).toEqual([50, 100_050, 80_050, 80_360]);
    expect(s).toMatchObject({ opening: 0, closing: 80_360, breaks: 0, firstLineOn: '2024-09-01' });
  });
  it('refuses a download that does not start at the opening', async () => {
    const late = await readBankStatement(
      new TextEncoder().encode(csv.replace('100000.00', '1000.00')),
    );
    expect(() => fromAccountOpening(late)).toThrow(/below zero/);
  });
});

describe('a heading spelt as one bank spells it', () => {
  it('reads "Withdrawl Amt" as the money out', async () => {
    const csv = [
      ',ACCOUNT DETAILS,,,,,,,',
      ',Transaction Date,Transaction Details,,Cheque ID,Value Date,Withdrawl Amt,Deposit Amt,Balance (₹)',
      ',30/09/2026,Int.Pd:01-09-2026 to 30-09-2026,,,30/09/2026,,390,555853',
      ',23/09/2026,Closure Proceeds,,,23/09/2026,,555463,555463',
      ',08/09/2026,NEFT/RIB/SAMPLE PERSON,,,08/09/2026,67,,0',
    ].join('\n');
    const s = await readBankStatement(new TextEncoder().encode(csv));
    expect(s.lines.map((l) => l.credit - l.debit)).toEqual([-67, 555_463, 390]);
    expect(s).toMatchObject({ breaks: 0, opening: 67, closing: 555_853 });
  });
});
