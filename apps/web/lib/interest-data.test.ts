import { describe, expect, it } from 'vitest';
import { reportedInterestOf } from './interest-data';

describe('the interest a stored tax statement reports', () => {
  it('takes the AIS interest lines and leaves the rest', () => {
    const r = reportedInterestOf({
      owner_id: 'o',
      fy: '2025-26',
      kind: 'ais',
      parsed: {
        lines: [
          { category: 'interest_savings', source: 'Sample Bank', amount: 1200 },
          { category: 'interest_deposit', source: 'Sample Bank', amount: 8800 },
          { category: 'dividend', source: 'Sample Fund', amount: 500 },
        ],
      },
    });
    expect(r.lines).toEqual([
      { source: 'Sample Bank', amount: 1200 },
      { source: 'Sample Bank', amount: 8800 },
    ]);
  });

  it('takes the Form 26AS amounts paid under the interest sections only', () => {
    const r = reportedInterestOf({
      owner_id: 'o',
      fy: '2025-26',
      kind: '26as',
      parsed: {
        deductors: [
          {
            name: 'Sample Bank',
            txns: [
              { section: '194A', paid: 4000 },
              { section: '195', paid: 1000 },
              { section: '194', paid: 700 },
            ],
          },
          { name: 'Employer', txns: [{ section: '192', paid: 90000 }] },
        ],
      },
    });
    expect(r.lines).toEqual([{ source: 'Sample Bank', amount: 5000 }]);
  });
});
