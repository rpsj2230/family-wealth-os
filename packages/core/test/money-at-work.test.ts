import { describe, expect, it } from 'vitest';
import {
  workBucketOf,
  moneyAtWork,
  moveFromSuggestion,
  projectGrowth,
  type WorkHoldingIn,
} from '../src/money-at-work';

const h = (
  o: Partial<WorkHoldingIn> & Pick<WorkHoldingIn, 'id' | 'kind' | 'value' | 'rate'>,
): WorkHoldingIn => ({
  name: o.id,
  ownerId: 'r',
  owner: 'Rupash',
  type: 'Savings',
  bank: 'Bank',
  rateBasis: 'test',
  taxRate: 0,
  monthly: 0,
  ...o,
});

const holdings = [
  h({ id: 'nro', kind: 'cash', value: 1_000_000, rate: 0.03, taxRate: 0.3, type: 'Savings' }),
  h({ id: 'fd', kind: 'fd', value: 2_000_000, rate: 0.075, type: 'Fixed deposit' }),
  h({
    id: 'mf',
    kind: 'funds',
    value: 1_000_000,
    rate: 0.12,
    monthly: 10_000,
    type: 'Mutual fund',
  }),
  h({ id: 'lent', kind: 'others', value: 200_000, rate: 0, type: 'Money lent' }),
];

describe('moneyAtWork: which money grows, and how fast', () => {
  const w = moneyAtWork({ holdings, inflation: 0.06, goodMargin: 0.03, moves: [] });

  it('groups against inflation after tax: nothing, slow, growing, growing well', () => {
    expect(workBucketOf(0, 0.06, 0.03)).toBe('idle');
    expect(Object.fromEntries(w.rows.map((r) => [r.id, r.bucket]))).toEqual({
      lent: 'idle',
      nro: 'slow', // 3% less 30% tax = 2.1%
      fd: 'growing', // 7.5%: above 6%, below 9%
      mf: 'good',
    });
    expect(w.rows.map((r) => r.id)).toEqual(['lent', 'nro', 'fd', 'mf']);
  });

  it('the pace of the whole and what slow money loses to prices each year', () => {
    expect(w.paceNet).toBeCloseTo(
      (1_000_000 * 0.021 + 2_000_000 * 0.075 + 1_000_000 * 0.12) / 4_200_000,
      10,
    );
    expect(Math.round(w.lostToInflation)).toBe(
      Math.round(1_000_000 * (0.06 - 0.021) + 200_000 * 0.06),
    );
    expect(w.buckets.slow).toEqual({ value: 1_000_000, count: 1 });
  });

  it('says what to do with money that earns nothing', () => {
    expect(w.notes.find((n) => n.holdingId === 'lent')!.text).toContain('Agree a date');
  });
});

describe('projectGrowth: the corpus year by year', () => {
  const move = moveFromSuggestion({
    assetId: 'nro',
    ownerName: 'Rupash',
    from: 'HDFC',
    to: 'RBL',
    product: 'savings',
    toProduct: 'fd',
    amount: 900_000,
    currentRate: 0.021,
    newRate: 0.0525,
    annualGain: 900_000 * (0.0525 - 0.021),
    when: 'now',
    on: null,
  });
  const w = moneyAtWork({ holdings, inflation: 0.06, goodMargin: 0.03, moves: [move] });
  const p = projectGrowth({
    work: w,
    years: 20,
    steps: [0.01, 0.02],
    stepUp: 0.05,
    today: '2026-10-29',
    dobs: ['1985-06-01', null],
  });
  const line = (k: string) => p.lines.find((l) => l.key === k)!;

  it('six lines: the same pace, 2% and 1% slower, 1% and 2% faster, and the slow money moved', () => {
    expect(p.lines.map((l) => l.key)).toEqual([
      'same',
      'slower-0.02',
      'slower-0.01',
      'faster-0.01',
      'faster-0.02',
      'moved',
    ]);
    for (const l of p.lines) expect(l.values).toHaveLength(21);
    expect(line('slower-0.02').values[20]!).toBeLessThan(line('slower-0.01').values[20]!);
    expect(line('slower-0.01').values[20]!).toBeLessThan(line('same').values[20]!);
    expect(line('same').values[20]!).toBeLessThan(line('faster-0.01').values[20]!);
    expect(line('faster-0.01').values[20]!).toBeLessThan(line('faster-0.02').values[20]!);
    expect(line('moved').values[20]!).toBeGreaterThan(line('same').values[20]!);
  });

  it('compounds each holding at its own rate after tax, with SIPs going in through the year', () => {
    // year 1: NRO 10L × 2.1%, FD 20L × 7.5%, fund 10L × 12% + ₹1.2L of SIPs with half a year's growth, money lent stays
    const y1 =
      1_000_000 * 1.021 + 2_000_000 * 1.075 + (1_000_000 * 1.12 + 120_000 * 1.06) + 200_000;
    expect(line('same').values[1]).toBeCloseTo(y1, 4);
    expect(p.table[1]!.added).toBe(120_000);
    // the SIP is raised by the step-up each year
    expect(p.table[2]!.added).toBeCloseTo(126_000, 6);
  });

  it('money that earns nothing stays at nothing on the faster line', () => {
    const only = moneyAtWork({
      holdings: [holdings[3]!],
      inflation: 0.06,
      goodMargin: 0.03,
      moves: [],
    });
    const q = projectGrowth({
      work: only,
      years: 5,
      steps: [0.02],
      stepUp: 0,
      today: '2026-10-29',
      dobs: [],
    });
    expect(q.lines.find((l) => l.key === 'faster-0.02')!.values[5]).toBe(200_000);
  });

  it('shows the pace of each line, today’s rupees and the ages', () => {
    expect(line('faster-0.01').pace).toBeGreaterThan(line('same').pace);
    expect(p.table[10]!.real).toBeCloseTo(line('same').values[10]! / Math.pow(1.06, 10), 4);
    expect(p.table[0]!.ages).toEqual([41, null]);
    expect(p.table[20]!.calendarYear).toBe(2046);
    expect(move.text).toContain('to a deposit at RBL');
  });
});
