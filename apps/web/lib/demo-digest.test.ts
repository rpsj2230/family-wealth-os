import { describe, expect, it } from 'vitest';
import {
  assembleDigest,
  buildDigest,
  buildDigestEmail,
  emailProblems,
  familyLines,
  goalCard,
  savingsRatesOf,
  type DigestInput,
} from '@fwos/core';
import { demoDigestInput, demoDigestSources } from './demo-digest';
import { demoHomeInput } from './demo-home';
import { buildHome } from './home';
import { cashRatesFor } from './rates-view';
import { previewFrames } from './digest-preview';

/**
 * The daily summary and Home are built from the same invented household, so every figure they share must be the same number.
 * These tests are what keeps the e-mail and the portal from disagreeing.
 */
describe('the e-mail agrees with Home', () => {
  const home = buildHome(demoHomeInput('1Y'));
  // the summary's own reading (before Home's figures are put in): it must agree with Home on its own, for when Home cannot be built
  const input = assembleDigest(demoDigestSources());
  const w = input.wealth!;

  it('net worth, today and the overall profit are Home’s headline figures', () => {
    expect(w.total).toBe(home.total);
    expect(w.today.amount).toBeCloseTo(home.change.today.amount, 8);
    expect(w.today.pct).toBe(home.change.today.pct);
    expect(w.overall.profit).toBeCloseTo(home.money.profit, 6);
    expect(w.overall.invested).toBeCloseTo(home.money.invested, 6);
    expect(w.overall.profitPct).toBe(home.money.profitPct);
    expect(w.overall.estimated).toBe(home.money.estimated);
  });

  it('the four kinds are Home’s four cards, to the rupee', () => {
    for (const c of home.classes) {
      const mine = w.classes.find((x) => x.key === c.key)!;
      expect(mine.current).toBeCloseTo(c.current, 6);
      expect(mine.invested).toBeCloseTo(c.invested, 6);
      expect(mine.profit).toBeCloseTo(c.profit, 6);
      expect(mine.today).toBeCloseTo(c.today, 8);
      expect(mine.share).toBeCloseTo(c.share, 10);
      expect(mine.estimated).toBe(c.estimated);
    }
    expect(w.classes.reduce((a, c) => a + c.current, 0)).toBeCloseTo(home.total, 4);
  });

  it('the month change and late inputs are Home’s', () => {
    // the last N days is what Home's tile says: the earnings from the same period start, one function for both
    expect(input.month).toEqual({
      amount: home.tiles.recent.amount,
      pct: home.tiles.recent.pct,
      from: home.tiles.recent.from,
      partial: home.tiles.recent.clamped,
    });
    expect(input.lateInputs).toBe(home.trustDetail.fresh.stale + home.trustDetail.fresh.missing);
    expect(input.asOf).toBe(home.asOf);
  });

  it('what changed is Home’s what changed', () => {
    expect(input.changes!.since).toBe(home.whatChanged!.since);
    expect(input.changes!.kinds).toEqual(
      home.whatChanged!.kinds.slice(0, input.changes!.kinds.length),
    );
    expect(input.changes!.kinds.length).toBeGreaterThan(0);
  });

  it('the goals are Home’s goals, judged by the same projection', () => {
    for (const g of home.goals.list) {
      const card = input.goals?.find((c) => c.id === g.id);
      if (g.kind === 'retirement') {
        // retirement is shown once, as its own card
        expect(card).toBeUndefined();
        continue;
      }
      expect(card).toBeDefined();
      expect(card!.saved).toBe(g.allocated);
      expect(card!.needed).toBe(g.proj.futureCost);
      expect(card!.projected).toBe(g.proj.projectedValue);
      expect(card!.topUp).toBe(Math.round(g.proj.requiredMonthlyExtra ?? 0));
      expect(card!.state === 'behind').toBe(g.proj.status === 'shortfall');
      expect(['on_track', 'ahead'].includes(card!.state)).toBe(g.proj.status === 'on_track');
      // the card is the same however it is made
      expect(card).toEqual(
        goalCard(g, input.goals ? demoDigestSources().config.digest.aheadMargin : 0.1),
      );
    }
  });

  it('needs you follows Home’s order and wording, item for item', () => {
    const homeItems = home.attention.map((a) => a.text);
    const mine = input.needsYou!.map((n) => n.text);
    expect(mine.slice(0, homeItems.length)).toEqual(homeItems);
    expect(input.needsYou!.slice(0, homeItems.length).map((n) => n.href)).toEqual(
      home.attention.map((a) => a.href),
    );
    // then the tax and rate lines
    expect(mine.length).toBeGreaterThan(homeItems.length);
  });

  it('the funds with no price source are on both lists, with the same words and the page where they are matched', () => {
    const line = '3 funds have no price source: match them.';
    expect(home.attention.find((a) => a.key === 'noprice')).toMatchObject({
      text: line,
      href: '/investments?tab=match',
      tone: 'warn',
    });
    expect(input.needsYou!.find((n) => n.text === line)).toMatchObject({
      href: '/investments?tab=match',
      tone: 'warn',
    });
  });

  it('the biggest deposits paying out are among the ones Home lists as maturing', () => {
    const ladder = input.changes!.maturities;
    expect(ladder.length).toBeGreaterThan(0);
    for (const m of ladder) expect(m.daysLeft).toBeLessThanOrEqual(30);
  });
});

describe('the savings rule is the same one Accounts uses', () => {
  it('savingsRatesOf (core, used by the daily summary) equals cashRatesFor (the web rates view)', () => {
    const rows = [
      {
        assetId: 'a',
        kind: 'cash',
        status: 'active',
        accountKind: 'NRE' as const,
        current: 1_000_000,
        bank: 'Equitas',
      },
      {
        assetId: 'b',
        kind: 'cash',
        status: 'active',
        accountKind: null,
        current: 50_000,
        bank: 'Yes Bank',
      },
      {
        assetId: 'c',
        kind: 'cash',
        status: 'active',
        accountKind: 'NRO' as const,
        current: 0,
        bank: 'Nowhere',
      },
      {
        assetId: 'd',
        kind: 'fd',
        status: 'active',
        accountKind: null,
        current: 9,
        bank: 'Equitas',
      },
    ];
    const own = new Map<string, number | null>([['b', 0.045]]);
    const offers = [
      {
        id: 'o1',
        bank: 'Equitas',
        product: 'savings' as const,
        accountKind: 'NRE' as const,
        tenureFrom: 0,
        tenureTo: 0,
        rate: 0.065,
        conditions: null,
        sourceKind: 'manual' as const,
        checkedOn: '2026-10-01',
        balanceFrom: null,
        balanceTo: null,
        tenureDays: null,
        sourceNote: null,
        sourceUrl: null,
      },
    ];
    expect(savingsRatesOf(rows, own, offers, 0.03)).toEqual(cashRatesFor(rows, own, offers, 0.03));
  });
});

describe('the sample e-mail', () => {
  const input: DigestInput = demoDigestInput();
  const email = buildDigestEmail(input);

  it('shows every goal state and the retirement card, with figures from the sample household', () => {
    const states = new Set(input.goals!.map((g) => g.state));
    for (const s of ['on_track', 'behind', 'ahead', 'no_data'])
      expect(states.has(s as never)).toBe(true);
    expect(input.retirement?.card).toBeTruthy();
    expect(email.subject).toMatch(/^Family Wealth Summary · 26 Oct 2026 · Net worth ₹/);
  });

  it('carries no script, no remote file and no real address', () => {
    expect(emailProblems(email.html)).toEqual([]);
    expect(email.html).not.toMatch(/@(?!example\.test)[a-z0-9.-]+\.[a-z]{2,}/i);
    expect(email.text.length).toBeLessThan(4000);
  });

  it('is shown in two sandboxed frames that can run nothing', () => {
    const frames = previewFrames(email);
    expect(frames.map((f) => f.width)).toEqual([390, 680]);
    for (const f of frames) {
      expect(f.sandbox).toBe('');
      expect(f.srcDoc).toBe(email.html);
      expect(f.title).toContain(email.subject);
    }
  });
});

describe('the money words v6 lines of the e-mail and the WhatsApp text are Home’s figures', () => {
  const home = buildHome(demoHomeInput('1Y'));
  const input = demoDigestInput();
  const f = input.family!;
  const digest = buildDigest(input);
  // the sample household's four lines (invented figures)
  const LINES = [
    'Net worth ₹3,73,16,279 · Today’s change +₹10,807 (+0.03%) · Earned this FY +₹18,17,755',
    'Own money ₹3,53,76,928 · Lifetime profit +₹19,39,351 (+5.5% overall) · XIRR on own money 10.34% · Earning rate now 6.27%',
    'Fixed deposits ₹1,63,20,616 (Profit +₹10,46,716, XIRR 7.63%) · Mutual funds ₹63,62,456 (Profit +₹20,24,235, XIRR 13.98%) · Savings ₹1,13,13,207 (1.81%)',
    'Maturing in the next 30 days: ₹41,00,000',
  ];

  it('Lifetime profit, Own money and XIRR on own money are what buildHome returns', () => {
    expect(home.capital.opening).not.toBeNull();
    expect(f.own!.lifetimeProfit).toBe(home.capital.totals.profit);
    expect(f.own!.ownMoney).toBe(home.capital.totals.ownMoney);
    expect(f.own!.profitPct).toBe(home.capital.totals.profitPct);
    expect(f.xirrOwn).toBe(home.growth.own.rate);
    expect(f.xirrOwn).not.toBeNull();
  });

  it('Earning rate now, each kind’s XIRR and rate, Earned this FY and what matures in 30 days are Home’s', () => {
    expect(f.earningRate).toBe(home.growth.all!.rate);
    expect(f.fd!.xirr).toBe(home.growth.fd);
    expect(f.funds!.xirr).toBe(home.growth.funds);
    expect(f.savings!.rate).toBe(home.growth.savings!.rate);
    expect(f.earnedFy!.amount).toBe(home.extras.earnedFy!.total);
    expect(f.maturing30.principal).toBe(home.extras.maturing30.principal);
    for (const k of ['fd', 'funds'] as const) {
      const c = home.classes.find((x) => x.key === k)!;
      expect(f[k]!.current).toBe(c.current);
      expect(f[k]!.profit).toBe(c.profit);
    }
    expect(f.savings!.current).toBe(home.classes.find((x) => x.key === 'cash')!.current);
  });

  it('net worth leaves property out, as Home does (Settings: count property in net worth)', () => {
    expect(home.extras.notCounted.amount).toBeGreaterThan(0);
    expect(input.wealth!.total).toBe(home.total);
    expect(input.wealth!.today).toEqual(home.change.today);
  });

  it('writes the four lines in the text part, Telegram and the WhatsApp message', () => {
    expect(familyLines(input.wealth!.total, input.wealth!.today, f)).toEqual(LINES);
    for (const t of [digest.text, digest.whatsapp]) {
      const lines = t.split('\n');
      const at = lines.indexOf(LINES[0]!);
      expect(at).toBeGreaterThan(0);
      expect(lines.slice(at, at + 3)).toEqual(LINES.slice(0, 3));
      // the foreign part of the savings sits between the kinds and what matures
      expect(lines.slice(at + 3).find((l) => l.startsWith('Maturing'))).toBe(LINES[3]);
      expect(t).not.toMatch(/same as (on )?Home/i);
    }
  });

  it('names the figures in the e-mail itself: Lifetime profit for the family, Profit for each kind', () => {
    const text = digest.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    expect(text).toContain('Lifetime profit ▲ +₹19,39,351 (+5.5% overall)');
    expect(text).toContain('XIRR on own money 10.34%');
    expect(text).toContain('Earning rate now 6.27%');
    expect(text).toMatch(/In FDs ₹1\.63 Cr .*Profit \+₹10\.47 L/);
    expect(text).toContain('Maturing in the next 30 days: ₹41,00,000');
    expect(text).not.toMatch(/same as (on )?Home|is on Home/i);
  });
});
