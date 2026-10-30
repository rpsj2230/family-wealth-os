import { describe, expect, it } from 'vitest';
import {
  chainCoverage,
  checkOverview,
  foldColumns,
  journeyFlows,
  movementFlows,
  moneyChain,
  overviewFlows,
  sankeyLayout,
  type ChainDeposit,
  type FlowContext,
  type FlowGraph,
  type TrailAsset,
  type TrailLine,
} from '../src';

const OPTS = { smallest: 1, depth: 40, budget: 400 };
let n = 0;
const ln = (
  assetId: string,
  date: string,
  amount: number,
  cls: TrailLine['cls'],
  counterpart: string | null = null,
  narration = '',
): TrailLine => ({ id: `f${++n}`, assetId, date, amount, cls, counterpart, narration });
const acct = (id: string, ownerId = 'R'): TrailAsset => ({ id, ownerId, kind: 'account' });
const dep = (d: Partial<ChainDeposit> & { assetId: string }): ChainDeposit => ({
  ownerId: 'R',
  bank: null,
  principal: 0,
  bookedOn: '2024-01-01',
  maturityOn: '2025-01-01',
  endedOn: null,
  maturityAmount: null,
  ...d,
});
const sumCol = (g: FlowGraph, c: number) =>
  g.nodes.filter((x) => x.column === c).reduce((s, x) => s + x.value, 0);

// ₹10L from Singapore into C; C → A ₹8L; A books FD1 ₹6L; FD1 pays back ₹6.4L into A; A books FD2 ₹6.4L (the same money, round
// again); A sends ₹50k to B but B's statement does not show it; ₹1L spent from C
const remit = ln('C', '2023-01-01', 1_000_000, 'own_transfer', 'SG', 'Wise');
const cOut = ln('C', '2023-01-02', -800_000, 'own_transfer', 'A');
const aIn = ln('A', '2023-01-02', 800_000, 'own_transfer', 'C');
const book1 = ln('A', '2023-01-05', -600_000, 'fd_funding', 'FD1');
const back1 = ln('A', '2024-01-05', 640_000, 'fd_proceeds', 'FD1');
const book2 = ln('A', '2024-01-06', -640_000, 'fd_funding', 'FD2');
const toB = ln('A', '2024-02-01', -50_000, 'own_transfer', 'B');
const spent = ln('C', '2024-03-01', -100_000, 'spent');
const bIn = ln('B', '2024-01-01', 20_000, 'interest');
const lines = [remit, cOut, aIn, book1, back1, book2, toB, spent, bIn];
const assets: TrailAsset[] = [
  acct('C'),
  acct('A'),
  acct('B', 'G'),
  { id: 'SG', ownerId: 'R', kind: 'account', abroad: true },
  { id: 'FD1', ownerId: 'R', kind: 'deposit' },
  { id: 'FD2', ownerId: 'R', kind: 'deposit' },
];
const chain = moneyChain({
  lines,
  assets,
  deposits: [
    dep({ assetId: 'FD1', principal: 600_000, bookedOn: '2023-01-05', maturityOn: '2024-01-05' }),
    dep({ assetId: 'FD2', principal: 640_000, bookedOn: '2024-01-06', maturityOn: '2026-01-06' }),
  ],
  openings: new Map(),
  method: 'recent',
  pairDays: 3,
  remittanceOf: new Map([[remit.id, 'W1']]),
});
const ctx: FlowContext = {
  kindOf: (h) => (h.startsWith('FD') ? 'deposit' : 'account'),
  ownerOf: (h) => (h === 'B' ? 'G' : 'R'),
  bankOf: (h) => (h === 'B' ? 'Bank B' : 'Bank R'),
};

describe('money flow: overview', () => {
  const g = overviewFlows(chain, ctx);

  it('adds up: what starts equals what is now or left, and what is held equals the trail’s total', () => {
    // ₹10L from Singapore, ₹40k deposit interest, ₹20k savings interest
    expect(g.total).toBeCloseTo(1_060_000, 4);
    expect(sumCol(g, 0)).toBeCloseTo(sumCol(g, 2), 4);
    const cov = chainCoverage(chain, (h) => ctx.kindOf(h));
    const checks = checkOverview(g, cov.total);
    expect(checks.every((c) => c.ok)).toBe(true);
  });

  it('counts money that went round (deposit → account → deposit) once', () => {
    const fromSg = g.links
      .filter((l) => l.source === 'start:singapore')
      .reduce((s, l) => s + l.amount, 0);
    expect(fromSg).toBeCloseTo(1_000_000, 4);
    // of it: ₹6L in FD2 now (with FD1's interest ₹40k beside it), ₹1L spent, ₹50k sent to B
    const toFd2 = g.links.filter((l) => l.target === 'now:FD2').reduce((s, l) => s + l.amount, 0);
    expect(toFd2).toBeCloseTo(640_000, 4);
  });

  it('draws money sent to an account whose statement does not show it as a gap to that account', () => {
    const gap = g.links.find((l) => l.target === 'end:not_found:B')!;
    expect(gap.status).toBe('gap');
    expect(gap.gap).toBe('link_not_found');
    expect(gap.amount).toBeCloseTo(50_000, 4);
  });

  it('filters by source, date, kind of holding and status', () => {
    const sg = overviewFlows(chain, ctx, { sources: ['singapore'] });
    expect(sg.total).toBeCloseTo(1_000_000, 4);
    const later = overviewFlows(chain, ctx, { from: '2024-01-01' });
    expect(later.total).toBeCloseTo(60_000, 4);
    const deps = overviewFlows(chain, ctx, { kinds: ['deposit'] });
    expect(sumCol(deps, 2)).toBeCloseTo(640_000, 4);
    const verified = overviewFlows(chain, ctx, { status: 'verified' });
    expect(verified.links.every((l) => l.status === 'verified')).toBe(true);
    const byBank = overviewFlows(chain, ctx, {}, { middle: 'bank', right: 'kind' });
    expect(byBank.nodes.some((x) => x.id === 'bank:Bank R')).toBe(true);
    expect(byBank.nodes.some((x) => x.id === 'nowkind:deposit')).toBe(true);
  });
});

describe('money flow: movements', () => {
  const g = movementFlows(chain, ctx);
  const amt = (from: string, to: string) =>
    g.links
      .filter((l) => l.source === `from:${from}` && l.target === `to:${to}`)
      .reduce((s, l) => s + l.amount, 0);

  it('shows each movement between holdings, money going round as movements both ways', () => {
    expect(amt('C', 'A')).toBeCloseTo(800_000, 4);
    expect(amt('A', 'FD1')).toBeCloseTo(600_000, 4);
    expect(amt('FD1', 'A')).toBeCloseTo(640_000, 4); // principal ₹6L and the interest ₹40k
    expect(amt('A', 'FD2')).toBeCloseTo(640_000, 4);
    expect(amt('A', 'B')).toBeCloseTo(50_000, 4);
    expect(g.links.find((l) => l.source === 'from:A' && l.target === 'to:B')!.status).toBe('gap');
  });

  it('follows one source’s money only, and a period', () => {
    const sg = movementFlows(chain, ctx, { sources: ['singapore'] });
    const fd1Back = sg.links
      .filter((l) => l.source === 'from:FD1' && l.target === 'to:A')
      .reduce((s, l) => s + l.amount, 0);
    // the interest is not Singapore money
    expect(fd1Back).toBeCloseTo(600_000, 4);
    const y2024 = movementFlows(chain, ctx, { from: '2024-01-01', to: '2024-12-31' });
    expect(y2024.links.some((l) => l.source === 'from:C' && l.target === 'to:A')).toBe(false);
  });
});

describe('money flow: journey of one holding', () => {
  it('goes back from the deposit to Singapore through every step, in time order, and forward to where it is', () => {
    const g = journeyFlows(
      chain,
      ctx,
      {
        back: chain.into.get('FD1') ?? [],
        forward: chain.outOf.get('FD1') ?? [],
        focus: 'FD1',
      },
      OPTS,
    );
    const focus = g.nodes.find((x) => x.id === 'focus:FD1')!;
    const sg = g.nodes.find((x) => x.start === 'singapore')!;
    expect(sg.column).toBeLessThan(focus.column);
    for (const l of g.links) {
      const s = g.nodes.find((x) => x.id === l.source)!;
      const t = g.nodes.find((x) => x.id === l.target)!;
      expect(s.column).toBeLessThan(t.column);
    }
    expect(g.nodes.some((x) => x.id === 'now:FD2')).toBe(true);
  });
});

describe('sankey layout', () => {
  it('stacks nodes by value, keeps bands inside their nodes and never draws a node too small to see', () => {
    const g = foldColumns(overviewFlows(chain, ctx), 3);
    expect(g.nodes.filter((x) => x.column === 2).length).toBeLessThanOrEqual(3);
    const lay = sankeyLayout(
      g.nodes.map((x) => ({ id: x.id, column: x.column, value: x.value })),
      g.links.map((l) => ({ source: l.source, target: l.target, amount: l.amount })),
      { width: 600, height: 300 },
    );
    expect(lay.columns).toBe(3);
    for (const node of lay.nodes) {
      expect(node.height).toBeGreaterThanOrEqual(4);
      expect(Number.isFinite(node.y)).toBe(true);
    }
    for (const l of lay.links) {
      const s = lay.nodes.find((x) => x.id === l.source)!;
      expect(l.y0).toBeGreaterThanOrEqual(s.y);
      expect(l.y0).toBeLessThanOrEqual(s.y + s.height + 2);
      expect(l.x1).toBeGreaterThan(l.x0);
    }
    expect(Math.max(...lay.nodes.map((x) => x.x))).toBeCloseTo(600 - 12, 6);
  });
});
