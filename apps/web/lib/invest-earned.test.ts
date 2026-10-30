import { describe, expect, it } from 'vitest';
import { DEFAULT_HOME_RANGE, fundsEarnedThisFy } from '@fwos/core';
import { demoHomeInput } from './demo-home';
import { buildHome } from './home';

describe('Earned this FY: Investments shows the figure Home splits out for funds', () => {
  it('is the same rupees as Home’s "Earned this FY · funds" for the same position', () => {
    const input = demoHomeInput(DEFAULT_HOME_RANGE);
    const home = buildHome(input);
    const invest = fundsEarnedThisFy(
      input.position,
      input.config.capital.openingDate || null,
      input.config.harvest.reinvestDays,
    );
    expect(home.extras.earnedFy).not.toBeNull();
    expect(invest).not.toBeNull();
    expect(Math.round(invest!)).toBe(Math.round(home.extras.earnedFy!.funds));
  });
});
