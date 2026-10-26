import { describe, expect, it } from 'vitest';
import { demoHomeInput } from './demo-home';
import { buildHome } from './home';

const model = (range: Parameters<typeof demoHomeInput>[0] = '1Y') =>
  buildHome(demoHomeInput(range));

describe('Home model for the sample household', () => {
  const h = model();
  const input = demoHomeInput('1Y');
  const nw = input.portfolio.netWorth;

  it('every way of cutting the total adds up to the same total', () => {
    expect(h.total).toBe(nw.total);
    expect(h.allocation.reduce((a, x) => a + x.amount, 0)).toBeCloseTo(nw.total, 2);
    expect(h.byPerson.reduce((a, x) => a + x.amount, 0)).toBeCloseTo(nw.total, 2);
    expect(h.trust.total).toBeCloseTo(nw.total, 2);
    expect(h.trust.confirmed + h.trust.calculated + h.trust.unconfirmed).toBeCloseTo(nw.total, 2);
    expect(h.trend.all[h.trend.all.length - 1]!.value).toBe(nw.total);
  });

  it('the bank, deposit and fund figures are the ones their own pages show', () => {
    const banks = h.banks.overview;
    // a deposit past its date that is still listed as running is in net worth but waits for confirmation in the bank figures
    expect(banks.current + h.banks.maturedCounted).toBeCloseTo(
      (nw.byType.bank_account ?? 0) +
        (nw.byType.fixed_deposit ?? 0) +
        (nw.byType.third_party_held ?? 0),
      2,
    );
    expect(h.banks.maturedCounted).toBeGreaterThan(0);
    expect(h.deposits.overview.current).toBeCloseTo(banks.parts.fd.current, 2);
    expect(h.deposits.overview.deposits).toBe(banks.deposits);
    expect(h.funds!.totals.value).toBeCloseTo(nw.byType.mutual_fund ?? 0, 2);
    expect(h.deposits.banks.reduce((a, b) => a + b.current, 0)).toBeCloseTo(
      h.deposits.overview.current,
      2,
    );
  });

  it('today’s change is what the banks earned plus what the funds moved', () => {
    expect(h.change.today.amount).toBeCloseTo(
      h.banks.overview.today.change + (input.inv!.household.dayAmount ?? 0),
      6,
    );
    expect(h.change.today.banks).toBe(h.banks.overview.today.change);
  });

  it('what needs attention agrees with the counts the other pages show', () => {
    const confirm = h.attention.find((x) => x.key === 'confirm');
    expect(confirm?.count ?? 0).toBe(h.banks.overview.toConfirm);
    const cover = h.attention.find((x) => x.key === 'cover');
    expect(cover?.count ?? 0).toBe(h.deposits.cover.banksOver);
    expect(h.deposits.cover.uninsured).toBe(input.cover.uninsured);
    const order = ['bad', 'warn', 'info'];
    const tones = h.attention.map((x) => order.indexOf(x.tone));
    expect(tones).toEqual([...tones].sort((a, b) => a - b));
  });

  it('the liquidity ladder and the quick-raise figures only grow with time', () => {
    const cum = h.liquidity.ladder.map((s) => s.cumulative);
    expect(cum).toEqual([...cum].sort((a, b) => a - b));
    const raise = h.liquidity.raise.map((r) => r.most);
    expect(raise).toEqual([...raise].sort((a, b) => a - b));
    for (const r of h.liquidity.raise) expect(r.free).toBeLessThanOrEqual(r.most);
    expect(h.liquidity.raise.map((r) => r.days)).toEqual(input.config.liquidity.scenarioDays);
    expect(h.liquidity.within30).toBeGreaterThanOrEqual(h.banks.overview.parts.cash.current);
    expect(h.liquidity.months).toBeCloseTo(h.liquidity.cashAndDeposits / 180_000, 6);
  });

  it('coming up is dated, soonest first, and inside the window from Settings', () => {
    const days = h.events.map((e) => e.daysLeft);
    expect(days).toEqual([...days].sort((a, b) => a - b));
    expect(h.events.length).toBeGreaterThan(0);
    expect(Math.max(...days)).toBeLessThanOrEqual(input.config.home.upcomingDays);
  });

  it('puts the money put in beside the growth for banks and funds', () => {
    const g = h.trend.growth;
    expect(g.invested).toBeCloseTo(h.banks.overview.invested + h.funds!.totals.invested, 2);
    expect(g.current).toBeCloseTo(h.banks.overview.current + h.funds!.totals.value, 2);
  });

  it('the range in the address changes the slice, not the total', () => {
    const month = model('1M');
    expect(month.trend.view.points.length).toBeLessThan(h.trend.view.points.length);
    expect(month.total).toBe(h.total);
    expect(model('ALL').trend.view.before).toBeNull();
  });

  it('reports what changed by kind and by person', () => {
    expect(h.whatChanged).not.toBeNull();
    const w = h.whatChanged!;
    expect(w.change).toBeCloseTo(h.total - h.trend.all.find((p) => p.date === w.since)!.value, 2);
    expect(w.kinds.length).toBeGreaterThan(0);
  });

  it('reads the risks with thresholds from Settings', () => {
    const bank = h.risks.find((r) => r.key === 'bank');
    expect(bank).toBeDefined();
    const strict = buildHome({
      ...input,
      config: { ...input.config, home: { ...input.config.home, bankShareWatch: 0.05 } },
    });
    expect(strict.risks.find((r) => r.key === 'bank')!.verdict).toBe('watch');
  });
});
