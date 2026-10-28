import { describe, expect, it } from 'vitest';
import { moneyTrail, type TrailLine } from '../src/money-trail';

// Invented: Asha's accounts A and B, Vikram's account V, a deposit D booked from B, a Singapore account SG (no statement).
const assets = [
  { id: 'A', ownerId: 'asha', kind: 'account' as const },
  { id: 'B', ownerId: 'asha', kind: 'account' as const },
  { id: 'V', ownerId: 'vikram', kind: 'account' as const },
  { id: 'D', ownerId: 'vikram', kind: 'deposit' as const, principal: 300_000 },
];
let n = 0;
const ln = (
  assetId: string,
  date: string,
  amount: number,
  cls: TrailLine['cls'],
  counterpart: string | null = null,
): TrailLine => ({
  id: `l${++n}`,
  assetId,
  date,
  amount,
  cls,
  counterpart,
  narration: '',
});

describe('the money trail', () => {
  const lines = [
    ln('A', '2024-01-02', 1_000_000, 'own_transfer', 'SG'), // Wise from Singapore
    ln('A', '2024-01-05', -400_000, 'own_transfer', 'B'),
    ln('B', '2024-01-05', 400_000, 'own_transfer', 'A'),
    ln('B', '2024-03-31', 2_000, 'interest'),
    ln('B', '2024-04-01', -300_000, 'own_transfer', 'V'), // Asha's money to Vikram
    ln('V', '2024-04-01', 300_000, 'own_transfer', 'B'),
    ln('V', '2024-04-02', -300_000, 'fd_funding', 'D'),
    ln('V', '2025-04-02', 321_000, 'fd_proceeds', 'D'),
  ];
  const trails = moneyTrail({ lines, assets, openings: new Map([['B', 98_000]]) });

  it('follows money from Singapore through several hops into a deposit', () => {
    const d = trails.get('D')!;
    expect(d.hops[0]!.from).toBe('V');
    // B held 98,000 from before its records, 400,000 from Singapore (via A) and 2,000 interest; 300,000 left in that mix
    const sg = d.parts.filter((p) => p.kind === 'singapore').reduce((s, p) => s + p.amount, 0);
    expect(sg).toBeCloseTo((300_000 * 400_000) / 500_000, 2);
  });

  it('keeps whose money it was, and lists the crossing from one person to the other', () => {
    const v = trails.get('V')!;
    expect(v.crossings.reduce((s, c) => s + c.amount, 0)).toBeCloseTo(300_000, 2);
    expect(v.crossings.every((c) => c.fromPerson === 'asha' && c.toPerson === 'vikram')).toBe(true);
    // the deposit paid back: the principal with its make-up, the rest the deposit's interest, Vikram's
    const back = v.hops.find((h) => h.cls === 'fd_proceeds')!;
    expect(back.parts.find((p) => p.kind === 'deposit_interest')).toMatchObject({
      amount: 21_000,
      person: 'vikram',
    });
  });

  it('what is left in an account adds up to its balance', () => {
    const a = trails.get('A')!;
    expect(a.parts.reduce((s, p) => s + p.amount, 0)).toBeCloseTo(600_000, 2);
  });

  it('a deposit not on file, booked and paid back in one account, keeps where its money came from', () => {
    const t = moneyTrail({
      lines: [
        ln('A', '2024-01-02', 500_000, 'own_transfer', 'SG'),
        ln('A', '2024-01-03', -500_000, 'fd_funding'),
        ln('A', '2025-01-03', 535_000, 'fd_proceeds'),
      ],
      assets,
      openings: new Map(),
    }).get('A')!;
    expect(t.parts.find((p) => p.kind === 'singapore')!.amount).toBeCloseTo(500_000, 2);
    expect(t.parts.find((p) => p.kind === 'deposit_interest')!.amount).toBeCloseTo(35_000, 2);
  });

  it('treats money from a Singapore account on file as money from Singapore, not a crossing', () => {
    const t = moneyTrail({
      lines: [ln('A', '2024-01-02', 500_000, 'own_transfer', 'SGJ')],
      assets: [...assets, { id: 'SGJ', ownerId: 'vikram', kind: 'account', abroad: true }],
      openings: new Map(),
    });
    const a = t.get('A')!;
    expect(a.parts).toEqual([
      expect.objectContaining({ kind: 'singapore', person: 'asha', amount: 500_000 }),
    ]);
    expect(a.crossings).toEqual([]);
    expect(t.has('SGJ')).toBe(false);
  });

  describe('ownership and clubbing', () => {
    // Asha sends Vikram 200,000; Vikram's account earns 3,000 interest on 400,000; he buys a fund with 100,000 and sells it for 120,000
    const run = (ownershipFrom: string) =>
      moneyTrail({
        lines: [
          ln('V', '2024-01-01', 200_000, 'interest'), // invented: his own money, read as interest for simplicity
          ln('A', '2024-02-01', -200_000, 'own_transfer', 'V'),
          ln('V', '2024-02-01', 200_000, 'own_transfer', 'A'),
          ln('V', '2024-03-31', 3_000, 'interest'),
          ln('V', '2024-04-02', -100_000, 'fund_buy', 'F'),
          ln('V', '2025-04-02', 120_000, 'fund_sell', 'F'),
        ],
        assets: [...assets, { id: 'F', ownerId: 'vikram', kind: 'fund' }],
        openings: new Map(),
        ownershipFrom,
      });

    it('before the day ownership counts from, money that changes hands is the receiver’s', () => {
      const t = run('2026-10-28');
      const v = t.get('V')!;
      expect(v.crossings).toHaveLength(1);
      expect(v.clubbed).toEqual([]);
      expect(v.parts.every((p) => p.person === 'vikram')).toBe(true);
    });

    it('from that day, the giver keeps the money and the income on it counts in her hands', () => {
      const t = run('2024-01-01');
      const v = t.get('V')!;
      // half of Vikram's 400,000 was Asha's when the interest was paid
      expect(v.clubbed).toEqual([
        expect.objectContaining({ kind: 'interest', person: 'asha', holder: 'vikram' }),
      ]);
      expect(v.clubbed[0]!.amount).toBeCloseTo(1_500, 2);
      // the fund was bought with the account's mix, so about half of its sale was made from Asha's money
      const f = t.get('F')!;
      expect(f.clubbed[0]).toMatchObject({ kind: 'fund_sale', person: 'asha', of: 120_000 });
      expect(f.clubbed[0]!.amount).toBeCloseTo((120_000 * 200_000) / 403_000, 0);
      // what the sale brought above the money that bought it is the fund's gain
      const back = v.hops.find((h) => h.cls === 'fund_sell')!;
      expect(back.parts.find((p) => p.kind === 'fund_gain')!.amount).toBeCloseTo(20_000, 2);
    });
  });
});
