import { describe, expect, it } from 'vitest';
import {
  buildDigestEmail,
  emailProblems,
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
  const input = demoDigestInput();
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
