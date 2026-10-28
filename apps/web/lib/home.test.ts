import { describe, expect, it } from 'vitest';
import { coverageWords, positionAsOf, sinceWords } from '@fwos/core';
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
    // each share is kept to the paisa, so the sum of them can differ from the whole by a few paise
    expect(h.allocation.reduce((a, x) => a + x.amount, 0)).toBeCloseTo(nw.total, 1);
    // each person’s total is kept to the paisa, so the four of them can differ from the whole by a few paise
    expect(h.byPerson.reduce((a, x) => a + x.amount, 0)).toBeCloseTo(nw.total, 1);
    expect(h.trust.total).toBeCloseTo(nw.total, 2);
    expect(h.trust.confirmed + h.trust.calculated + h.trust.unconfirmed).toBeCloseTo(nw.total, 2);
    expect(h.trend.all[h.trend.all.length - 1]!.value).toBe(nw.total);
  });

  it('the bank, deposit and fund figures are the ones their own pages show', () => {
    const banks = h.banks.overview;
    // a deposit past its date is in neither: net worth and the bank figures agree, and the matured one is only noted
    expect(banks.current).toBeCloseTo(
      (nw.byType.bank_account ?? 0) +
        (nw.byType.fixed_deposit ?? 0) +
        (nw.byType.third_party_held ?? 0),
      1,
    );
    expect(h.banks.maturedNotCounted).toBeGreaterThan(0);
    expect(h.deposits.overview.current).toBeCloseTo(banks.parts.fd.current, 2);
    expect(h.deposits.overview.deposits).toBe(banks.deposits);
    expect(h.funds!.totals.value).toBeCloseTo(nw.byType.mutual_fund ?? 0, 2);
    expect(h.deposits.banks.reduce((a, b) => a + b.current, 0)).toBeCloseTo(
      h.deposits.overview.current,
      2,
    );
  });

  it('the Cash card keeps the rupee total of all cash and lists the foreign part beneath it', () => {
    const cash = h.classes.find((c) => c.key === 'cash')!;
    const inrAccounts = input.portfolio.valued
      .filter((v) => v.type === 'bank_account' && !['s-ja-usd', 's-ja-sgd'].includes(v.assetId))
      .reduce((s, v) => s + (v.estimate?.estimatedAmount ?? 0), 0);
    const foreignInr = cash.foreign.reduce((s, f) => s + f.inr, 0);
    // the card's figure is all the cash: the rupee accounts plus the foreign accounts converted, as net worth counts them
    expect(cash.foreign.map((f) => f.currency)).toEqual(['SGD', 'USD']);
    expect(foreignInr).toBeGreaterThan(0);
    expect(cash.current).toBeGreaterThanOrEqual(foreignInr);
    expect(inrAccounts + foreignInr).toBeCloseTo(nw.byType.bank_account!, 1);
    const sgd = cash.foreign[0]!;
    expect(sgd.native).toBe(41_250);
    expect(sgd.inr).toBeCloseTo(41_250 * 56.1, 2);
    expect(sgd.rate).toBeCloseTo(56.1, 6);
    expect(sgd.rateDate).toBe('2026-10-26');
    // no other card carries a foreign line
    expect(h.classes.filter((c) => c.key !== 'cash').every((c) => c.foreign.length === 0)).toBe(
      true,
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
    // the position on the first day of the last days, rebuilt from what was on file by then
    expect(w.since).toBe(h.tiles.recent.from);
    expect(w.change).toBeCloseTo(h.total - positionAsOf(input.position, w.since).total, 2);
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

describe('the headline tiles', () => {
  const m = model();
  const t = m.tiles;

  it('are the total row of the profit-by-period table: one function, so the page cannot disagree with itself', () => {
    for (const w of m.periods.windows) {
      expect(t[w.key].amount).toBe(m.periods.total.cells[w.key].profit);
      expect(t[w.key].pct).toBe(m.periods.total.cells[w.key].pct);
      expect(t[w.key].from).toBe(w.from);
    }
  });

  it('start where the period really starts, so the last 30 days and the financial year differ', () => {
    expect(t.recent.asked).toBe('2026-09-26');
    expect(t.fy.asked).toBe('2026-04-01');
    expect(sinceWords(t.recent)).toBe('since 26 Sep 2026');
    expect(sinceWords(t.fy)).toBe('since 1 Apr 2026');
    expect(t.recent.clamped).toBe(false);
    expect(t.fy.clamped).toBe(false);
    expect(t.fy.amount).toBeGreaterThan(t.recent.amount * 2);
    // the sample has records well before the financial year, so the year is not cut off at a first record
    expect(m.dataStarts! < t.fy.from).toBe(true);
  });

  it('say how many holdings the first day rests on, and the record dates behind it', () => {
    expect(coverageWords(t.fy)).toMatch(/^\d+ of \d+ holdings had a value then$/);
    expect(t.fy.coverage.withValue).toBeLessThan(t.fy.coverage.of);
    expect(t.fy.startFrom.movedForward).toBeGreaterThan(0);
    expect(t.fy.startFrom.oldest! <= t.fy.from).toBe(true);
    expect(t.recent.coverage.withValue).toBeGreaterThan(t.fy.coverage.withValue);
  });

  it('count only what holdings earned: net worth moves by a different amount, because money came in and went out', () => {
    expect(t.recent.netWorth.change).not.toBeCloseTo(t.recent.amount, 0);
    expect(t.recent.netWorth.end).toBeCloseTo(m.total, 2);
  });
});

describe('invested money and profit', () => {
  const m = model();
  const card = (k: string) => m.classes.find((c) => c.key === k)!;

  it('invested is deposits and funds only: savings and cash balances are not invested', () => {
    expect(m.money.invested).toBeCloseTo(card('fd').invested + card('funds').invested, 2);
    expect(m.money.invested).toBeLessThan(m.money.invested + card('cash').invested);
    expect(m.money.parts.notInvested).toBeCloseTo(card('cash').current + card('others').current, 2);
    expect(m.money.valueOfInvested).toBeCloseTo(m.money.invested + m.money.profit, 2);
  });

  it('profit is the interest accrued on deposits plus the gain on the fund units held, as a share of the money invested at cost', () => {
    expect(m.money.profit).toBeCloseTo(card('fd').profit + card('funds').profit, 2);
    expect(m.money.profitPct).toBeCloseTo(m.money.profit / m.money.invested, 10);
    // the profit does not change when a savings balance does
    expect(m.money.profit).toBeLessThan(m.money.current - m.money.invested);
  });
});

describe('the trend', () => {
  it('says how many of its points are rebuilt from history and how many months have none', () => {
    const m = model();
    expect(m.trend.rebuilt).toBeGreaterThan(0);
    expect(m.trend.rebuilt).toBeLessThan(m.trend.history);
    expect(m.trend.missingMonths).toBeGreaterThan(0);
  });
});
