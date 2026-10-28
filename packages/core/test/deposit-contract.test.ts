import { describe, expect, it } from 'vitest';
import {
  contractOutOn,
  depositInterestBetween,
  depositOn,
  findProceedsEvidence,
  payoutSchedule,
  proceedsCountedOn,
  proceedsPlan,
  type DepositContract,
} from '../src/deposit-contract';
import { fdValueOn } from '../src/fd';

const cumulative: DepositContract = {
  principal: 1_000_000,
  rate: 0.07,
  bookedOn: '2025-04-01',
  maturityOn: '2026-04-01',
  compounding: 'quarterly',
  payout: 'cumulative',
};

describe('depositOn: cumulative', () => {
  it('accrues on the contract, holds principal plus accrued, and stops at maturity', () => {
    const mid = depositOn(cumulative, '2025-10-01');
    const want = fdValueOn({
      principal: 1_000_000,
      annualRate: 0.07,
      bookedOn: new Date('2025-04-01T00:00:00Z'),
      asOf: new Date('2025-10-01T00:00:00Z'),
      compounding: 'quarterly',
    });
    expect(mid.state).toBe('running');
    expect(mid.held).toBeCloseTo(want, 6);
    expect(mid.accrued).toBeCloseTo(want - 1_000_000, 6);
    expect(mid.paidOut).toBe(0);
    const onMaturity = depositOn(cumulative, '2026-04-01');
    expect(onMaturity.state).toBe('running');
    expect(onMaturity.held).toBeCloseTo(onMaturity.maturityValue, 6);
    const after = depositOn(cumulative, '2026-06-01');
    expect(after.state).toBe('matured');
    expect(after.held).toBe(0);
    expect(after.proceeds).toBeCloseTo(onMaturity.maturityValue, 6);
    // no accrual after maturity
    expect(depositInterestBetween(cumulative, '2026-04-02', '2026-10-01')).toBe(0);
    expect(after.earned).toBeCloseTo(after.termInterest, 6);
  });

  it('is nothing before it is booked', () => {
    expect(depositOn(cumulative, '2025-03-31')).toMatchObject({ state: 'not_yet', held: 0 });
  });

  it('closed early stops on the day it closed, with its value then as proceeds', () => {
    const c = { ...cumulative, endedOn: '2025-10-01' };
    const d = depositOn(c, '2025-12-01');
    expect(d.state).toBe('closed');
    expect(d.proceeds).toBeCloseTo(depositOn(cumulative, '2025-10-01').held, 6);
    expect(contractOutOn(c)).toBe('2025-10-01');
    expect(contractOutOn(cumulative)).toBe('2026-04-02');
  });
});

describe('depositOn: payout', () => {
  const q: DepositContract = { ...cumulative, payout: 'quarterly' };

  it('pays principal × rate ÷ 4 every quarter and holds only the running quarter', () => {
    const sched = payoutSchedule(q);
    expect(sched.map((p) => p.date)).toEqual([
      '2025-07-01',
      '2025-10-01',
      '2026-01-01',
      '2026-04-01',
    ]);
    for (const p of sched) expect(p.amount).toBeCloseTo(17_500, 6);
    const d = depositOn(q, '2025-11-16');
    expect(d.paidOut).toBeCloseTo(35_000, 6);
    // 46 of 92 days of the running quarter
    expect(d.accrued).toBeCloseTo(17_500 * (46 / 92), 6);
    expect(d.held).toBeCloseTo(1_000_000 + d.accrued, 6);
    expect(d.earned).toBeCloseTo(d.paidOut + d.accrued, 6);
  });

  it('never counts paid-out interest in the value (no double counting with the account it went to)', () => {
    const d = depositOn(q, '2026-03-31');
    expect(d.held).toBeLessThan(1_000_000 + 17_500 + 0.01);
    expect(d.paidOut).toBeCloseTo(52_500, 6);
  });

  it('pays the principal and the last quarter on maturity', () => {
    const d = depositOn(q, '2026-04-02');
    expect(d.state).toBe('matured');
    expect(d.proceeds).toBeCloseTo(1_017_500, 6);
    expect(d.maturityValue).toBeCloseTo(1_017_500, 6);
    expect(d.termInterest).toBeCloseTo(70_000, 6);
    expect(d.earned).toBeCloseTo(70_000, 6);
  });
});

describe('proceedsPlan (acceptance test 4: proceeds are never assigned automatically)', () => {
  const base = {
    status: 'active',
    outOn: '2026-10-02',
    amount: 1_070_000,
    today: '2026-10-28',
    hideAfterDays: 60,
    confirmed: [],
    evidence: {},
  };

  it('awaits confirmation and is counted once until you say where it went', () => {
    const p = proceedsPlan(base);
    expect(p.status).toBe('awaiting');
    expect(p.countedToday).toBe(1_070_000);
    expect(p.placedOn).toBeNull();
    expect(proceedsCountedOn(p, base.outOn, '2026-10-28')).toBe(true);
    expect(proceedsCountedOn(p, base.outOn, '2026-10-01')).toBe(false);
  });

  it('is confirmed once movements cover it, and stops being counted from that day', () => {
    const p = proceedsPlan({ ...base, confirmed: [{ on: '2026-10-05', amount: 1_070_000 }] });
    expect(p.status).toBe('confirmed');
    expect(p.placedOn).toBe('2026-10-05');
    expect(p.countedToday).toBe(0);
    expect(proceedsCountedOn(p, base.outOn, '2026-10-04')).toBe(true);
    expect(proceedsCountedOn(p, base.outOn, '2026-10-05')).toBe(false);
  });

  it('is "probably placed" (not counted twice) when a renewal or a later balance shows it', () => {
    const p = proceedsPlan({
      ...base,
      evidence: {
        renewal: { assetId: 'n', name: 'New FD', bookedOn: '2026-10-02', principal: 1_070_000 },
      },
    });
    expect(p.status).toBe('probably_placed');
    expect(p.countedToday).toBe(0);
    expect(p.note).toMatch(/confirm/i);
  });

  it('assumes old proceeds were placed and says so', () => {
    const p = proceedsPlan({ ...base, outOn: '2026-06-01' });
    expect(p.status).toBe('assumed_placed');
    expect(p.countedToday).toBe(0);
    expect(p.note).toMatch(/60 days/);
  });
});

describe('findProceedsEvidence', () => {
  const dep = {
    assetId: 'old',
    ownerId: 'r',
    institutionId: 'b1',
    linkedLast4: '1234',
    principal: 1_000_000,
  };
  it('finds a renewal at the same bank for about the proceeds', () => {
    const e = findProceedsEvidence({
      deposit: dep,
      outOn: '2026-10-02',
      amount: 1_070_000,
      deposits: [
        {
          assetId: 'x',
          ownerId: 'r',
          institutionId: 'b2',
          name: 'Other bank',
          bookedOn: '2026-10-02',
          principal: 1_070_000,
          renewedFrom: null,
        },
        {
          assetId: 'n',
          ownerId: 'r',
          institutionId: 'b1',
          name: 'New FD',
          bookedOn: '2026-10-03',
          principal: 1_070_000,
          renewedFrom: null,
        },
      ],
      accounts: [],
    });
    expect(e.renewal?.assetId).toBe('n');
  });
  it('finds a later balance of the linked account', () => {
    const e = findProceedsEvidence({
      deposit: dep,
      outOn: '2026-10-02',
      amount: 1_070_000,
      deposits: [],
      accounts: [
        {
          assetId: 's',
          ownerId: 'r',
          institutionId: 'b1',
          last4: '1234',
          name: 'Savings 1234',
          currency: 'INR',
          balanceDates: ['2026-09-30', '2026-10-15'],
        },
      ],
    });
    expect(e.laterBalance).toEqual({ assetId: 's', name: 'Savings 1234', date: '2026-10-15' });
  });
});
