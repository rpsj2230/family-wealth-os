import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readBankStatement } from '../src/bank-statement';
import { gridsFromXls } from '../src/xls-binary';

// An invented statement saved as an old Excel file (Excel 97–2003): 60 lines, dates as Excel dates, text with accents.
const file = new Uint8Array(
  readFileSync(new URL('./fixtures/sample-statement.xls', import.meta.url)),
);

describe('an old Excel file (.xls)', () => {
  it('reads its cells: text, numbers, and numbers in a date format as dates', () => {
    const [sheet] = gridsFromXls(file);
    const heading = sheet!.findIndex((r) => r.includes('Withdrawl Amt'));
    const first = sheet![heading + 1]!;
    expect(first[1]).toEqual(new Date(Date.UTC(2025, 0, 1)));
    expect(first[2]).toMatch(/^NEFT CR SAMPLE PERSON 0 with a longer narration/);
    expect(typeof first[7]).toBe('number');
    expect(sheet![heading + 2]![2]).toBe('UPI SAMPLE SHOP 1 ünïcødé café');
  });

  it('reads as a bank statement whose balances follow on', async () => {
    const s = await readBankStatement(file);
    expect(s).toMatchObject({
      from: '2025-01-01',
      to: '2025-03-04',
      breaks: 0,
      closing: 652_922.37,
    });
    expect(s.lines).toHaveLength(60);
  });

  it('refuses a file that is not one', () => {
    expect(() => gridsFromXls(new Uint8Array(600))).toThrow(/not an old Excel file/);
  });
});
