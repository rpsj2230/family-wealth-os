import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG,
  bankOverview,
  cashBlocks,
  cashByBank,
  depositsByBank,
  fixedDepositBlocks,
  largestCash,
  maturityLadder,
  missingFigures,
} from '@fwos/core';
import { demoHomeInput } from './demo-home';
import { DEMO_TODAY, demoModel } from './demo-fixture';
import { accountsExplain, bankBase, cashExplain, depositsExplain } from './explain-money';
import { homeExplain } from './explain-home';
import { buildHome } from './home';

const iso = DEMO_TODAY.toISOString().slice(0, 10);
const cfg = DEFAULT_CONFIG;
const baseOf = (blocks: ReturnType<typeof demoModel>['blocks']) =>
  bankBase({
    today: iso,
    scope: null,
    blocks,
    savingsRate: cfg.estimates.savingsRate,
    tdsRate: cfg.estimates.interestTdsRate,
  });
const opts = {
  today: DEMO_TODAY,
  fx: demoModel().fx,
  soonDays: cfg.reminders.maturitySoonDays,
  defaultSavingsRate: cfg.estimates.savingsRate,
  tdsRate: cfg.estimates.interestTdsRate,
};

describe('Home explainers (sample household)', () => {
  const m = buildHome(demoHomeInput('1Y'));
  const ex = homeExplain(m, (p) => p);

  it('every registered Home figure has an explainer', () => {
    expect(missingFigures('home', ex)).toEqual([]);
  });

  it('the Cash card says the foreign balance is inside the figure and how its rate was chosen', () => {
    const c = ex['home.classCash'];
    expect(c.notes.join(' ')).toMatch(/held in SGD, USD/);
    expect(c.notes.join(' ')).toContain('already inside the figure');
    expect(c.notes.join(' ')).toContain('rate of 26 Oct');
    expect(c.notes.join(' ')).toContain('with no rate on file');
    expect(c.inputs.map((i) => i.label)).toEqual(
      expect.arrayContaining(['Held in SGD', 'Held in USD']),
    );
  });

  it('net worth names its three kinds of basis and the date of the latest record', () => {
    const n = ex['home.netWorth'];
    expect(n.exact).toContain('₹');
    expect(n.inputs.map((i) => i.basis)).toEqual(
      expect.arrayContaining(['calculated', 'estimated', 'recorded']),
    );
    expect(n.completeness.text).toContain('estimated');
  });

  it('profit and the change over a period state their denominators', () => {
    expect(ex['home.profitSoFar'].how).toMatch(/own money/);
    expect(ex['home.earnedFy'].how).toMatch(/of net worth on 1 April|Shows once/);
    expect(ex['home.earningRate'].how).toMatch(/a year/);
    expect(ex['home.classFunds'].how).toMatch(/÷ ₹[\d,]+ net worth/);
  });

  it('a link to a page the sample lacks is left out', () => {
    const none = homeExplain(m, () => '');
    for (const e of Object.values(none)) {
      expect(e.fix === undefined || e.fix.href !== '').toBe(true);
      for (const a of e.also ?? []) expect(a.href).not.toBe('');
    }
  });
});

describe('Accounts, Deposits and Cash explainers (sample household)', () => {
  const model = demoModel();
  const o = bankOverview(model.blocks, { ...opts, insuranceLimit: cfg.deposits.insuranceLimit });

  it('Accounts covers every registered figure', () => {
    const ex = accountsExplain(o, baseOf(model.blocks), true);
    expect(missingFigures('accounts', ex)).toEqual([]);
    expect(ex['accounts.total'].exact).toContain('₹');
    expect(ex['accounts.profit'].how).toContain('÷');
    expect(ex['accounts.today'].completeness.level).toBe('estimated');
    expect(ex['accounts.cash'].notes.join(' ')).toContain('S$');
    expect(ex['accounts.total'].inputs.some((i) => i.label === 'Held in SGD')).toBe(true);
  });

  it('Deposits covers every registered figure and is worked out from the deposits’ terms', () => {
    const blocks = fixedDepositBlocks(model.blocks);
    const od = bankOverview(blocks, opts);
    const ex = depositsExplain(od, baseOf(blocks), true, {
      cover: { limit: cfg.deposits.insuranceLimit, uninsured: 0, banksOver: 0 },
      toConfirm: 0,
      banks: depositsByBank(blocks, iso),
      ladder: maturityLadder(blocks),
    });
    expect(missingFigures('deposits', ex)).toEqual([]);
    expect(ex['deposits.total'].completeness.level).toBe('complete');
    expect(ex['deposits.journey'].how).toMatch(/÷/);
  });

  it('Cash covers every registered figure and says where the savings rates came from', () => {
    const blocks = cashBlocks(model.blocks);
    const oc = bankOverview(blocks, opts);
    const banks = cashByBank(blocks, {}, cfg.estimates.interestTdsRate, cfg.estimates.savingsRate);
    const interestYear = banks.reduce((s, b) => s + b.interestYear, 0);
    const ex = cashExplain(oc, baseOf(blocks), true, {
      banks,
      interestYear,
      avgRate: 0.03,
      largest: largestCash(blocks),
    });
    expect(missingFigures('cash', ex)).toEqual([]);
    expect(ex['cash.interestYear'].completeness.level).toBe('estimated');
    expect(ex['cash.interestYear'].completeness.text).toContain('assumed rate');
  });
});
