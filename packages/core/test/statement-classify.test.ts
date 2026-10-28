import { describe, expect, it } from 'vitest';
import {
  classifyLines,
  statementMoves,
  type ClassifyContext,
  type StmtLine,
} from '../src/statement-classify';
import { capitalLedger, ledgerMoveOf } from '../src/capital';

// An invented household: two accounts of one person, a deposit and a monthly fund investment.
const ctx: ClassifyContext = {
  accounts: [
    { assetId: 'a', ownerId: 'r', last4: '1111' },
    { assetId: 'b', ownerId: 'r', last4: '2222' },
  ],
  deposits: [
    {
      assetId: 'fd1',
      ownerId: 'r',
      principal: 300_000,
      bookedOn: '2024-04-10',
      maturityOn: '2025-04-10',
      endedOn: null,
      maturityAmount: 321_000,
    },
  ],
  fundTxns: [{ ownerId: 'r', date: '2024-04-08', amount: 10_000, side: 'buy' }],
  rentWords: ['sample tenant'],
  remittanceWords: ['inward remittance', 'sgd'],
  reviewAbove: 10_000,
  pairDays: 3,
  fundDays: 5,
};
let n = 0;
const line = (assetId: string, date: string, amount: number, narration: string): StmtLine => ({
  id: `l${++n}`,
  assetId,
  ownerId: 'r',
  date,
  amount,
  narration,
});
const lines: StmtLine[] = [
  line('a', '2024-04-01', 500_000, 'INWARD REMITTANCE FROM SGD ACCOUNT'),
  line('a', '2024-04-02', 30_000, 'NEFT CR-SAMPLE TENANT-APR RENT'),
  line('a', '2024-04-03', -200_000, 'IMPS TO OWN A/C'),
  line('b', '2024-04-04', 200_000, 'IMPS FROM SAMPLE BANK'),
  line('b', '2024-04-06', -10_000, 'ACH D- SIP INSTALMENT'),
  line('b', '2024-04-10', -300_000, 'TRANSFER TO 1234'),
  line('a', '2024-04-15', -1_200, 'UPI/…4321/GROCER'),
  line('a', '2024-04-16', -354, 'SMS ALERT CHARGES'),
  line('a', '2024-04-20', -80_000, 'NEFT TO SAMPLE BUILDER'),
  line('a', '2024-04-21', 45_000, 'NEFT CR-UNKNOWN'),
  line('a', '2024-04-25', -25_000, 'NEFT TO …2222 TRF'),
  line('a', '2024-06-30', 4_000, 'INT.PD:01-04-24 TO 30-06-24'),
  line('a', '2024-06-30', -400, 'TDS ON INT'),
  line('b', '2024-07-05', 1_500, 'INT PD ON TD 0001'),
  line('b', '2024-07-06', 2_000, 'REFUND'),
];
const byNarr = (cs: ReturnType<typeof classifyLines>, text: string) =>
  cs.find((c) => lines.find((l) => l.id === c.id)!.narration === text)!;

describe('what each statement line was', () => {
  const cs = classifyLines(lines, ctx);

  it('names rent and money from abroad by their wording', () => {
    expect(byNarr(cs, 'INWARD REMITTANCE FROM SGD ACCOUNT').cls).toBe('outside_in');
    expect(byNarr(cs, 'NEFT CR-SAMPLE TENANT-APR RENT').cls).toBe('rent');
  });

  it('pairs a transfer between two of your banks, both sides', () => {
    const out = byNarr(cs, 'IMPS TO OWN A/C');
    const into = byNarr(cs, 'IMPS FROM SAMPLE BANK');
    expect([out.cls, out.counterpart]).toEqual(['own_transfer', 'b']);
    expect([into.cls, into.counterpart]).toEqual(['own_transfer', 'a']);
  });

  it('matches a deposit booked that day, and a SIP debit to the CAS purchase', () => {
    expect(byNarr(cs, 'TRANSFER TO 1234')).toMatchObject({ cls: 'fd_funding', counterpart: 'fd1' });
    expect(byNarr(cs, 'ACH D- SIP INSTALMENT').cls).toBe('fund_buy');
  });

  it('reads interest and the tax on it, and a deposit’s interest paid out', () => {
    expect(byNarr(cs, 'INT.PD:01-04-24 TO 30-06-24').cls).toBe('interest');
    expect(byNarr(cs, 'TDS ON INT').cls).toBe('interest_tax');
    expect(byNarr(cs, 'INT PD ON TD 0001').cls).toBe('fd_interest');
  });

  it('names another of your accounts by its last four digits', () => {
    expect(byNarr(cs, 'NEFT TO …2222 TRF')).toMatchObject({
      cls: 'own_transfer',
      counterpart: 'b',
    });
  });

  it('counts small lines without asking and asks about large ones', () => {
    expect(byNarr(cs, 'UPI/…4321/GROCER').cls).toBe('spent');
    expect(byNarr(cs, 'SMS ALERT CHARGES').cls).toBe('fee');
    expect(byNarr(cs, 'REFUND').cls).toBe('outside_in');
    expect(byNarr(cs, 'NEFT TO SAMPLE BUILDER').cls).toBe('ask_out');
    expect(byNarr(cs, 'NEFT CR-UNKNOWN').cls).toBe('ask_in');
  });

  it('your answer decides', () => {
    const answered = lines.map((l) =>
      l.narration === 'NEFT CR-UNKNOWN' ? { ...l, answer: 'income' as const } : l,
    );
    expect(byNarr(classifyLines(answered, ctx), 'NEFT CR-UNKNOWN').cls).toBe('income');
  });
});

describe('the movements the lines make', () => {
  const cs = classifyLines(lines, ctx);
  const moves = statementMoves(lines, cs);

  it('makes one movement per account, month and kind, and none for transfers, deposits, funds or lines to answer', () => {
    expect(moves.map((m) => [m.idemKey, m.kind, m.amount])).toEqual([
      ['stmt:a:2024-04:outside_in', 'contribution', 500_000],
      ['stmt:a:2024-04:rent', 'income', 30_000],
      ['stmt:a:2024-04:spent', 'withdrawal', 1_200],
      ['stmt:a:2024-04:fee', 'fee', 354],
      ['stmt:b:2024-07:outside_in', 'contribution', 2_000],
    ]);
    const rent = moves.find((m) => m.idemKey.endsWith(':rent'))!;
    expect([rent.fromAssetId, rent.toAssetId, rent.movedOn]).toEqual([null, 'a', '2024-04-02']);
  });

  it('rent reaches lifetime profit and the remittance own money', () => {
    const ledgerMoves = moves
      .map((m) => ledgerMoveOf({ ...m, status: 'confirmed' }))
      .filter((m) => m !== null);
    expect(ledgerMoves.filter((m) => m.kind === 'income').reduce((a, m) => a + m.amount, 0)).toBe(
      30_000,
    );
    expect(ledgerMoves.filter((m) => m.kind === 'external').reduce((a, m) => a + m.amount, 0)).toBe(
      500_000 + 2_000 - 1_200,
    );
    expect(typeof capitalLedger).toBe('function');
  });

  it('reads ten years of lines quickly', () => {
    const many: StmtLine[] = [];
    for (let i = 0; i < 20_000; i++)
      many.push({
        id: `m${i}`,
        assetId: i % 2 ? 'a' : 'b',
        ownerId: 'r',
        date: `20${String(15 + (i % 10)).padStart(2, '0')}-0${1 + (i % 9)}-1${i % 9}`,
        amount: (i % 3 ? -1 : 1) * (100 + (i % 977)),
        narration: 'UPI/…1234/SHOP',
      });
    const t = Date.now();
    classifyLines(many, ctx);
    expect(Date.now() - t).toBeLessThan(3000);
  });
});
