/**
 * The money flow: the money trail (money-chain.ts) drawn as flows between holdings, for a Sankey diagram and its table. It only reads
 * the trail: every amount here is one of the trail's own steps, starts or ends, so the diagram adds up to the trail's figures.
 *
 * Three views of the same steps:
 *  - overview: where money started → the account (or deposit) it first entered → where it is now or where it left the trail. Each
 *    rupee appears once, however many times it moved in between (no double counting);
 *  - movements: in a period, the money that moved from each holding to each other holding (a holding can be on both sides, so money
 *    that goes round, savings → deposit → savings, shows as two movements rather than a loop);
 *  - journey: one holding's or one line's money, step by step back to where it started and forward to where it is now, each step a
 *    dated point (an account visited twice is two points), so reinvestment reads in time order.
 *
 * Every flow has a status: verified (both lines on the statements, or named by the statement or the records), matched (linked here by
 * amount and date; the counterpart is not confirmed), or a gap (a statement, a line or an answer is missing). A gap never ends a flow:
 * money sent to an account whose statement does not show it arriving is drawn to that account with a gap connector, and money from
 * an account with no statement on file comes from that account with a gap connector.
 *
 * Pure: no I/O.
 */
import type { OriginKind } from './money-trail';
import {
  REAL_STARTS,
  startPoints,
  traceBack,
  traceForward,
  type ChainLink,
  type ChainNode,
  type EndKind,
  type MoneyChain,
  type TraceOptions,
  type TraceStep,
} from './money-chain';

export type FlowStatus = 'verified' | 'matched' | 'gap';

/** Why a flow is not verified, in the words the diagram shows. */
export type GapReason =
  | 'link_not_found'
  | 'statement_unavailable'
  | 'unverified'
  | 'matched_unconfirmed'
  | 'origin_unknown';

export const GAP_LABEL: Record<GapReason, string> = {
  link_not_found: 'Transaction link not found',
  statement_unavailable: 'Source statement unavailable',
  unverified: 'Unverified transaction',
  matched_unconfirmed: 'Amount and date matched, counterpart not confirmed',
  origin_unknown: 'Origin unknown',
};

export const STATUS_LABEL: Record<FlowStatus, string> = {
  verified: 'Verified',
  matched: 'Matched by amount and date',
  gap: 'Missing or unverified',
};

/** The kind of holding a flow passes through. */
export type HoldingKind = 'account' | 'deposit' | 'fund' | 'outside' | 'held';

export type FlowNodeKind = 'source' | 'holding' | 'bank' | 'group' | 'step' | 'end' | 'other';

export interface FlowNode {
  id: string;
  kind: FlowNodeKind;
  column: number;
  /** the holding it is (or the step happened in) */
  holding?: string;
  holdingKind?: HoldingKind;
  /** a bank, for a node of money grouped by bank */
  bank?: string;
  /** a source: where the money started */
  start?: OriginKind;
  /** a destination: where money left the trail */
  end?: EndKind | 'still';
  /** a step of the journey: the line (or other step) it is, and its date */
  step?: string;
  date?: string;
  /** a node for money whose origin, statement or link is missing */
  gap?: GapReason;
  /** the money through the node: the larger of what comes in and what goes out */
  value: number;
  /** nodes folded into an "other" node */
  folded?: number;
}

export interface FlowLink {
  source: string;
  target: string;
  amount: number;
  status: FlowStatus;
  gap?: GapReason;
  /** how many steps of the trail it adds up */
  count: number;
  first: string;
  last: string;
}

export interface FlowGraph {
  nodes: FlowNode[];
  links: FlowLink[];
  /** the money the graph shows, entering at its first column */
  total: number;
}

/** What the views need to know about the holdings. */
export interface FlowContext {
  kindOf: (holding: string) => 'account' | 'deposit' | 'fund' | null;
  ownerOf: (holding: string) => string | null;
  bankOf?: (holding: string) => string | null;
}

export interface FlowFilter {
  /** money that entered (overview) or moved (movements) on these days, inclusive (yyyy-mm-dd) */
  from?: string;
  to?: string;
  /** holdings of these people */
  owners?: string[];
  /** these holdings only */
  holdings?: string[];
  /** money that started as one of these */
  sources?: OriginKind[];
  /** these kinds of holding (where money is now, or either side of a movement) */
  kinds?: HoldingKind[];
  /** verified flows only, or the matched and missing ones only */
  status?: 'all' | 'verified' | 'unverified';
}

const TINY = 0.5;
const GAP_START: Partial<Record<OriginKind, GapReason>> = {
  unexplained: 'origin_unknown',
  untraced_account: 'statement_unavailable',
  untraced_deposit: 'statement_unavailable',
  untraced_fund: 'statement_unavailable',
};
const GAP_END: Partial<Record<EndKind, GapReason>> = {
  not_found: 'link_not_found',
  untraced_account: 'statement_unavailable',
  untraced_fund: 'statement_unavailable',
  unexplained: 'unverified',
};
export const isGapStart = (k: OriginKind) => !REAL_STARTS.has(k);

export function holdingKind(ctx: FlowContext, holding: string): HoldingKind {
  if (holding.startsWith('away:')) return 'outside';
  if (holding.startsWith('held:')) return 'held';
  return ctx.kindOf(holding) ?? 'account';
}
export function holdingOwner(ctx: FlowContext, holding: string): string | null {
  if (holding.startsWith('away:')) return holding.slice(5);
  if (holding.startsWith('held:')) return ctx.ownerOf(holding.slice(5));
  return ctx.ownerOf(holding);
}

/** A link reached through a deposit or fund, or through money outside the statements, that was matched rather than named. */
function matchedVia(e: ChainLink, t: ChainNode | undefined): boolean {
  if (e.basis === 'guess') return true;
  if (!e.via) return false;
  if (e.via.startsWith('away:') || e.via.startsWith('held:')) return true;
  return (t?.holdingBasis ?? 'guess') === 'guess';
}

// ------------------------------------------------------------------------------------------------------------------------------
// where each step's money ends up, with whether the way there was verified (worked out once per trail)

interface EndShare {
  kind: EndKind | 'still';
  assetId: string | null;
  verified: boolean;
  share: number;
}
type EndMix = Map<string, EndShare>;
const endMemo = new WeakMap<MoneyChain, Map<string, EndMix>>();

function endMix(chain: MoneyChain, id: string): EndMix {
  const done = endMemo.get(chain) ?? endMemo.set(chain, new Map()).get(chain)!;
  if (done.has(id)) return done.get(id)!;
  const stack: { id: string; open: boolean }[] = [{ id, open: false }];
  const onStack = new Set<string>();
  while (stack.length) {
    const top = stack[stack.length - 1]!;
    if (done.has(top.id)) {
      stack.pop();
      continue;
    }
    const n = chain.nodes.get(top.id);
    if (!n) {
      done.set(top.id, new Map());
      stack.pop();
      continue;
    }
    if (!top.open) {
      top.open = true;
      onStack.add(top.id);
      for (const e of n.to)
        if (!done.has(e.node) && !onStack.has(e.node)) stack.push({ id: e.node, open: false });
      continue;
    }
    stack.pop();
    onStack.delete(top.id);
    const mix: EndMix = new Map();
    const add = (x: Omit<EndShare, 'share'>, share: number) => {
      if (share <= 1e-12) return;
      const k = `${x.kind}|${x.assetId ?? ''}|${x.verified ? 1 : 0}`;
      const cur = mix.get(k);
      if (cur) cur.share += share;
      else mix.set(k, { ...x, share });
    };
    const total =
      n.to.reduce((s, e) => s + e.amount, 0) +
      n.left.reduce((s, l) => s + l.amount, 0) +
      n.ends.reduce((s, e) => s + e.amount, 0);
    if (total > 0.005) {
      for (const l of n.left) {
        const moved = l.assetId !== n.assetId;
        const verified =
          !moved ||
          !(
            l.assetId.startsWith('away:') ||
            l.assetId.startsWith('held:') ||
            n.holdingBasis === 'guess'
          );
        add({ kind: 'still', assetId: l.assetId, verified }, l.amount / total);
      }
      for (const e of n.ends)
        add({ kind: e.kind, assetId: e.assetId ?? null, verified: true }, e.amount / total);
      for (const e of n.to) {
        const sub = done.get(e.node);
        if (!sub) continue;
        const guess = matchedVia(e, chain.nodes.get(e.node));
        for (const x of sub.values())
          add({ ...x, verified: x.verified && !guess }, (x.share * e.amount) / total);
      }
    }
    done.set(top.id, mix);
  }
  return done.get(id) ?? new Map();
}

const inRange = (d: string, f: FlowFilter) => (!f.from || d >= f.from) && (!f.to || d <= f.to);

/** The status of a flow from its start and the way it went. */
function statusOf(start: OriginKind | null, end: EndKind | 'still' | null, verified: boolean) {
  const gap = (start && GAP_START[start]) ?? (end && end !== 'still' ? GAP_END[end] : undefined);
  if (gap) return { status: 'gap' as const, gap };
  if (!verified) return { status: 'matched' as const, gap: 'matched_unconfirmed' as const };
  return { status: 'verified' as const };
}

class Builder {
  nodes = new Map<string, FlowNode>();
  links = new Map<string, FlowLink>();
  node(n: Omit<FlowNode, 'value'>): FlowNode {
    const cur = this.nodes.get(n.id);
    if (cur) return cur;
    const x = { ...n, value: 0 };
    this.nodes.set(n.id, x);
    return x;
  }
  link(
    source: string,
    target: string,
    amount: number,
    st: { status: FlowStatus; gap?: GapReason },
    date: string,
  ) {
    if (amount <= 0.005 || source === target) return;
    const k = `${source}→${target}|${st.status}|${st.gap ?? ''}`;
    const cur = this.links.get(k);
    if (cur) {
      cur.amount += amount;
      cur.count++;
      if (date && date < cur.first) cur.first = date;
      if (date && date > cur.last) cur.last = date;
    } else
      this.links.set(k, {
        source,
        target,
        amount,
        ...st,
        count: 1,
        first: date,
        last: date,
      });
  }
  done(firstColumn = 0): FlowGraph {
    const links = [...this.links.values()].filter((l) => l.amount >= TINY);
    const inn = new Map<string, number>();
    const out = new Map<string, number>();
    for (const l of links) {
      out.set(l.source, (out.get(l.source) ?? 0) + l.amount);
      inn.set(l.target, (inn.get(l.target) ?? 0) + l.amount);
    }
    const nodes = [...this.nodes.values()]
      .map((n) => ({ ...n, value: Math.max(inn.get(n.id) ?? 0, out.get(n.id) ?? 0) }))
      .filter((n) => n.value >= TINY);
    const total = nodes
      .filter((n) => n.column === firstColumn)
      .reduce((s, n) => s + (out.get(n.id) ?? 0), 0);
    return { nodes, links, total };
  }
}

const startNodeId = (k: OriginKind) => `start:${k}`;

// ------------------------------------------------------------------------------------------------------------------------------
// overview: where money started → where it first entered → where it is now

export interface FlowOverviewOptions {
  /** the middle column: each holding, or each bank */
  middle?: 'holding' | 'bank';
  /** the last column: each holding, or each kind of holding */
  right?: 'holding' | 'kind';
}

export function overviewFlows(
  chain: MoneyChain,
  ctx: FlowContext,
  filter: FlowFilter = {},
  opts: FlowOverviewOptions = {},
): FlowGraph {
  const b = new Builder();
  const owners = filter.owners?.length ? new Set(filter.owners) : null;
  const holdings = filter.holdings?.length ? new Set(filter.holdings) : null;
  const sources = filter.sources?.length ? new Set(filter.sources) : null;
  const kinds = filter.kinds?.length ? new Set(filter.kinds) : null;
  for (const n of chain.nodes.values()) {
    if (!n.starts.length || !inRange(n.date, filter)) continue;
    const entry = n.assetId;
    const entryOwner = holdingOwner(ctx, entry);
    if (holdings && !holdings.has(entry)) continue;
    const ends = [...endMix(chain, n.id).values()];
    for (const s of n.starts) {
      if (sources && !sources.has(s.kind)) continue;
      if (owners && !owners.has(entryOwner ?? s.person)) continue;
      const src = startNodeId(s.kind);
      b.node({
        id: src,
        kind: 'source',
        column: 0,
        start: s.kind,
        ...(GAP_START[s.kind] ? { gap: GAP_START[s.kind]! } : {}),
      });
      const bank = opts.middle === 'bank' ? (ctx.bankOf?.(entry) ?? null) : null;
      const mid = bank ? `bank:${bank}` : `in:${entry}`;
      b.node(
        bank
          ? { id: mid, kind: 'bank', column: 1, bank }
          : {
              id: mid,
              kind: 'holding',
              column: 1,
              holding: entry,
              holdingKind: holdingKind(ctx, entry),
            },
      );
      let kept = 0;
      for (const e of ends) {
        const kind = e.kind === 'still' && e.assetId ? holdingKind(ctx, e.assetId) : null;
        if (kinds && !(kind && kinds.has(kind))) continue;
        const st = statusOf(s.kind, e.kind, e.verified);
        if (filter.status === 'verified' && st.status !== 'verified') continue;
        if (filter.status === 'unverified' && st.status === 'verified') continue;
        const amount = s.amount * e.share;
        let dst: string;
        if (e.kind === 'still' && e.assetId) {
          if (opts.right === 'kind') {
            dst = `nowkind:${kind}`;
            b.node({ id: dst, kind: 'group', column: 2, end: 'still', holdingKind: kind! });
          } else {
            dst = `now:${e.assetId}`;
            b.node({
              id: dst,
              kind: 'holding',
              column: 2,
              end: 'still',
              holding: e.assetId,
              holdingKind: kind!,
            });
          }
        } else {
          const end = e.kind as EndKind;
          dst = e.assetId && GAP_END[end] ? `end:${end}:${e.assetId}` : `end:${end}`;
          b.node({
            id: dst,
            kind: 'end',
            column: 2,
            end,
            ...(e.assetId ? { holding: e.assetId } : {}),
            ...(GAP_END[end] ? { gap: GAP_END[end]! } : {}),
          });
        }
        b.link(mid, dst, amount, st, n.date);
        kept += amount;
      }
      const st = GAP_START[s.kind]
        ? { status: 'gap' as const, gap: GAP_START[s.kind]! }
        : { status: 'verified' as const };
      b.link(src, mid, kept, st, n.date);
    }
  }
  return b.done(0);
}

// ------------------------------------------------------------------------------------------------------------------------------
// movements: in a period, the money that moved from each holding to each other holding

interface Piece {
  from: string;
  to: string;
  amount: number;
  date: string;
  status: FlowStatus;
  gap?: GapReason;
  /** the step whose money it is (for following one source's money) */
  node: string;
  /** money that starts here: it is all of this kind, whatever else the step carries */
  start?: OriginKind;
}

/** Every movement of money between holdings that the trail records, each once. */
export function flowPieces(chain: MoneyChain): Piece[] {
  const out: Piece[] = [];
  const push = (p: Piece) => {
    if (p.amount > 0.005 && p.from !== p.to) out.push(p);
  };
  for (const n of chain.nodes.values()) {
    const src = n.assetId;
    for (const s of n.starts) {
      // interest and gains come from the holding that paid them; other starts from where the money came from
      const fromHolding =
        s.assetId &&
        s.assetId !== src &&
        (s.kind === 'deposit_interest' || s.kind === 'fund_gain' || s.kind === 'untraced_account');
      const gap = GAP_START[s.kind];
      push({
        from: fromHolding ? s.assetId! : startNodeId(s.kind),
        to: src,
        amount: s.amount,
        date: n.date,
        status: gap ? 'gap' : 'verified',
        ...(gap ? { gap } : {}),
        node: n.id,
        start: s.kind,
      });
    }
    for (const e of n.to) {
      if (!e.via && e.basis === 'same_account') continue;
      const t = chain.nodes.get(e.node);
      if (!t) continue;
      if (e.via) {
        const into = e.basis === 'guess' || e.via.startsWith('away:') || e.via.startsWith('held:');
        push({
          from: src,
          to: e.via,
          amount: e.amount,
          date: n.date,
          status: into ? 'matched' : 'verified',
          ...(into ? { gap: 'matched_unconfirmed' as const } : {}),
          node: n.id,
        });
        const out2 = matchedVia(e, t);
        push({
          from: e.via,
          to: t.assetId,
          amount: e.amount,
          date: t.date,
          status: out2 ? 'matched' : 'verified',
          ...(out2 ? { gap: 'matched_unconfirmed' as const } : {}),
          node: n.id,
        });
      } else {
        const guess = e.basis === 'guess';
        push({
          from: src,
          to: t.assetId,
          amount: e.amount,
          date: t.date,
          status: guess ? 'matched' : 'verified',
          ...(guess ? { gap: 'matched_unconfirmed' as const } : {}),
          node: n.id,
        });
      }
    }
    for (const l of n.left) {
      if (l.assetId === src) continue;
      const guess =
        n.holdingBasis === 'guess' ||
        l.assetId.startsWith('away:') ||
        l.assetId.startsWith('held:');
      push({
        from: src,
        to: l.assetId,
        amount: l.amount,
        date: n.date,
        status: guess ? 'matched' : 'verified',
        ...(guess ? { gap: 'matched_unconfirmed' as const } : {}),
        node: n.id,
      });
    }
    for (const e of n.ends) {
      const gap = GAP_END[e.kind];
      // money sent to a holding whose statement does not show it arriving: drawn to that holding, as a gap
      const to = e.assetId && gap ? e.assetId : `end:${e.kind}`;
      push({
        from: src,
        to,
        amount: e.amount,
        date: n.date,
        status: gap ? 'gap' : 'verified',
        ...(gap ? { gap } : {}),
        node: n.id,
      });
    }
  }
  return out;
}

export function movementFlows(
  chain: MoneyChain,
  ctx: FlowContext,
  filter: FlowFilter = {},
): FlowGraph {
  const b = new Builder();
  const owners = filter.owners?.length ? new Set(filter.owners) : null;
  const holdings = filter.holdings?.length ? new Set(filter.holdings) : null;
  const kinds = filter.kinds?.length ? new Set(filter.kinds) : null;
  const sources = filter.sources?.length ? new Set(filter.sources) : null;
  const shareOf = new Map<string, number>();
  /** the share of a step's money that started as one of the chosen sources */
  const share = (node: string) => {
    if (!sources) return 1;
    if (shareOf.has(node)) return shareOf.get(node)!;
    const pts = startPoints(chain, node, 1);
    const v = pts.filter((p) => sources.has(p.kind)).reduce((s, p) => s + p.amount, 0);
    shareOf.set(node, v);
    return v;
  };
  const isHolding = (id: string) => !id.startsWith('start:') && !id.startsWith('end:');
  for (const p of flowPieces(chain)) {
    if (!inRange(p.date, filter)) continue;
    if (filter.status === 'verified' && p.status !== 'verified') continue;
    if (filter.status === 'unverified' && p.status === 'verified') continue;
    const ends = [p.from, p.to].filter(isHolding);
    if (holdings && !ends.some((h) => holdings.has(h))) continue;
    if (owners && !ends.some((h) => owners.has(holdingOwner(ctx, h) ?? ''))) continue;
    if (kinds && !ends.some((h) => kinds.has(holdingKind(ctx, h)))) continue;
    const amount =
      p.amount * (p.start ? (!sources || sources.has(p.start) ? 1 : 0) : share(p.node));
    if (amount <= 0.005) continue;
    const from = `from:${p.from}`;
    const to = `to:${p.to}`;
    b.node(nodeFor(ctx, from, p.from, 0));
    b.node(nodeFor(ctx, to, p.to, 1));
    b.link(from, to, amount, { status: p.status, ...(p.gap ? { gap: p.gap } : {}) }, p.date);
  }
  return b.done(0);
}

function nodeFor(
  ctx: FlowContext,
  id: string,
  ref: string,
  column: number,
): Omit<FlowNode, 'value'> {
  if (ref.startsWith('start:')) {
    const k = ref.slice(6) as OriginKind;
    return {
      id,
      kind: 'source',
      column,
      start: k,
      ...(GAP_START[k] ? { gap: GAP_START[k]! } : {}),
    };
  }
  if (ref.startsWith('end:')) {
    const k = ref.slice(4) as EndKind;
    return { id, kind: 'end', column, end: k, ...(GAP_END[k] ? { gap: GAP_END[k]! } : {}) };
  }
  return { id, kind: 'holding', column, holding: ref, holdingKind: holdingKind(ctx, ref) };
}

// ------------------------------------------------------------------------------------------------------------------------------
// journey: one holding's or one line's money, step by step back to where it started and forward to where it is now

export interface JourneyRoots {
  /** the steps whose money is the holding's (or the line itself), with the amount followed */
  back: ChainLink[];
  /** the steps the holding paid out into (or the line itself) */
  forward: ChainLink[];
  /** the holding the journey is about, drawn between the two; absent for a line (the line is its own middle) */
  focus?: string;
}

export function journeyFlows(
  chain: MoneyChain,
  ctx: FlowContext,
  roots: JourneyRoots,
  opts: TraceOptions,
): FlowGraph {
  const b = new Builder();
  const focusId = roots.focus ? `focus:${roots.focus}` : null;
  if (roots.focus)
    b.node({
      id: focusId!,
      kind: 'holding',
      column: 0,
      holding: roots.focus,
      holdingKind: holdingKind(ctx, roots.focus),
    });
  const stepId = (s: TraceStep) => `step:${s.node.id}`;
  const stepNode = (s: TraceStep) =>
    b.node({
      id: stepId(s),
      kind: 'step',
      column: 0,
      holding: stepHolding(s),
      holdingKind: holdingKind(ctx, stepHolding(s)),
      step: (s.pair && s.node.amount > 0 ? s.node : s.node).id,
      date: s.node.date,
    });
  const stepStatus = (s: TraceStep) =>
    s.basis === 'guess' ||
    s.pairBasis === 'guess' ||
    s.node.holdingBasis === 'guess' ||
    s.node.kind === 'renewal' ||
    s.node.kind === 'payback' ||
    (s.via && (s.via.startsWith('away:') || s.via.startsWith('held:')))
      ? { status: 'matched' as const, gap: 'matched_unconfirmed' as const }
      : { status: 'verified' as const };
  const per = Math.max(
    20,
    Math.floor(opts.budget / Math.max(1, roots.back.length + roots.forward.length)),
  );
  const o = { ...opts, budget: per };

  const back = (s: TraceStep) => {
    stepNode(s);
    for (const st of s.starts) {
      const gap = GAP_START[st.kind];
      const id = `start:${st.kind}:${s.node.id}`;
      b.node({
        id,
        kind: 'source',
        column: 0,
        start: st.kind,
        date: s.node.date,
        ...(gap ? { gap } : {}),
      });
      b.link(
        id,
        stepId(s),
        st.amount,
        gap ? { status: 'gap', gap } : { status: 'verified' },
        s.node.date,
      );
    }
    if (s.small > TINY) {
      const id = `small:${s.node.id}`;
      b.node({ id, kind: 'other', column: 0, date: s.node.date });
      b.link(id, stepId(s), s.small, { status: 'verified' }, s.node.date);
    }
    for (const c of s.steps) {
      back(c);
      b.link(stepId(c), stepId(s), c.amount, stepStatus(c), s.node.date);
    }
  };
  const fwd = (s: TraceStep) => {
    stepNode(s);
    for (const l of s.left) {
      const id = `now:${l.assetId}`;
      b.node({
        id,
        kind: 'holding',
        column: 0,
        end: 'still',
        holding: l.assetId,
        holdingKind: holdingKind(ctx, l.assetId),
      });
      b.link(stepId(s), id, l.amount, { status: 'verified' }, s.node.date);
    }
    for (const e of s.ends) {
      const gap = GAP_END[e.kind];
      const id = e.assetId && gap ? `end:${e.kind}:${e.assetId}` : `end:${e.kind}`;
      b.node({
        id,
        kind: 'end',
        column: 0,
        end: e.kind,
        ...(e.assetId ? { holding: e.assetId } : {}),
        ...(gap ? { gap } : {}),
      });
      b.link(
        stepId(s),
        id,
        e.amount,
        gap ? { status: 'gap', gap } : { status: 'verified' },
        s.node.date,
      );
    }
    if (s.small > TINY) {
      const id = `fsmall:${s.node.id}`;
      b.node({ id, kind: 'other', column: 0, date: s.node.date });
      b.link(stepId(s), id, s.small, { status: 'verified' }, s.node.date);
    }
    for (const c of s.steps) {
      fwd(c);
      b.link(stepId(s), stepId(c), c.amount, stepStatus(c), c.node.date);
    }
  };

  for (const l of roots.back) {
    const t = traceBack(chain, l.node, o, l.amount);
    if (!t) continue;
    if (focusId && stepHolding(t) === roots.focus) {
      // the step that booked or bought the holding is the holding itself: what led to it leads straight to the holding
      for (const st of t.starts) {
        const gap = GAP_START[st.kind];
        const id = `start:${st.kind}:${t.node.id}`;
        b.node({
          id,
          kind: 'source',
          column: 0,
          start: st.kind,
          date: t.node.date,
          ...(gap ? { gap } : {}),
        });
        b.link(
          id,
          focusId,
          st.amount,
          gap ? { status: 'gap', gap } : { status: 'verified' },
          t.node.date,
        );
      }
      for (const c of t.steps) {
        back(c);
        b.link(stepId(c), focusId, c.amount, stepStatus(c), t.node.date);
      }
      if (t.small > TINY) {
        const id = `small:${t.node.id}`;
        b.node({ id, kind: 'other', column: 0, date: t.node.date });
        b.link(id, focusId, t.small, { status: 'verified' }, t.node.date);
      }
      continue;
    }
    back(t);
    if (focusId) b.link(stepId(t), focusId, t.amount, stepStatus(t), t.node.date);
  }
  for (const l of roots.forward) {
    const t = traceForward(chain, l.node, o, l.amount);
    if (!t) continue;
    fwd(t);
    if (focusId) b.link(focusId, stepId(t), t.amount, stepStatus(t), t.node.date);
  }
  const g = b.done(-1);
  layerByPath(g);
  g.total = g.nodes.filter((n) => n.column === 0).reduce((s, n) => s + n.value, 0);
  return g;
}

/** The holding the money of a step is in after it: where a line in arrived, the deposit or fund a line out booked. */
function stepHolding(s: TraceStep): string {
  const n = s.node;
  if (n.amount < 0 && n.holding) return n.holding;
  if (n.amount < 0 && s.pair) return s.pair.assetId;
  return n.assetId;
}

/** Columns for a graph that runs forward in time: each node one column after the furthest node that leads to it. */
function layerByPath(g: FlowGraph) {
  const into = new Map<string, string[]>();
  for (const l of g.links) into.set(l.target, [...(into.get(l.target) ?? []), l.source]);
  const col = new Map<string, number>();
  const visit = (id: string, seen: Set<string>): number => {
    if (col.has(id)) return col.get(id)!;
    if (seen.has(id)) return 0;
    seen.add(id);
    const c = Math.max(-1, ...(into.get(id) ?? []).map((x) => visit(x, seen))) + 1;
    col.set(id, c);
    return c;
  };
  for (const n of g.nodes) n.column = visit(n.id, new Set());
}

// ------------------------------------------------------------------------------------------------------------------------------
// keeping a column readable, and checking the totals

/** Folds the smallest nodes of each column into one "other" node when a column has more than `most`. */
export function foldColumns(g: FlowGraph, most: number): FlowGraph {
  const byCol = new Map<number, FlowNode[]>();
  for (const n of g.nodes) byCol.set(n.column, [...(byCol.get(n.column) ?? []), n]);
  const rename = new Map<string, string>();
  const nodes: FlowNode[] = [];
  for (const [c, ns] of byCol) {
    if (ns.length <= most) {
      nodes.push(...ns);
      continue;
    }
    const sorted = [...ns].sort((a, b) => b.value - a.value);
    nodes.push(...sorted.slice(0, most - 1));
    const rest = sorted.slice(most - 1);
    const id = `other:${c}`;
    for (const n of rest) rename.set(n.id, id);
    nodes.push({
      id,
      kind: 'other',
      column: c,
      value: rest.reduce((s, n) => s + n.value, 0),
      folded: rest.length,
    });
  }
  const merged = new Map<string, FlowLink>();
  for (const l of g.links) {
    const source = rename.get(l.source) ?? l.source;
    const target = rename.get(l.target) ?? l.target;
    if (source === target) continue;
    const k = `${source}→${target}|${l.status}|${l.gap ?? ''}`;
    const cur = merged.get(k);
    if (cur) {
      cur.amount += l.amount;
      cur.count += l.count;
      if (l.first < cur.first) cur.first = l.first;
      if (l.last > cur.last) cur.last = l.last;
    } else merged.set(k, { ...l, source, target });
  }
  return { nodes, links: [...merged.values()], total: g.total };
}

export interface FlowCheck {
  label: string;
  expected: number;
  shown: number;
  ok: boolean;
}

/**
 * The overview against the trail itself: what enters the first column leaves the last one (nothing made up or lost on the way), and,
 * with no filter, the money still held equals the trail's own total of today's money (the completeness panel's figure).
 */
export function checkOverview(g: FlowGraph, trailTotalNow: number | null): FlowCheck[] {
  const sum = (ns: FlowNode[]) => ns.reduce((s, n) => s + n.value, 0);
  const first = sum(g.nodes.filter((n) => n.column === 0));
  const last = sum(g.nodes.filter((n) => n.column === 2));
  const still = sum(g.nodes.filter((n) => n.column === 2 && n.end === 'still'));
  const checks: FlowCheck[] = [
    {
      label: 'Money in at the start equals money at the end',
      expected: first,
      shown: last,
      ok: Math.abs(first - last) <= Math.max(1, first * 1e-6),
    },
  ];
  if (trailTotalNow !== null)
    checks.push({
      label: 'Money still held equals the trail’s total of today’s money',
      expected: trailTotalNow,
      shown: still,
      ok: Math.abs(trailTotalNow - still) <= Math.max(1, trailTotalNow * 1e-6),
    });
  return checks;
}
