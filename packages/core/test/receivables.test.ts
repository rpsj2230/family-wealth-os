import { describe, expect, it } from 'vitest';
import { receivableStatus } from '../src/receivables';

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe('receivableStatus', () => {
  it('Somesh: ₹2,00,000 lent, nothing received, expected 4 Jul 2026 -> overdue', () => {
    const r = receivableStatus(
      { id: 's', lent: 200_000, repayments: [], expectedOn: d('2026-07-04') },
      d('2026-10-26'),
    );
    expect(r).toEqual({ outstanding: 200_000, repaid: 0, status: 'overdue', daysOverdue: 114 });
  });
  it('Ravinder: 50,000 lent, 43,000 returned -> 7,000 outstanding', () => {
    const r = receivableStatus(
      { id: 'r', lent: 50_000, repayments: [{ amount: 43_000, on: d('2024-09-01') }] },
      d('2026-10-26'),
    );
    expect(r.outstanding).toBe(7_000);
    expect(r.status).toBe('outstanding');
  });
  it('settled and overpaid', () => {
    expect(
      receivableStatus(
        { id: 'x', lent: 100, repayments: [{ amount: 100, on: d('2026-01-01') }] },
        d('2026-10-26'),
      ).status,
    ).toBe('settled');
    expect(
      receivableStatus(
        { id: 'x', lent: 100, repayments: [{ amount: 150, on: d('2026-01-01') }] },
        d('2026-10-26'),
      ).status,
    ).toBe('overpaid');
  });
  it('rejects nonsense', () => {
    expect(() => receivableStatus({ id: 'x', lent: 0, repayments: [] }, d('2026-10-26'))).toThrow();
    expect(() =>
      receivableStatus(
        { id: 'x', lent: 10, repayments: [{ amount: 0, on: d('2026-01-01') }] },
        d('2026-10-26'),
      ),
    ).toThrow();
  });
});
