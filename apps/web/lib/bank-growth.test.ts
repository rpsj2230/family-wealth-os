import { describe, expect, it } from 'vitest';
import { DEFAULT_HOME_RANGE, bankOverview, DEFAULT_CONFIG } from '@fwos/core';
import { demoBankGrowth } from './bank-growth-data';
import { demoModel, DEMO_TODAY } from './demo-fixture';
import { demoHomeInput } from './demo-home';
import { buildHome } from './home';

describe('Accounts and Home agree on how the money in banks grows (sample household)', () => {
  const home = buildHome(demoHomeInput(DEFAULT_HOME_RANGE));
  const { blocks, fx } = demoModel();
  const o = bankOverview(blocks, {
    today: DEMO_TODAY,
    soonDays: DEFAULT_CONFIG.reminders.maturitySoonDays,
    defaultSavingsRate: DEFAULT_CONFIG.estimates.savingsRate,
    tdsRate: DEFAULT_CONFIG.estimates.interestTdsRate,
    fx,
  });
  const g = demoBankGrowth({
    owner: null,
    rows: blocks.flatMap((b) => b.sections.flatMap((s) => s.rows)),
    fdNow: o.parts.fd.current,
    cashNow: o.parts.cash.current,
  });

  it('the deposits’ XIRR is the same on both pages', () => {
    expect(g.fd!.rate).toBeCloseTo(home.growth.fd!, 10);
  });

  it('the savings rate earned and the interest this FY are the same on both pages', () => {
    expect(g.interestFy!.savings).toBeCloseTo(home.extras.earnedFy!.savings, 2);
    expect(g.interestFy!.deposits).toBeCloseTo(home.extras.earnedFy!.deposits, 2);
    expect(g.savings!.rate).toBeCloseTo(home.growth.savings!.rate, 8);
  });
});
