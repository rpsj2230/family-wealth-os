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

  it('a credit that is a Wise transfer on file is your own money moving from Singapore, not new money', () => {
    const wise = classifyLines([line('a', '2024-07-19', 1_241_354.41, 'NEFT CR-WISE PAYMENTS')], {
      ...ctx,
      remittances: [
        { id: 'w1', date: '2024-07-18', amount: 1_241_354.41, toAssetId: null, fromAssetId: 'dbs' },
      ],
    });
    expect(wise[0]).toMatchObject({ cls: 'own_transfer', counterpart: 'dbs', remittanceId: 'w1' });
  });

  it('reads how a bank words deposits paid back and booked, and money from Singapore', () => {
    const cs = classifyLines(
      [
        line('a', '2024-01-02', 523_000, 'PRIN AND INT AUTO_REDEEM…1234'),
        line('a', '2024-01-03', 200_000, 'IB TD RED XFER TO CASA-…5678'),
        line('a', '2024-01-04', -300_000, 'NET TXN: FD BOOKED …9999'),
        line('a', '2024-01-05', 700_000, '…1111/TW…2222 PRA/SAMPLE PERSON/TRANSFERWISE'),
      ],
      { ...ctx, singaporeAssetId: 'sg' },
    );
    expect(cs.map((c) => c.cls)).toEqual([
      'fd_proceeds',
      'fd_proceeds',
      'fd_funding',
      'own_transfer',
    ]);
    expect(cs[3]).toMatchObject({ counterpart: 'sg', fromSingapore: true });
  });

  it('a transfer naming one of the household is to or from their account, at the bank its IFSC code names', () => {
    const people = [
      { ownerId: 'r', names: ['Asha'] },
      { ownerId: 'g', names: ['Vikram'] },
    ];
    const accounts = [
      { assetId: 'a', ownerId: 'r', last4: null, bank: 'Sample Bank' },
      { assetId: 'v1', ownerId: 'g', last4: null, bank: 'AU Small Finance Bank' },
      { assetId: 'v2', ownerId: 'g', last4: null, bank: 'IDFC First Bank' },
    ];
    const cs = classifyLines(
      [
        line('a', '2024-02-01', -1_000_000, 'NET-RTGS-SAMPB…1234-VIKRAM SHARMA-AUBL…5678-TRANSFER'),
        line('a', '2024-02-02', 400_000, 'RTGS CR-IDFB…0151-MR. ASHA SHARMA-ASHA'),
        line('a', '2024-02-03', 25_000, 'IMPS/VIKRM SHARMA/XXX9/RRN:…1234/'),
      ],
      { ...ctx, accounts, people },
    );
    expect(cs[0]).toMatchObject({ cls: 'own_transfer', counterpart: 'v1', person: 'g' });
    expect(cs[1]).toMatchObject({ cls: 'own_transfer', person: 'r' });
    // a one-letter slip in the name is still the person; no bank code, so the account is not known
    expect(cs[2]).toMatchObject({ cls: 'own_transfer', counterpart: null, person: 'g' });
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

describe('deposits by amount', () => {
  const dep = (assetId: string, ownerId: string, bank: string) => ({
    assetId,
    ownerId,
    bank,
    principal: 250_000,
    bookedOn: '2024-05-02',
    maturityOn: '2025-05-02',
    endedOn: null,
    maturityAmount: null,
  });
  const at = (deposits: ClassifyContext['deposits']) =>
    classifyLines([line('a', '2024-05-02', -250_000, 'TRANSFER TO 9999')], {
      ...ctx,
      accounts: [{ assetId: 'a', ownerId: 'r', last4: '1111', bank: 'Sample Bank Ltd' }],
      deposits,
    })[0]!;

  it('never takes another person’s deposit at another bank as booked from this account', () => {
    expect(at([dep('other', 'g', 'Other Bank')]).counterpart ?? null).toBeNull();
  });
  it('prefers the account holder’s own deposit, and allows a child’s at the same bank', () => {
    expect(at([dep('child', 'k', 'Sample Bank'), dep('own', 'r', 'Sample Bank')]).counterpart).toBe(
      'own',
    );
    expect(at([dep('child', 'k', 'Sample Bank')]).counterpart).toBe('child');
  });
});

describe('wording of deposits paid back, and a fund in another person’s name', () => {
  const cs = classifyLines(
    [
      line('a', '2025-01-02', 514_000, 'PRINC AND INT AUTO REDEEM SAMPLE PERSON 1234 /1'),
      line('a', '2025-01-03', 28_627, 'INT AUTO REDEEM SAMPLE PERSON 1234 /1'),
      line('a', '2025-02-05', -10_000, 'ACH DR:123,ESFB,TP ACH INDIANESIGN~1 CLG'),
    ],
    {
      ...ctx,
      deposits: [],
      fundTxns: [
        { ownerId: 'child', assetId: 'kidfund', date: '2025-02-05', amount: 10_000, side: 'buy' },
      ],
    },
  );
  it('reads "PRINC AND INT AUTO REDEEM" as a deposit paid back, and "INT AUTO REDEEM" as its interest', () => {
    expect(cs[0]!.cls).toBe('fd_proceeds');
    expect(cs[1]!.cls).toBe('fd_interest');
  });
  it('matches a SIP to a child’s fund when the account holder has none of that amount', () => {
    expect(cs[2]).toMatchObject({ cls: 'fund_buy', counterpart: 'kidfund' });
  });
});

describe('several transfers of one sum on one day', () => {
  // five accounts at four banks; three ₹5 L transfers on the same day. Read in date order alone, the first debit would take the
  // first credit; the IFSC codes in the narrations say which credit is whose.
  const banks: ClassifyContext = {
    ...ctx,
    accounts: [
      { assetId: 'esaf', ownerId: 'r', last4: '9969', bank: 'ESAF Small Finance Bank' },
      { assetId: 'yes', ownerId: 'r', last4: '0037', bank: 'Yes Bank' },
      { assetId: 'rbl', ownerId: 'r', last4: null, bank: 'RBL Bank' },
      { assetId: 'eq', ownerId: 'r', last4: '3294', bank: 'Equitas Small Finance Bank' },
    ],
    deposits: [],
    fundTxns: [],
  };
  const d = '2025-05-11';
  const ls = [
    line('rbl', d, -500_000, 'NEFT/N1/RUPASH PRATAP SINGH JADON/YESB…0474'),
    line('eq', d, -500_000, 'RTGS DR-RATN0000152-SAMPLE'),
    line('yes', d, 500_000, 'RTGS CR-ESMF0001336-RUPASH PRATAP SINGH JADON'),
    line('yes', d, 500_000, 'NEFT CR-RATN0000152-RUPASH PRATAP SINGH JADON'),
    line('esaf', d, -500_000, 'RTGS/ESMFR1/YESB0000474/RUPASH PRATAP SINGH JADON'),
    line('rbl', d, 500_000, 'RTGS/…/ESFB…/SAMPLE'),
  ];
  const cs = classifyLines(ls, banks);
  const of = (id: string) => cs.find((c) => c.id === id)!;
  it('pairs each debit with the credit whose bank codes agree', () => {
    // ESAF → Yes (the Yes credit names ESMF), RBL → Yes (the Yes credit names RATN), Equitas → RBL (each names the other)
    expect([of(ls[4]!.id).counterpart, of(ls[2]!.id).counterpart]).toEqual(['yes', 'esaf']);
    expect([of(ls[0]!.id).counterpart, of(ls[3]!.id).counterpart]).toEqual(['yes', 'rbl']);
    expect([of(ls[1]!.id).counterpart, of(ls[5]!.id).counterpart]).toEqual(['rbl', 'eq']);
  });
  it('reads a bank named in words as well as by its code', () => {
    const named = classifyLines(
      [
        line('rbl', d, -60_000, 'IMPS/RIB/123/RAGINI SINGH/YES BANK'),
        line('eq', d, 60_000, 'IMPS CR SAMPLE'),
        line('yes', d, 60_000, 'IMPS INWARD SAMPLE'),
      ],
      banks,
    );
    expect(named.map((c) => c.counterpart)).toEqual(['yes', null, 'rbl']);
  });
  it('never pairs lines whose codes name another bank', () => {
    const only = classifyLines(
      [
        line('esaf', d, -500_000, 'RTGS/ESMFR1/YESB0000474/SAMPLE'),
        line('rbl', d, 500_000, 'RTGS CR-HDFC0000001-SAMPLE'),
      ],
      banks,
    );
    expect(only.map((c) => c.cls)).toEqual(['ask_out', 'ask_in']);
  });
});

describe('money lent to someone with a loan record', () => {
  const lend: ClassifyContext = {
    ...ctx,
    borrowers: [{ assetId: 'loan-s', name: 'Shalender' }],
    deposits: [],
    fundTxns: [],
  };
  const ls = [
    line('a', '2021-09-29', 300_000, 'IMPS-123-SHELENDRA PRATAP SIN-HDFC'),
    line('a', '2021-09-28', -300_000, 'IMPS-456-SHELENDRA PRATAP SIN'),
    line('b', '2021-09-28', 300_000, 'IMPS CR SAMPLE'),
    line('a', '2021-10-02', -2_000, 'UPI-SHELENDRA'),
  ];
  const cs = classifyLines(ls, lend);
  it('is lent when paid to them and paid back when it comes from them, before any pairing', () => {
    expect(cs.slice(0, 2).map((c) => [c.cls, c.counterpart])).toEqual([
      ['own_transfer', 'loan-s'],
      ['own_transfer', 'loan-s'],
    ]);
    expect(cs[1]!.reason).toBe('Money lent to Shalender');
    // the same sum arriving in your other account is not taken for the loan: it waits for an answer
    expect(cs[2]!.cls).toBe('ask_in');
  });
  it('a small payment to them is spending', () => {
    expect(cs[3]!.cls).toBe('spent');
  });
});
