/**
 * Acceptance test 14 (global consistency): the same records give the same figures everywhere. One sample household is valued once and
 * every surface that shows a figure is checked against the central engine: Home's net worth, the capital ledger and the movement panel,
 * the four kind cards, the fund views, the deposits and cash pages' overviews, and the daily e-mail.
 */
import { describe, expect, it } from 'vitest';
import { positionAsOf } from '@fwos/core';
import { demoDigestInput } from './demo-digest';
import { demoHomeInput } from './demo-home';
import { buildHome } from './home';

describe('global consistency (acceptance test 14)', () => {
  const input = demoHomeInput('1Y');
  const home = buildHome(input);
  const engine = positionAsOf(input.position, input.today);
  const c = home.capital;

  it('net worth is one number: the portfolio, the engine’s day, the ledger and the movement since the start', () => {
    expect(home.total).toBeCloseTo(input.portfolio.netWorth.total, 2);
    expect(engine.total).toBeCloseTo(home.total, 0);
    expect(c.totals.netWorth).toBeCloseTo(home.total, 0);
    expect(c.totals.ownMoney + c.totals.profit).toBeCloseTo(c.totals.netWorth, 4);
  });

  it('the four kind cards add up to net worth, and the funds card is the fund views’ estimated value', () => {
    expect(home.classes.reduce((a, k) => a + k.current, 0)).toBeCloseTo(home.total, 2);
    const funds = home.classes.find((k) => k.key === 'funds')!;
    expect(c.funds.estimated).toBeCloseTo(funds.current, 0);
    expect(c.funds.estimated).toBeCloseTo(engine.byClass.funds, 0);
  });

  it('the deposits card is the engine’s deposits, maturity proceeds awaiting confirmation included once', () => {
    const fd = home.classes.find((k) => k.key === 'fd')!;
    expect(fd.current).toBeCloseTo(engine.byClass.fd, 0);
  });

  it('every period of the movement panel adds up: start + outside money + not explained + earned = end', () => {
    for (const key of ['month', '3m', '6m', 'fy', '12m', 'all'] as const) {
      const m = buildHome({ ...input, movement: { key } }).capital.movement;
      const f = m.figures!;
      expect(
        f.start + f.confirmedExternal + f.unexplained + f.corrections + f.earnings.total,
      ).toBeCloseTo(f.end, 2);
    }
  });

  it('the daily e-mail carries Home’s net worth and kind cards', () => {
    const d = demoDigestInput();
    expect(d.wealth!.total).toBeCloseTo(home.total, 2);
    for (const k of d.wealth!.classes) {
      const h = home.classes.find((x) => x.label === k.label);
      if (h) expect(k.current).toBeCloseTo(h.current, 2);
    }
  });
});
