import { describe, expect, it } from 'vitest';
import { categorize } from '../src/statement-categories';
import { classifyLines, type ClassifyContext, type StmtLine } from '../src/statement-classify';

// Narrations as Indian banks write them; every merchant reference and amount is invented.
describe('what a line was, from its merchant and words', () => {
  const cases: [string, number, string, 'high' | 'medium'][] = [
    ['UPI-ZOMATO LIMITED-zomato.order@hdfcbank-HDFC0000001-1234-UPI', -640, 'food', 'high'],
    ['POS 4321XXXXXXXX1234 INDIGO AIRLINES GURGAON', -18_450, 'flights', 'high'],
    ['UPI-MAKEMYTRIP INDIA PVT LTD-mmt@icici-UPI', -45_200, 'travel', 'high'],
    ['IRCTC CF NEW DELHI', -2_150, 'travel', 'high'],
    ['UPI-AMAZON PAY INDIA-amazonupi@apl-UPI', -3_999, 'shopping', 'high'],
    ['BIL/ONL/000123/BESCOM BANGALORE', -2_340, 'utilities', 'high'],
    ['NWD-ATM WDL-SAMPLE BANK ATM', -10_000, 'cash', 'high'],
    ['AUTOPAY SI-TAD 4321XXXXXXXX1234', -62_000, 'card_bill', 'high'],
    ['TDS DEDUCTED ON FD INT', -1_200, 'taxes', 'high'],
    ['NEFT CR-SAMPLE TECH PVT LTD-SALARY OCT', 185_000, 'salary', 'high'],
    ['ACH C- SAMPLE INDUSTRIES FINAL DIV', 2_400, 'dividend', 'high'],
    ['REFUND AMAZON ORDER 403-000', 1_299, 'refund', 'medium'],
    ['CMS/CPC REFUND ITDTAX', 18_000, 'tax_refund', 'high'],
  ];
  for (const [narration, amount, id, confidence] of cases)
    it(`${narration} → ${id}`, () => {
      expect(categorize(narration, amount)).toMatchObject({ id, confidence });
    });
  it('money in is never spending, and money out never income', () => {
    expect(categorize('UPI-ZOMATO REFUND', 640)?.id).not.toBe('food');
    expect(categorize('NEFT DR-SALARY ADVANCE TO SAMPLE STAFF', -20_000)?.id).not.toBe('salary');
  });
  it('a name the lists do not know is not guessed', () => {
    expect(categorize('IMPS-SAMPLE PERSON-SBIN000001', -150_000)).toBeNull();
  });
});

describe('the classifier places known merchants without asking', () => {
  const ctx: ClassifyContext = {
    accounts: [{ assetId: 'a', ownerId: 'r', last4: '1111' }],
    deposits: [],
    fundTxns: [],
    rentWords: [],
    remittanceWords: [],
    reviewAbove: 10_000,
    autoTagUpTo: 500_000,
    autoTagWordUpTo: 50_000,
    pairDays: 3,
    fundDays: 5,
  };
  const l = (
    id: string,
    amount: number,
    narration: string,
    extra: Partial<StmtLine> = {},
  ): StmtLine => ({
    id,
    assetId: 'a',
    ownerId: 'r',
    date: '2026-10-01',
    amount,
    narration,
    ...extra,
  });
  const run = (lines: StmtLine[], c = ctx) =>
    Object.fromEntries(classifyLines(lines, c).map((x) => [x.id, x]));
  it('a large flight is travel spending, a large refund money back, salary earnings, TDS tax', () => {
    const r = run([
      l('f', -95_000, 'POS INDIGO AIRLINES'),
      l('r', 40_000, 'REFUND MAKEMYTRIP BOOKING'),
      l('s', 185_000, 'NEFT CR-SAMPLE TECH PVT LTD-SALARY OCT'),
      l('t', -12_000, 'TDS ON FD INTEREST'),
    ]);
    expect(r.f).toMatchObject({ cls: 'spent', category: 'flights' });
    expect(r.r).toMatchObject({ cls: 'outside_in', category: 'refund' });
    expect(r.s).toMatchObject({ cls: 'income', category: 'salary' });
    expect(r.t).toMatchObject({ cls: 'tax', category: 'taxes' });
  });
  it('above the limits it is still asked; a general word is trusted to a lower amount', () => {
    const r = run([
      l('big', -600_000, 'UPI-AMAZON PAY INDIA'),
      l('hotel', -80_000, 'POS SAMPLE HOTEL AND RESORT'),
      l('hotel2', -30_000, 'POS SAMPLE HOTEL AND RESORT'),
    ]);
    expect(r.big!.cls).toBe('ask_out');
    expect(r.hotel!.cls).toBe('ask_out');
    expect(r.hotel2).toMatchObject({ cls: 'spent', category: 'travel' });
  });
  it('a transfer to someone the lists do not know is still asked when it is large', () => {
    expect(run([l('p', -150_000, 'IMPS-SAMPLE PERSON-SBIN000001')]).p!.cls).toBe('ask_out');
  });
  it('a small unknown debit is other spending, and a person’s tag wins over the guess', () => {
    const r = run([
      l('small', -900, 'UPI-SAMPLE PERSON-9876'),
      l('mine', -250_000, 'IMPS-SAMPLE PERSON-SBIN000001', { category: 'medical' }),
      l('over', -2_000, 'UPI-SWIGGY', { category: 'groceries' }),
    ]);
    expect(r.small).toMatchObject({ cls: 'spent', category: 'other_spend' });
    expect(r.mine).toMatchObject({ cls: 'spent', category: 'medical' });
    expect(r.over).toMatchObject({ category: 'groceries' });
  });
  it('without the limits (an older setting) nothing is placed by its merchant', () => {
    const { autoTagUpTo: _a, autoTagWordUpTo: _b, ...old } = ctx;
    expect(run([l('f', -95_000, 'POS INDIGO AIRLINES')], old).f!.cls).toBe('ask_out');
  });
});
