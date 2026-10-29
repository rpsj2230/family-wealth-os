import { describe, expect, it } from 'vitest';
import {
  chainCoverage,
  chainTables,
  endPoints,
  holdingSources,
  mainPath,
  moneyChain,
  pointsOf,
  startPoints,
  traceBack,
  traceForward,
  type ChainDeposit,
  type TraceStep,
  type TrailAsset,
  type TrailLine,
} from '../src';

const OPTS = { smallest: 1, depth: 40, budget: 400 };
let n = 0;
const ln = (
  assetId: string,
  date: string,
  amount: number,
  cls: TrailLine['cls'],
  counterpart: string | null = null,
  narration = '',
): TrailLine => ({ id: `l${++n}`, assetId, date, amount, cls, counterpart, narration });

const acct = (id: string, ownerId = 'R'): TrailAsset => ({ id, ownerId, kind: 'account' });
const dep = (d: Partial<ChainDeposit> & { assetId: string }): ChainDeposit => ({
  ownerId: 'R',
  bank: null,
  principal: 0,
  bookedOn: '2024-01-01',
  maturityOn: '2025-01-01',
  endedOn: null,
  maturityAmount: null,
  ...d,
});
const flat = (s: TraceStep): TraceStep[] => [s, ...s.steps.flatMap(flat)];

describe('money chain: C → B → A → Z and a deposit booked from it', () => {
  // ₹10L from Singapore into C, all of it to B, ₹6L of it on to A, then to Z, which held ₹2L; Z books an ₹8L deposit
  const remit = ln('C', '2024-03-01', 1_000_000, 'own_transfer', 'SG', 'Wise');
  const cOut = ln('C', '2024-03-02', -1_000_000, 'own_transfer', 'B');
  const bIn = ln('B', '2024-03-02', 1_000_000, 'own_transfer', 'C');
  const bOut = ln('B', '2024-03-05', -600_000, 'own_transfer', 'A');
  const aIn = ln('A', '2024-03-06', 600_000, 'own_transfer', 'B');
  const aOut = ln('A', '2024-03-07', -600_000, 'own_transfer', 'Z');
  const zIn = ln('Z', '2024-03-07', 600_000, 'own_transfer', 'A');
  const book = ln('Z', '2024-03-08', -800_000, 'fd_funding', 'FD1');
  const chain = moneyChain({
    lines: [remit, cOut, bIn, bOut, aIn, aOut, zIn, book],
    assets: [
      acct('C'),
      acct('B'),
      acct('A'),
      acct('Z'),
      { id: 'SG', ownerId: 'R', kind: 'account', abroad: true },
      { id: 'FD1', ownerId: 'R', kind: 'deposit' },
    ],
    deposits: [dep({ assetId: 'FD1', principal: 800_000, bookedOn: '2024-03-08' })],
    openings: new Map([['Z', 200_000]]),
    method: 'recent',
    pairDays: 3,
    remittanceOf: new Map([[remit.id, 'W1']]),
  });

  it('follows the deposit back through every account to Singapore, with the amount at each step', () => {
    const t = traceBack(chain, book.id, OPTS)!;
    // the latest money first: the ₹6L from A, then ₹2L that was in Z before its first statement
    expect(t.steps.map((s) => [s.node.id, Math.round(s.amount)])).toEqual([
      [zIn.id, 600_000],
      [`open:Z`, 200_000],
    ]);
    // a transfer is one step: the line in with the line out on the other side
    expect(t.steps[0]!.pair!.id).toBe(aOut.id);
    expect(t.steps[0]!.pairBasis).toBe('pair');
    const path = mainPath(t).map((s) => s.node.assetId);
    expect(path).toEqual(['Z', 'Z', 'A', 'B', 'C']);
    const sg = flat(t).find((s) => s.node.id === remit.id)!;
    expect(sg.starts).toEqual([
      expect.objectContaining({ kind: 'singapore', amount: 600_000, remittanceId: 'W1' }),
    ]);
  });

  it('says where the money started, in full', () => {
    const p = startPoints(chain, book.id);
    expect(p.map((x) => [x.kind, Math.round(x.amount)])).toEqual([
      ['singapore', 600_000],
      ['before_records', 200_000],
    ]);
    expect(p[0]!.node).toBe(remit.id);
  });

  it('follows the money from Singapore forward to where it is now', () => {
    const f = traceForward(chain, remit.id, OPTS)!;
    const ends = endPoints(chain, remit.id);
    // ₹6L is in the deposit, ₹4L still in B
    expect(ends.map((e) => [e.kind, e.assetId, Math.round(e.amount)])).toEqual([
      ['still', 'FD1', 600_000],
      ['still', 'B', 400_000],
    ]);
    expect(flat(f).some((s) => s.node.id === book.id)).toBe(true);
  });

  it('lists what each holding is made of today', () => {
    expect(holdingSources(chain, 'FD1').map((l) => [l.node, l.amount])).toEqual([
      [book.id, 800_000],
    ]);
    expect(holdingSources(chain, 'B').map((l) => [l.node, l.amount])).toEqual([[bIn.id, 400_000]]);
  });
});

describe('money chain: a deposit booked from two accounts, paid back with interest, and renewed', () => {
  const zOut = ln('Z', '2024-01-10', -300_000, 'ask_out');
  const yOut = ln('Y', '2024-01-11', -200_000, 'fd_funding');
  const zIn = ln('Z', '2023-12-01', 400_000, 'outside_in');
  const yIn = ln('Y', '2023-12-01', 300_000, 'outside_in');
  const back = ln('Z', '2025-01-10', 540_000, 'fd_proceeds', null, 'TD CLOSURE PROCEEDS');
  // FD3 was booked before the statements, ended 2024-06-30 and renewed into FD4, which paid back into Z
  const back4 = ln('Z', '2025-07-01', 115_000, 'fd_proceeds', 'FD4', 'TD MATURITY');
  const chain = moneyChain({
    lines: [zIn, yIn, zOut, yOut, back, back4],
    assets: [
      acct('Z'),
      acct('Y'),
      { id: 'FD2', ownerId: 'R', kind: 'deposit' },
      { id: 'FD3', ownerId: 'R', kind: 'deposit' },
      { id: 'FD4', ownerId: 'R', kind: 'deposit' },
    ],
    deposits: [
      dep({
        assetId: 'FD2',
        principal: 500_000,
        bookedOn: '2024-01-10',
        maturityOn: '2025-01-10',
        maturityAmount: 540_000,
      }),
      dep({
        assetId: 'FD3',
        principal: 100_000,
        bookedOn: '2023-06-30',
        maturityOn: '2024-06-30',
        maturityAmount: 107_000,
      }),
      dep({ assetId: 'FD4', principal: 107_000, bookedOn: '2024-06-30', maturityOn: '2025-06-30' }),
    ],
    openings: new Map(),
    method: 'recent',
    pairDays: 3,
  });

  it('finds the two lines that booked the deposit by amount and date', () => {
    const src = holdingSources(chain, 'FD2');
    expect(src.map((l) => [l.node, l.amount, l.basis])).toEqual([
      [zOut.id, 300_000, 'guess'],
      [yOut.id, 200_000, 'guess'],
    ]);
    expect(chain.guessed.depositBooked).toBe(1);
    const p = pointsOf((id, a) => startPoints(chain, id, a), src);
    expect(p.reduce((s, x) => s + x.amount, 0)).toBeCloseTo(500_000, 4);
  });

  it('pays the deposit back with the money that booked it, and its interest on top', () => {
    expect(chain.guessed.depositPaidBack).toBe(1);
    const t = traceBack(chain, back.id, OPTS)!;
    expect(t.steps.map((s) => [s.node.id, s.amount, s.via])).toEqual([
      [zOut.id, 300_000, 'FD2'],
      [yOut.id, 200_000, 'FD2'],
    ]);
    expect(t.starts).toEqual([
      expect.objectContaining({ kind: 'deposit_interest', amount: 40_000, assetId: 'FD2' }),
    ]);
    // forward from Y's line: into the deposit, back into Z, still there
    expect(endPoints(chain, yOut.id).map((e) => [e.kind, e.assetId, e.amount])).toEqual([
      ['still', 'Z', 200_000],
    ]);
  });

  it('carries a deposit into its renewal, back to the one booked before the statements', () => {
    expect(chain.guessed.renewals).toBe(1);
    const t = traceBack(chain, back4.id, OPTS)!;
    const ids = flat(t).map((s) => s.node.id);
    expect(ids).toEqual([back4.id, 'renew:FD4', 'before:FD3']);
    expect(
      startPoints(chain, back4.id).map((p) => [p.kind, p.assetId, Math.round(p.amount)]),
    ).toEqual([
      ['untraced_deposit', 'FD3', 100_000],
      ['deposit_interest', 'FD4', 8_000],
      ['deposit_interest', 'FD3', 7_000],
    ]);
  });
});

describe('money chain: the order money leaves an account in, funds and matched transfers', () => {
  const zIn = ln('Z', '2024-02-01', 600_000, 'outside_in');
  const zOut = ln('Z', '2024-02-03', -400_000, 'spent');
  const lines = [zIn, zOut];
  const base = {
    lines,
    assets: [acct('Z')],
    deposits: [],
    openings: new Map([['Z', 200_000]]),
    pairDays: 3,
  };

  it('takes the latest money first, or a share of everything in the account', () => {
    const recent = moneyChain({ ...base, method: 'recent' });
    expect(recent.nodes.get(zOut.id)!.from.map((l) => [l.node, l.amount])).toEqual([
      [zIn.id, 400_000],
    ]);
    const mix = moneyChain({ ...base, method: 'mix' });
    expect(mix.nodes.get(zOut.id)!.from.map((l) => [l.node, Math.round(l.amount)])).toEqual([
      ['open:Z', 100_000],
      [zIn.id, 300_000],
    ]);
    expect(endPoints(recent, zIn.id).map((e) => [e.kind, e.amount])).toEqual([
      ['spent', 400_000],
      ['still', 200_000],
    ]);
  });

  it('a fund pays back what bought it, and the rest is its gain', () => {
    const buy = ln('Z', '2024-02-05', -100_000, 'fund_buy', 'MF1');
    const sell = ln('Z', '2025-03-01', 130_000, 'fund_sell', 'MF1');
    const c = moneyChain({
      ...base,
      lines: [...lines, buy, sell],
      assets: [acct('Z'), { id: 'MF1', ownerId: 'R', kind: 'fund' }],
      method: 'recent',
    });
    const t = traceBack(c, sell.id, OPTS)!;
    expect(t.steps.map((s) => [s.node.id, s.amount, s.via])).toEqual([[buy.id, 100_000, 'MF1']]);
    expect(t.starts).toEqual([expect.objectContaining({ kind: 'fund_gain', amount: 30_000 })]);
  });

  it('matches a transfer the rules could not name by amount and date, and says it was matched', () => {
    const out = ln('Z', '2024-02-10', -50_000, 'ask_out');
    const inn = ln('Y', '2024-02-11', 50_000, 'ask_in');
    const c = moneyChain({
      ...base,
      lines: [...lines, out, inn],
      assets: [acct('Z'), acct('Y', 'G')],
      method: 'recent',
    });
    expect(c.guessed.transfers).toBe(1);
    const t = traceBack(c, inn.id, OPTS)!;
    expect(t.pair!.id).toBe(out.id);
    expect(t.pairBasis).toBe('guess');
  });

  it('folds parts below the smallest amount and stops at the most steps', () => {
    const tiny = ln('Z', '2024-02-02', 500, 'interest');
    const c = moneyChain({ ...base, lines: [zIn, tiny, zOut], method: 'mix' });
    const t = traceBack(c, zOut.id, { smallest: 1_000, depth: 40, budget: 400 })!;
    expect(t.small).toBeGreaterThan(0);
    expect(t.steps.every((s) => s.amount >= 1_000)).toBe(true);
    const cut = traceBack(c, zOut.id, { smallest: 1, depth: 0, budget: 400 })!;
    expect(cut.cut).toBe(true);
    expect(cut.steps).toHaveLength(0);
  });
});

describe('money chain: longer transfers and deposits paid back into another account', () => {
  it('pairs a transfer whose line in came later than usual, and marks it as matched', () => {
    const out = ln('Z', '2024-04-01', -70_000, 'own_transfer', 'Y');
    const late = ln('Y', '2024-04-07', 70_000, 'ask_in');
    const c = moneyChain({
      lines: [ln('Z', '2024-03-01', 100_000, 'outside_in'), out, late],
      assets: [acct('Z'), acct('Y')],
      deposits: [],
      openings: new Map(),
      method: 'recent',
      pairDays: 3,
    });
    expect(c.guessed.transfers).toBe(1);
    expect(traceBack(c, late.id, OPTS)!.pair!.id).toBe(out.id);
  });

  it('a deposit not on file, booked from one account and paid back into another of the same person at the same bank', () => {
    const fund = ln('Z', '2023-01-01', 500_000, 'outside_in');
    const book = ln('Z', '2023-01-02', -500_000, 'fd_funding');
    const back = ln('Z2', '2024-01-02', 535_000, 'fd_proceeds');
    const c = moneyChain({
      lines: [fund, book, back],
      assets: [acct('Z'), acct('Z2')],
      deposits: [],
      openings: new Map(),
      method: 'recent',
      pairDays: 3,
      bankOf: new Map([
        ['Z', 'RBL Bank'],
        ['Z2', 'RBL Bank Ltd'],
      ]),
    });
    const t = traceBack(c, back.id, OPTS)!;
    expect(t.steps.map((s) => [s.node.id, s.amount, s.via])).toEqual([
      [book.id, 500_000, 'held:Z'],
    ]);
    expect(t.starts).toEqual([
      expect.objectContaining({ kind: 'deposit_interest', amount: 35_000 }),
    ]);
  });
});

describe('money chain: money in accounts with no statement on file', () => {
  // Z has statements; E (ESAF) has none. ₹3L goes Z → E, a ₹3L ESAF deposit is booked two days later; it ends unpaid by any line,
  // and ₹3.2L comes back from E into Z later
  const inZ = ln('Z', '2023-01-01', 500_000, 'outside_in');
  const toE = ln('Z', '2023-01-05', -300_000, 'own_transfer', 'E');
  const back = ln('Z', '2024-02-01', 320_000, 'own_transfer', 'E');
  const chain = moneyChain({
    lines: [inZ, toE, back],
    assets: [acct('Z'), acct('E'), { id: 'FDE', ownerId: 'R', kind: 'deposit' }],
    deposits: [
      dep({
        assetId: 'FDE',
        bank: 'ESAF',
        principal: 300_000,
        bookedOn: '2023-01-07',
        maturityOn: '2024-01-07',
        maturityAmount: 320_000,
      }),
    ],
    openings: new Map(),
    method: 'recent',
    pairDays: 3,
  });

  it('books the deposit from the money sent to the account with no statement', () => {
    const src = holdingSources(chain, 'FDE');
    expect(src.map((l) => l.node)).toEqual(['before:FDE']);
    const t = traceBack(chain, 'before:FDE', OPTS)!;
    expect(t.steps.map((s) => [s.node.id, s.amount, s.via, s.basis])).toEqual([
      [toE.id, 300_000, 'away:R', 'guess'],
    ]);
    expect(chain.guessed.fromOutside).toBeGreaterThanOrEqual(1);
  });

  it('pays the ended deposit back outside the statements, and the money coming back into Z is that money', () => {
    expect(chain.guessed.paidOutside).toBe(1);
    const t = traceBack(chain, back.id, OPTS)!;
    expect(flat(t).map((s) => s.node.id)).toEqual([
      back.id,
      'payback:FDE',
      'before:FDE',
      toE.id,
      inZ.id,
    ]);
    expect(startPoints(chain, back.id).map((p) => [p.kind, Math.round(p.amount)])).toEqual([
      ['outside', 300_000],
      ['deposit_interest', 20_000],
    ]);
    expect(chain.outside.get('R') ?? []).toEqual([]);
  });
});

describe('money chain: a pay-back of two deposits on file in one line', () => {
  it('finds the deposits that end then and adds up to the amount with interest', () => {
    const inZ = ln('Z', '2023-01-01', 500_000, 'outside_in');
    const b1 = ln('Z', '2023-01-02', -200_000, 'fd_funding', 'D1');
    const b2 = ln('Z', '2023-01-02', -300_000, 'fd_funding', 'D2');
    const back = ln('Z', '2024-01-04', 535_000, 'fd_proceeds', null, 'TD PROCEEDS');
    const c = moneyChain({
      lines: [inZ, b1, b2, back],
      assets: [
        acct('Z'),
        { id: 'D1', ownerId: 'R', kind: 'deposit' },
        { id: 'D2', ownerId: 'R', kind: 'deposit' },
      ],
      deposits: [
        dep({
          assetId: 'D1',
          principal: 200_000,
          bookedOn: '2023-01-02',
          maturityOn: '2024-01-02',
        }),
        dep({
          assetId: 'D2',
          principal: 300_000,
          bookedOn: '2023-01-02',
          maturityOn: '2024-01-02',
        }),
      ],
      openings: new Map(),
      method: 'recent',
      pairDays: 3,
    });
    const t = traceBack(c, back.id, OPTS)!;
    expect(t.steps.map((s) => [s.node.id, s.amount, s.via]).sort()).toEqual([
      [b1.id, 200_000, 'D1'],
      [b2.id, 300_000, 'D2'],
    ]);
    expect(t.starts).toEqual([
      expect.objectContaining({ kind: 'deposit_interest', amount: 35_000 }),
    ]);
  });
});

describe('money chain: the whole trail at once', () => {
  it('says how much of today’s money is traced to a real start, and lists every step for a download', () => {
    const remit = ln('C', '2024-03-01', 1_000_000, 'own_transfer', 'SG', 'Wise');
    const out = ln('C', '2024-03-02', -400_000, 'ask_out');
    const zIn = ln('Z', '2024-03-05', 300_000, 'ask_in');
    const c = moneyChain({
      lines: [remit, out, zIn],
      assets: [acct('C'), acct('Z'), { id: 'SG', ownerId: 'R', kind: 'account', abroad: true }],
      deposits: [],
      openings: new Map(),
      method: 'recent',
      pairDays: 3,
      remittanceOf: new Map([[remit.id, 'W1']]),
    });
    const cov = chainCoverage(c, () => 'account');
    // ₹6L from Singapore is still in C; ₹3L came into Z from nowhere the statements show
    expect(Math.round(cov.total)).toBe(900_000);
    expect(cov.traced).toBeCloseTo(600_000 / 900_000, 6);
    const [steps, starts, ends] = chainTables(c, (id) => id ?? '');
    // the ₹4L out of C is made of the Wise money that came in the day before
    expect(steps!.rows.map((r) => [r.from, r.to, r.amount, r.how])).toEqual([
      ['C', 'C', 400_000, 'in the same account'],
    ]);
    expect(starts!.rows.map((r) => [r.kind, r.amount])).toEqual([
      ['From Singapore (Wise or DBS)', 1_000_000],
      ['Not explained by the statements', 300_000],
    ]);
    expect(ends!.rows.map((r) => [r.kind, r.amount])).toEqual([
      ['Still there', 600_000],
      ['Not answered yet (Explain movements)', 400_000],
      ['Still there', 300_000],
    ]);
  });
});

describe('money chain: a deposit on file that the bank booked and paid back in pieces', () => {
  it('matches five booking lines of one day and three pay-back lines of one day to the one deposit', () => {
    const inZ = ln('Z', '2020-07-20', 1_000_000, 'outside_in');
    const books = [1, 2, 3, 4, 5].map(() =>
      ln('Z', '2020-07-26', -100_000, 'fd_funding', null, 'FD BOOKING'),
    );
    const backs = [1, 2, 3].map((i) =>
      ln('Z', '2021-07-26', i === 3 ? 220_000 : 165_000, 'fd_proceeds', null, 'CLOSURE PROCEEDS'),
    );
    const c = moneyChain({
      lines: [inZ, ...books, ...backs],
      assets: [acct('Z'), { id: 'FDR', ownerId: 'R', kind: 'deposit' }],
      deposits: [
        dep({
          assetId: 'FDR',
          principal: 500_000,
          bookedOn: '2020-07-26',
          maturityOn: '2021-07-26',
        }),
      ],
      openings: new Map(),
      method: 'recent',
      pairDays: 3,
    });
    expect(holdingSources(c, 'FDR').map((l) => l.amount)).toEqual([
      100_000, 100_000, 100_000, 100_000, 100_000,
    ]);
    // ₹5.5L back in three lines: each takes its share of the ₹5L and the rest is interest
    const total = backs.reduce((s, b) => s + b.amount, 0);
    for (const b of backs) {
      const t = traceBack(c, b.id, OPTS)!;
      const principal = t.steps.reduce((s, x) => s + x.amount, 0);
      expect(principal).toBeCloseTo((500_000 * b.amount) / total, 4);
      expect(t.steps.every((x) => x.via === 'FDR')).toBe(true);
    }
    expect(c.guessed.paidOutside).toBe(0);
  });
});
