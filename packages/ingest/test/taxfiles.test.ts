import { describe, expect, it } from 'vitest';
import {
  aisCategory,
  findFy,
  parse26as,
  parse26asAi,
  parseAisAi,
  parseAisJson,
  parseAisText,
  sniffTaxFile,
  taxDate,
} from '../src/taxfiles';

// Invented statements. The layouts follow what the public descriptions of Form 26AS say: a caret-separated text file, or the
// same table as text.
const CARET = [
  'File Creation Date^Permanent Account Number (PAN)^Current Status of PAN^Financial Year^Assessment Year^Name of Assessee',
  '25-10-2026^ABCDE1234F^Active^2025-26^2026-27^SAMPLE PERSON',
  'PART-A - Details of Tax Deducted at Source',
  '^Sr. No.^Name of Deductor^TAN of Deductor^Total Amount Paid / Credited(Rs.)^Total Tax Deducted(Rs.)^Total TDS Deposited(Rs.)',
  '^1^SAMPLE BANK LTD^MUMS12345A^100000.00^30000.00^30000.00',
  '^^Sr. No.^Section^Transaction Date^Status of Booking^Date of Booking^Remarks^Amount Paid / Credited(Rs.)^Tax Deducted(Rs.)^TDS Deposited(Rs.)',
  '^^1^194A^30-Jun-2025^F^15-Jul-2025^-^40000.00^12000.00^12000.00',
  '^^2^194A^30-Sep-2025^F^15-Oct-2025^-^60000.00^18000.00^18000.00',
  '^2^SAMPLE FUND HOUSE^DELS54321B^500000.00^62500.00^62500.00',
  '^^1^195^10-Aug-2025^F^20-Aug-2025^-^500000.00^62500.00^62500.00',
  'PART-C - Details of Tax Paid (other than TDS or TCS)',
  '^Sr. No.^Major Head^Minor Head^Tax^Surcharge^Education Cess^Others^Total Tax^BSR Code^Date of Deposit^Challan Serial Number',
].join('\n');

const FLAT =
  'Form 26AS Annual Tax Statement Permanent Account Number (PAN) ABCDE1234F Financial Year 2025-26 ' +
  'Part A Details of Tax Deducted at Source Sr. No. Name of Deductor TAN of Deductor Total Amount Paid / Credited(Rs.) Total Tax Deducted(Rs.) Total TDS Deposited(Rs.) ' +
  '1 SAMPLE BANK LTD MUMS12345A 100,000.00 30,000.00 30,000.00 ' +
  '1 194A 30-Jun-2025 F 15-Jul-2025 - 40,000.00 12,000.00 12,000.00 ' +
  '2 194A 30-Sep-2025 F 15-Oct-2025 - 60,000.00 18,000.00 18,000.00 ' +
  'Part C Details of Tax Paid 1 0510308 15-Mar-2026 00123 25,000.00';

describe('small readers', () => {
  it('reads dates', () => {
    expect(taxDate('30-Jun-2025')).toBe('2025-06-30');
    expect(taxDate('30/06/2025')).toBe('2025-06-30');
    expect(taxDate('nope')).toBeNull();
  });
  it('finds the financial year, or the assessment year less one', () => {
    expect(findFy('Financial Year 2025-26')).toBe('2025-26');
    expect(findFy('Assessment Year 2026-27')).toBe('2025-26');
    expect(findFy('nothing')).toBeNull();
  });
  it('tells the statements apart', () => {
    expect(sniffTaxFile('Annual Information Statement for 2025-26')).toBe('ais');
    expect(sniffTaxFile('TAN of Deductor')).toBe('26as');
    expect(sniffTaxFile('hello')).toBe('unknown');
  });
});

describe('parse26as', () => {
  it('reads the caret-separated text file', () => {
    const r = parse26as(CARET);
    expect(r.fy).toBe('2025-26');
    expect(r.panLast4).toBe('234F');
    expect(r.deductors).toHaveLength(2);
    const bank = r.deductors[0]!;
    expect(bank).toMatchObject({ name: 'SAMPLE BANK LTD', tan: 'MUMS12345A', tax: 30000 });
    expect(bank.txns.map((t) => t.section)).toEqual(['194A', '194A']);
    expect(bank.txns[0]).toMatchObject({ txnDate: '2025-06-30', status: 'F', tax: 12000 });
    expect(r.deductors[1]!.txns[0]!.section).toBe('195');
    expect(r.totalTds).toBe(92500);
    expect(r.warnings).toEqual([]);
  });
  it('reads the same table as flat text and finds the tax paid', () => {
    const r = parse26as(FLAT);
    expect(r.deductors).toHaveLength(1);
    expect(r.deductors[0]!.txns).toHaveLength(2);
    expect(r.taxPaid).toEqual([
      { bsr: '0510308', date: '2026-03-15', challan: '00123', amount: 25000 },
    ]);
  });
  it('reads a saved web page', () => {
    const html = FLAT.replace(/ (?=\d+ SAMPLE|\d 194A|\d 0510308)/g, ' | ');
    expect(parse26as(html).deductors[0]!.tan).toBe('MUMS12345A');
  });
  it('warns when the lines do not add up to the total', () => {
    const bad = FLAT.replace('30,000.00 30,000.00 1 194A', '31,000.00 31,000.00 1 194A');
    expect(parse26as(bad).warnings.join(' ')).toMatch(/add up/);
  });
  it('says so when nothing is recognised, and never keeps the PAN', () => {
    const r = parse26as('Hello there ABCDE1234F');
    expect(r.deductors).toEqual([]);
    expect(r.warnings.join(' ')).toMatch(/No deductor/);
    expect(JSON.stringify(parse26as(CARET))).not.toContain('ABCDE1234F');
  });
});

describe('AIS', () => {
  it('classifies descriptions', () => {
    expect(aisCategory('Interest from savings bank')).toBe('interest_savings');
    expect(aisCategory('Interest from deposit (194A)')).toBe('interest_deposit');
    expect(aisCategory('Dividend')).toBe('dividend');
    expect(aisCategory('Purchase of units of mutual fund')).toBe('mf_purchase');
    expect(aisCategory('Redemption of mutual fund units')).toBe('mf_redemption');
    expect(aisCategory('Sale of listed equity securities')).toBe('securities_sale');
    expect(aisCategory('Something else')).toBe('other');
  });
  it('collects information lines from any JSON that has descriptions and amounts', () => {
    const json = {
      partA: { pan: 'ABCDE1234F', name: 'X' },
      partB: {
        tds: [
          {
            informationDescription: 'Interest from deposit',
            informationSource: 'SAMPLE BANK LTD',
            amountReported: 100000,
            taxDeducted: 30000,
          },
          {
            informationDescription: 'Interest from savings bank',
            informationSource: 'SAMPLE BANK LTD',
            amountReported: '2,500.00',
          },
        ],
        sft: [
          {
            description: 'Purchase of units of mutual fund',
            source: 'SAMPLE FUND HOUSE',
            amount: 120000,
          },
        ],
      },
    };
    const a = parseAisJson(json);
    expect(a.lines).toHaveLength(3);
    expect(a.byCategory.interest_deposit).toBe(100000);
    expect(a.byCategory.interest_savings).toBe(2500);
    expect(a.byCategory.mf_purchase).toBe(120000);
    expect(a.lines[0]!.tax).toBe(30000);
    expect(a.panLast4).toBe('234F');
    expect(JSON.stringify(a)).not.toContain('ABCDE1234F');
  });
  it('reads rough text and says it is rough', () => {
    const a = parseAisText(
      'Annual Information Statement Financial Year 2025-26 Interest from savings bank 2,500.00 Dividend 800.00',
    );
    expect(a.byCategory.interest_savings).toBe(2500);
    expect(a.byCategory.dividend).toBe(800);
    expect(a.warnings.join(' ')).toMatch(/check the figures/);
  });
  it('reports an unrecognised file', () => {
    expect(parseAisJson({}).warnings.join(' ')).toMatch(/No information lines/);
  });
});

describe('AI fallback answers are checked', () => {
  const wrap = (obj: unknown) => ({ choices: [{ message: { content: JSON.stringify(obj) } }] });
  it('keeps valid deductors and drops invalid ones', () => {
    const r = parse26asAi(
      'groq',
      wrap({
        fy: '2025-26',
        deductors: [
          {
            name: 'SAMPLE BANK',
            tan: 'MUMS12345A',
            paid: 1000,
            tax: 300,
            deposited: 300,
            txns: [
              { section: '194A', paid: 1000, tax: 300 },
              { section: 'XX', paid: 1, tax: 1 },
            ],
          },
          { name: 'BAD', tan: '123', paid: 1, tax: 1 },
        ],
        taxPaid: [
          { bsr: '0510308', date: '2026-03-15', challan: '00123', amount: 5000 },
          { amount: -1 },
        ],
      }),
    );
    expect(r.deductors).toHaveLength(1);
    expect(r.deductors[0]!.txns).toHaveLength(1);
    expect(r.taxPaid).toHaveLength(1);
    expect(r.source).toBe('ai');
    expect(r.warnings.join(' ')).toMatch(/AI service/);
  });
  it('drops nonsense AIS lines', () => {
    const a = parseAisAi(
      'groq',
      wrap({
        fy: '2025-26',
        lines: [
          { description: 'Dividend', amount: 100 },
          { description: '', amount: 5 },
          { description: 'x', amount: -3 },
        ],
      }),
    );
    expect(a.lines).toHaveLength(1);
    expect(a.fy).toBe('2025-26');
  });
});
