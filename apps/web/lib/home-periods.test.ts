import { describe, expect, it } from 'vitest';
import {
  bankOverview,
  cashBlocks,
  accountsOf,
  cashByBank,
  depositsOf,
  depositPeriod,
  depositsByBank,
  fdInterestByFy,
  fixedDepositBlocks,
  recentWindow,
  savingsPeriod,
  spanBetween,
  type GainPeriodKey,
  type PersonStyle,
  type ReportFd,
} from '@fwos/core';
import { demoHomeInput } from './demo-home';
import { fundHoldingOf } from './fund-holdings';
import { buildHome } from './home';
import { investPerformance } from './invest-perf';
import { buildPl } from './invest-pl';

const input = demoHomeInput('1Y');
const h = buildHome(input);
const nw = input.portfolio.netWorth;
const deposits = depositsOf(input.position);
const accounts = accountsOf(input.position);
const today = input.today;
const card = (k: string) => h.classes.find((c) => c.key === k)!;
/** The pages show whole rupees, and the fund series adds up rounded values, so the same figure is within a rupee. */
const sameRupee = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1);
const cell = (k: 'fd' | 'funds' | 'cash', w: GainPeriodKey) =>
  h.periods.rows.find((r) => r.key === k)!.cells[w];

describe('the headline figures and the four cards', () => {
  it('the four cards are net worth exactly, and the headline is their sum', () => {
    expect(h.classes.map((c) => c.key)).toEqual(['fd', 'funds', 'cash', 'others']);
    expect(h.classes.reduce((a, c) => a + c.current, 0)).toBeCloseTo(nw.total, 4);
    expect(h.money.current).toBe(nw.total);
    // invested money is the deposits' principal and the cost of the fund units held: savings, cash and the rest are not invested
    expect(h.money.invested).toBeCloseTo(card('fd').invested + card('funds').invested, 4);
    expect(h.money.profit).toBeCloseTo(card('fd').profit + card('funds').profit, 4);
    expect(h.money.valueOfInvested).toBeCloseTo(
      h.money.invested + h.money.profit,
      4,
    );
    expect(h.money.parts.notInvested).toBeCloseTo(
      card('cash').current + card('others').current,
      4,
    );
    expect(h.money.profitPct).toBeCloseTo(h.money.profit / h.money.invested, 10);
    expect(h.classes.reduce((a, c) => a + c.share, 0)).toBeCloseTo(1, 6);
    // deposits pay more at maturity; everything else is counted at today's value
    expect(h.money.maturity).toBeCloseTo(h.total + (card('fd').maturity - card('fd').current), 4);
    expect(h.money.maturity).toBeGreaterThan(h.money.current);
  });

  it('each card is the figure of its own page', () => {
    // deposits as Deposits counts them, plus the matured ones that wait to be confirmed (in net worth, not in Deposits)
    const dep = h.deposits.overview.parts.fd;
    const fd = card('fd');
    expect(fd.awaiting!.count).toBeGreaterThan(0);
    expect(fd.current - fd.awaiting!.current).toBeCloseTo(dep.current, 4);
    expect(fd.invested - fd.awaiting!.invested).toBeCloseTo(dep.invested, 4);
    expect(fd.maturity - fd.awaiting!.current).toBeCloseTo(dep.maturity, 4);
    expect(h.deposits.banks.reduce((a, b) => a + b.current, 0)).toBeCloseTo(dep.current, 4);
    expect(depositsByBank(fixedDepositBlocks(input.blocks), today).length).toBe(
      h.deposits.banks.length,
    );
    // savings and cash as Cash counts them
    const cash = card('cash');
    const cashPage = cashByBank(
      cashBlocks(input.blocks),
      (input.overview.savingsRates ?? {}) as Record<string, number>,
      input.overview.tdsRate ?? 0,
      input.overview.defaultSavingsRate,
    );
    expect(cash.current).toBeCloseTo(
      cashPage.reduce((a, b) => a + b.balance, 0),
      4,
    );
    expect(cash.invested).toBeCloseTo(h.banks.overview.parts.cash.invested, 4);
    // funds as Investments counts them
    const funds = card('funds');
    expect(funds.current).toBe(input.inv!.household.value);
    expect(funds.invested).toBe(input.inv!.household.invested);
    expect(funds.profit).toBeCloseTo(funds.current - funds.invested, 4);
    expect(funds.estimated).toBe(true);
    // the rest has no cost to compare with: profit is nothing unless a recorded value moved
    const rest = card('others');
    expect(rest.profit).toBeCloseTo(0, 4);
    expect(rest.earned).toBe(0);
    expect(rest.current).toBeCloseTo(
      (nw.byType.stock ?? 0) +
        (nw.byType.property ?? 0) +
        (nw.byType.receivable ?? 0) +
        (nw.byType.nps ?? 0) +
        (nw.byType.third_party_held ?? 0),
      2,
    );
  });

  it('earned today by kind is what the bank overview and the funds say', () => {
    expect(card('fd').today).toBe(h.banks.overview.today.fd);
    expect(card('cash').today).toBe(h.banks.overview.today.savings);
    expect(card('funds').today).toBe(h.change.today.funds);
    expect(card('fd').today + card('cash').today + card('funds').today).toBeCloseTo(
      h.change.today.amount,
      6,
    );
  });
});

describe('the same period gives the same figure on every page', () => {
  it('measures all six periods for every kind, with the last N days taken from Settings', () => {
    expect(h.periods.windows.map((w) => w.key)).toEqual([
      'recent',
      'month',
      'quarter',
      'fy',
      'lastFy',
      'start',
    ]);
    expect(h.periods.windows[0]!.days).toBe(input.config.home.changeDays);
    expect(h.periods.windows[3]!.from).toBe(h.change.fyStart);
    const longer = buildHome({
      ...input,
      config: { ...input.config, home: { ...input.config.home, changeDays: 60 } },
    });
    expect(longer.periods.windows[0]!.days).toBe(60);
  });

  it('earned today on Accounts, Deposits and Cash is the last day of the shared figures', () => {
    const day = recentWindow(today, 1);
    const fd = depositPeriod(deposits, day, today).profit;
    expect(fd).toBeCloseTo(h.banks.overview.today.fd, 6);
    expect(h.deposits.overview.today.fd).toBeCloseTo(fd, 6);
    const cash = savingsPeriod(accounts, day).profit;
    expect(cash).toBeCloseTo(h.banks.overview.today.savings, 6);
    // the same call the Cash page makes over the cash blocks alone
    const cashPage = bankOverview(cashBlocks(input.blocks), input.overview);
    expect(cashPage.today.savings).toBeCloseTo(cash, 6);
  });

  it('interest earned so far on the Deposits overview is the shared figure since the deposits began', () => {
    const running = deposits.filter((d) => d.held && d.maturityOn >= today);
    const so = depositPeriod(running, spanBetween('2000-01-01', today, today), today);
    expect(so.profit).toBeCloseTo(h.deposits.overview.profit, 4);
    // and the card adds the deposits waiting to be confirmed
    const held = deposits.filter((d) => d.held);
    expect(depositPeriod(held, spanBetween('2000-01-01', today, today), today).profit).toBeCloseTo(
      card('fd').profit,
      4,
    );
  });

  it('interest by financial year in Reports is the shared figure for that year', () => {
    const fds: ReportFd[] = deposits.map((d) => ({
      id: d.assetId,
      bank: 'x',
      owner: 'p',
      kind: 'FD',
      principal: d.principal,
      rate: d.rate,
      bookedOn: d.bookedOn,
      maturityOn: d.maturityOn,
      maturityAmount: 0,
      compounding: d.compounding,
    }));
    const table = fdInterestByFy(fds, today);
    const last = table.rows.find((r) => r.fy === 'FY 2025-26')!;
    expect(Number(last.total)).toBeCloseTo(cell('fd', 'lastFy').profit, 0);
  });

  it('funds: Investments performance and profit-and-loss give the same rupees for the same period', () => {
    const view = input.inv!;
    const perf = investPerformance(view);
    const styles: Record<string, PersonStyle> = {};
    // this financial year, from the trailing table and from the profit-and-loss buckets
    sameRupee(perf.periodGains.fy!.gain, cell('funds', 'fy').profit);
    const fy = buildPl(view, perf, styles, 'fy', 'none').main;
    sameRupee(fy[fy.length - 1]!.gain, cell('funds', 'fy').profit);
    sameRupee(fy.find((b) => b.key === '2025-26')!.gain, cell('funds', 'lastFy').profit);
    const month = buildPl(view, perf, styles, 'month', 'none').main;
    sameRupee(month[month.length - 1]!.gain, cell('funds', 'month').profit);
    const quarter = buildPl(view, perf, styles, 'quarter', 'none').main;
    sameRupee(quarter[quarter.length - 1]!.gain, cell('funds', 'quarter').profit);
    // the money put in is the same too
    sameRupee(perf.periodGains.fy!.netIn, cell('funds', 'fy').putIn - cell('funds', 'fy').takenOut);
  });

  it('marks a period estimated in the same places: Investments and Home agree on where an estimate starts', () => {
    const view = input.inv!;
    const holdings = view.groups.flatMap((g) => g.funds).map(fundHoldingOf);
    const first = holdings
      .map((f) => f.estimatedSince)
      .filter((d): d is string => d !== null)
      .sort()[0];
    expect(investPerformance(view).estimatedSince).toBe(first);
    // the sample funds with no statement are estimated; those with one are exact
    expect(holdings.filter((f) => !f.hasStatement).every((f) => f.estimatedSince !== null)).toBe(
      true,
    );
    expect(holdings.filter((f) => f.hasStatement).every((f) => f.estimatedSince === null)).toBe(
      true,
    );
    expect(cell('funds', 'fy').estimated).toBe(true);
    expect(cell('cash', 'recent').estimated).toBe(true);
    expect(cell('fd', 'fy').estimated).toBe(false);
  });

  it('exercises every case: money put in, paid out, sold, bought, no statement, foreign cash', () => {
    const fd = cell('fd', 'recent');
    expect(fd.putIn).toBeGreaterThan(0);
    expect(fd.takenOut).toBeGreaterThan(0);
    const funds = cell('funds', 'recent');
    expect(funds.putIn).toBeGreaterThan(0);
    expect(funds.takenOut).toBeGreaterThan(0);
    expect(h.periods.basis.fundsFromPlan).toBe(2);
    expect(h.periods.basis.foreignAccounts).toBe(1);
    expect(h.periods.basis.depositsEnded).toBeGreaterThanOrEqual(2);
    // since the start counts what was paid out and sold, so it is more than the profit on what is still held
    expect(cell('fd', 'start').profit).toBeGreaterThan(card('fd').profit);
    expect(cell('funds', 'start').profit).toBeGreaterThan(card('funds').profit);
    for (const w of h.periods.windows)
      expect(h.periods.total.cells[w.key].profit).toBeCloseTo(
        h.periods.rows.reduce((a, r) => a + r.cells[w.key].profit, 0),
        6,
      );
  });
});
