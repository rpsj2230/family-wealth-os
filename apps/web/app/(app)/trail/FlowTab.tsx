import Link from 'next/link';
import {
  chainCoverage,
  checkOverview,
  END_LABEL,
  foldColumns,
  GAP_LABEL,
  holdingKind,
  holdingSources,
  journeyFlows,
  movementFlows,
  overviewFlows,
  type FlowContext,
  type FlowFilter,
  type FlowGraph,
  type FlowNode,
  type HoldingKind,
  type OriginKind,
} from '@fwos/core';
import type { MoneyTrailData } from '@fwos/data';
import {
  FlowDiagram,
  type DiagramLink,
  type DiagramNode,
  type FlowRole,
} from '@/components/FlowDiagram';
import { Tabs } from '@/components/Tabs';
import { niceDate } from '@/lib/dates';
import './trail.css';

/** The Money trail page's tabs: the details (as before), the flow diagram and the flow tree. */
export const TRAIL_TABS = [
  { key: 'details', label: 'Details' },
  { key: 'flow', label: 'Flow diagram' },
  { key: 'tree', label: 'Flow tree' },
];

/** The query of the flow tab: the view, the filters and the holding or line a journey is about. */
export interface FlowParams {
  view?: string;
  fy?: string;
  from?: string;
  to?: string;
  owner?: string;
  bank?: string;
  acct?: string;
  src?: string;
  kind?: string;
  status?: string;
  mid?: string;
  right?: string;
  h?: string;
  l?: string;
}

export interface FlowPageContext {
  data: MoneyTrailData;
  labels: Record<string, string>;
  names: Record<string, string>;
  banks: Record<string, string>;
  meta: Record<string, { owner: string; type: string }>;
  /** the Money trail page's own address, and where a line's and a holding's pages are */
  base: string;
  lineHref: (assetId: string, lineId: string) => string;
  assetHref: (assetId: string) => string;
}

export const SOURCE_LABEL: Record<OriginKind, string> = {
  singapore: 'Singapore (Wise or DBS)',
  interest: 'Savings interest',
  deposit_interest: 'Deposit interest',
  fund_gain: 'Fund profit',
  rent: 'Rent and earnings',
  outside: 'Money from outside',
  before_records: 'There before the first statement',
  untraced_account: 'Account with no statement on file',
  untraced_deposit: 'Deposit booked before the statements',
  untraced_fund: 'Fund bought outside the statements',
  unexplained: 'Origin unknown (not answered yet)',
};
const SOURCE_ROLE: Record<OriginKind, FlowRole> = {
  singapore: 'singapore',
  interest: 'earning',
  deposit_interest: 'earning',
  fund_gain: 'earning',
  rent: 'earning',
  outside: 'source',
  before_records: 'source',
  untraced_account: 'gap',
  untraced_deposit: 'gap',
  untraced_fund: 'gap',
  unexplained: 'gap',
};
const KIND_ROLE: Record<HoldingKind, FlowRole> = {
  account: 'account',
  deposit: 'deposit',
  fund: 'fund',
  outside: 'outside',
  held: 'outside',
};
const KIND_LABEL: Record<HoldingKind, string> = {
  account: 'Now in bank accounts',
  deposit: 'Now in fixed deposits',
  fund: 'Now in mutual funds',
  outside: 'Now in accounts with no statement on file',
  held: 'Now in deposits not on file',
};
const VIEWS = [
  { key: 'overview', label: 'Where it started → where it is' },
  { key: 'movements', label: 'Movements between holdings' },
  { key: 'journey', label: 'One holding’s journey' },
];
const KIND_OPTIONS: { key: HoldingKind; label: string }[] = [
  { key: 'account', label: 'Bank accounts' },
  { key: 'deposit', label: 'Fixed deposits' },
  { key: 'fund', label: 'Mutual funds' },
  { key: 'outside', label: 'Accounts with no statement' },
];

const iso = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
const fyBounds = (fy: string) => {
  const y = Number(fy.slice(0, 4));
  return { from: `${y}-04-01`, to: `${y + 1}-03-31` };
};

/** Holding kinds, owners and banks for the flow views. */
export function flowContextOf(c: FlowPageContext): FlowContext {
  const kindOfHolding = new Map(c.data.holdings.map((h) => [h.id, h.kind]));
  return {
    kindOf: (h) => {
      const k = kindOfHolding.get(h);
      if (k) return k;
      const t = c.meta[h]?.type;
      return t === 'fixed_deposit'
        ? 'deposit'
        : t === 'mutual_fund'
          ? 'fund'
          : t
            ? 'account'
            : c.data.chain.into.has(h)
              ? 'deposit'
              : null;
    },
    ownerOf: (h) => c.meta[h]?.owner ?? c.data.holdings.find((x) => x.id === h)?.ownerId ?? null,
    bankOf: (h) => c.banks[h] ?? null,
  };
}

/** A holding's name, including the places the trail keeps money it cannot follow into a statement. */
export function holdingName(c: FlowPageContext, id: string): string {
  if (id.startsWith('away:'))
    return `${c.names[id.slice(5)] ?? 'Someone'}’s accounts with no statement on file`;
  if (id.startsWith('held:'))
    return `Deposit not on file (from ${c.labels[id.slice(5)] ?? 'an account'})`;
  return c.labels[id] ?? 'A holding not on file';
}

/** The money trail's flows as a diagram: the view, its filters, the diagram, and the check of its totals against the trail. */
export function FlowTab({ c, p }: { c: FlowPageContext; p: FlowParams }) {
  const chain = c.data.chain;
  const ctx = flowContextOf(c);
  const view =
    p.view === 'movements' || p.view === 'journey' ? p.view : p.h || p.l ? 'journey' : 'overview';
  const fy = p.fy && /^\d{4}-\d{2}$/.test(p.fy) ? p.fy : '';
  const range = fy ? fyBounds(fy) : { from: iso(p.from), to: iso(p.to) };
  const bankHoldings = p.bank
    ? Object.entries(c.banks)
        .filter(([, b]) => b === p.bank)
        .map(([id]) => id)
    : [];
  const sources = p.src && p.src in SOURCE_LABEL ? [p.src as OriginKind] : [];
  const kinds = KIND_OPTIONS.some((k) => k.key === p.kind) ? [p.kind as HoldingKind] : [];
  const filter: FlowFilter = {
    ...(range.from ? { from: range.from } : {}),
    ...(range.to ? { to: range.to } : {}),
    ...(p.owner ? { owners: [p.owner] } : {}),
    ...(p.acct ? { holdings: [p.acct] } : bankHoldings.length ? { holdings: bankHoldings } : {}),
    ...(sources.length ? { sources } : {}),
    ...(kinds.length ? { kinds } : {}),
    ...(p.status === 'verified' || p.status === 'unverified' ? { status: p.status } : {}),
  };
  const filtered = Object.keys(filter).length > 0;

  // years with money in the trail, newest first
  const years = [...new Set([...chain.nodes.values()].map((n) => n.date.slice(0, 7)))]
    .map((m) => (Number(m.slice(5)) >= 4 ? Number(m.slice(0, 4)) : Number(m.slice(0, 4)) - 1))
    .filter((y) => y > 1990);
  const fys = [...new Set(years)]
    .sort((a, b) => b - a)
    .map((y) => `${y}-${String((y + 1) % 100).padStart(2, '0')}`);
  const banks = [...new Set(Object.values(c.banks))].sort();
  const holdingOptions = c.data.holdings
    .map((h) => ({ id: h.id, label: c.labels[h.id] ?? h.id }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const presentSources = (Object.keys(SOURCE_LABEL) as OriginKind[]).filter((k) =>
    [...chain.nodes.values()].some((n) => n.starts.some((s) => s.kind === k)),
  );

  let graph: FlowGraph;
  let columnTitles: string[] | undefined;
  let checks: ReturnType<typeof checkOverview> = [];
  let journeyOf: string | null = null;
  if (view === 'journey') {
    const line = p.l && chain.nodes.has(p.l) ? p.l : null;
    const h = !line && p.h ? p.h : null;
    journeyOf = line ? 'line' : h;
    graph = line
      ? journeyFlows(
          chain,
          ctx,
          {
            back: [
              {
                node: line,
                amount: Math.abs(chain.nodes.get(line)!.amount),
                basis: 'same_account',
              },
            ],
            forward: [
              {
                node: line,
                amount: Math.abs(chain.nodes.get(line)!.amount),
                basis: 'same_account',
              },
            ],
          },
          { ...c.data.traceOptions, budget: Math.min(c.data.traceOptions.budget, 160) },
        )
      : h
        ? journeyFlows(
            chain,
            ctx,
            {
              back: holdingSources(chain, h),
              forward: chain.outOf.get(h) ?? [],
              focus: h,
            },
            { ...c.data.traceOptions, budget: Math.min(c.data.traceOptions.budget, 160) },
          )
        : { nodes: [], links: [], total: 0 };
  } else if (view === 'movements') {
    graph = foldColumns(movementFlows(chain, ctx, filter), 16);
    columnTitles = ['Money moved from', 'Money moved to'];
  } else {
    const full = overviewFlows(chain, ctx, filter, {
      middle: p.mid === 'bank' ? 'bank' : 'holding',
      right: p.right === 'kind' ? 'kind' : 'holding',
    });
    const coverage = chainCoverage(chain, (h) => ctx.kindOf(h));
    checks = checkOverview(full, filtered ? null : coverage.total);
    graph = foldColumns(full, 16);
    columnTitles = [
      'Where it started',
      'Where it first came in',
      'Where it is now, or where it went',
    ];
  }

  const keep = (extra: Record<string, string>) => {
    const q = new URLSearchParams({ tab: 'flow' });
    for (const [k, v] of Object.entries(extra)) if (v) q.set(k, v);
    return `${c.base}?${q.toString()}`;
  };
  const nodes = graph.nodes.map((n) => diagramNode(c, n, keep));
  const links: DiagramLink[] = graph.links.map((l) => ({
    source: l.source,
    target: l.target,
    amount: l.amount,
    status: l.status,
    note:
      l.status === 'verified'
        ? 'Verified'
        : GAP_LABEL[l.gap ?? (l.status === 'matched' ? 'matched_unconfirmed' : 'unverified')],
    count: l.count,
    first: l.first,
    last: l.last,
  }));
  const totals = {
    verified: graph.links.filter((l) => l.status === 'verified').reduce((s, l) => s + l.amount, 0),
    matched: graph.links.filter((l) => l.status === 'matched').reduce((s, l) => s + l.amount, 0),
    gap: graph.links.filter((l) => l.status === 'gap').reduce((s, l) => s + l.amount, 0),
  };
  const all = totals.verified + totals.matched + totals.gap;
  const pct = (v: number) => `${all > 0 ? Math.round((v / all) * 100) : 0}%`;

  return (
    <section className="card" aria-labelledby="fl-h" data-testid="flow-tab">
      <h2 id="fl-h">Money flow</h2>
      <div className="fl-views">
        <Tabs
          base={c.base}
          current={view}
          param="view"
          tabs={VIEWS}
          keep={{ tab: 'flow', ...(p.h ? { h: p.h } : {}) }}
        />
      </div>
      <p className="muted small">
        {view === 'overview'
          ? 'Each rupee once: where it started, the account or deposit it first came into, and where it is now or where it left the trail. Money that went round (a deposit paid back and booked again) is counted once.'
          : view === 'movements'
            ? 'Every movement between holdings in the period, each once. A holding is on both sides, so money that goes from savings to a deposit and back shows as two movements. The same rupee can move more than once, so this adds up movements, not money held.'
            : 'One holding’s money step by step: back to where it started, and forward to where it is now. Each dated step is a point; an account visited twice is two points, in time order.'}
      </p>

      <details className="fl-filterbox" open={filtered || view === 'journey'}>
        <summary>
          {view === 'journey' ? 'Choose the holding' : 'Filters'}
          {filtered && view !== 'journey' ? ` (${Object.keys(filter).length} on)` : ''}
        </summary>
        <form method="get" action={c.base} className="fl-filters" data-testid="flow-filters">
          <input type="hidden" name="tab" value="flow" />
          <input type="hidden" name="view" value={view} />
          {view === 'journey' ? (
            <label>
              Holding
              <select name="h" defaultValue={p.h ?? ''}>
                <option value="">Choose a holding</option>
                {holdingOptions.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.label}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <>
              <label>
                Financial year
                <select name="fy" defaultValue={fy}>
                  <option value="">All years</option>
                  {fys.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                From
                <input type="date" name="from" defaultValue={fy ? '' : (p.from ?? '')} />
              </label>
              <label>
                To
                <input type="date" name="to" defaultValue={fy ? '' : (p.to ?? '')} />
              </label>
              <label>
                Person
                <select name="owner" defaultValue={p.owner ?? ''}>
                  <option value="">Everyone</option>
                  {Object.entries(c.names).map(([id, n]) => (
                    <option key={id} value={id}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Bank
                <select name="bank" defaultValue={p.bank ?? ''}>
                  <option value="">All banks</option>
                  {banks.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Account or holding
                <select name="acct" defaultValue={p.acct ?? ''}>
                  <option value="">All</option>
                  {holdingOptions.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Money source
                <select name="src" defaultValue={p.src ?? ''}>
                  <option value="">All sources</option>
                  {presentSources.map((k) => (
                    <option key={k} value={k}>
                      {SOURCE_LABEL[k]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Holding type
                <select name="kind" defaultValue={p.kind ?? ''}>
                  <option value="">All types</option>
                  {KIND_OPTIONS.map((k) => (
                    <option key={k.key} value={k.key}>
                      {k.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Status
                <select name="status" defaultValue={p.status ?? ''}>
                  <option value="">Verified and unverified</option>
                  <option value="verified">Verified only</option>
                  <option value="unverified">Unverified and missing only</option>
                </select>
              </label>
              {view === 'overview' && (
                <>
                  <label>
                    Came in, by
                    <select name="mid" defaultValue={p.mid ?? ''}>
                      <option value="">Account</option>
                      <option value="bank">Bank</option>
                    </select>
                  </label>
                  <label>
                    Now, by
                    <select name="right" defaultValue={p.right ?? ''}>
                      <option value="">Holding</option>
                      <option value="kind">Type of holding</option>
                    </select>
                  </label>
                </>
              )}
            </>
          )}
          <button className="btn compact primary">Show</button>
          <Link className="btn compact ghost" href={keep({ view })}>
            Reset
          </Link>
        </form>
      </details>

      {view === 'journey' && !journeyOf ? (
        <p className="small" data-testid="flow-choose">
          Choose a holding above, or tap a box in the other views, to see its money step by step.
        </p>
      ) : (
        <FlowDiagram
          nodes={nodes}
          links={links}
          {...(columnTitles ? { columnTitles } : {})}
          label={`Money flow: ${VIEWS.find((v) => v.key === view)!.label}`}
        />
      )}

      {all > 0 && (
        <p className="small" data-testid="flow-status">
          Of the money shown: verified {pct(totals.verified)}, matched by amount and date{' '}
          {pct(totals.matched)}, missing or unverified {pct(totals.gap)}.
        </p>
      )}
      {checks.length > 0 && (
        <ul
          className="plain small fl-checks"
          data-testid="flow-checks"
          aria-label="Checks against the money trail"
        >
          {checks.map((k) => (
            <li key={k.label}>
              <span className={k.ok ? 'ok' : 'fail'}>{k.ok ? '✓' : '✗'}</span> {k.label}:{' '}
              {`₹${Math.round(k.shown).toLocaleString('en-IN')}`}
              {k.ok ? '' : ` (expected ₹${Math.round(k.expected).toLocaleString('en-IN')})`}
            </li>
          ))}
        </ul>
      )}
      <p className="small">
        <Link href={`${c.base}?tab=details${p.h ? `&h=${p.h}` : ''}`}>
          Back to the money trail details
        </Link>
      </p>
    </section>
  );
}

function diagramNode(
  c: FlowPageContext,
  n: FlowNode,
  keep: (extra: Record<string, string>) => string,
): DiagramNode {
  const base = { id: n.id, column: n.column, value: n.value };
  const holdingLinks = (h: string) =>
    h.startsWith('away:') || h.startsWith('held:')
      ? []
      : [
          { label: 'Its journey', href: keep({ view: 'journey', h }) },
          { label: 'Open its page', href: c.assetHref(h) },
        ];
  if (n.kind === 'source' && n.start)
    return {
      ...base,
      label: SOURCE_LABEL[n.start],
      ...(n.date ? { sub: niceDate(n.date) } : {}),
      role: SOURCE_ROLE[n.start],
      ...(n.gap ? { gap: GAP_LABEL[n.gap] } : {}),
      links: [
        { label: 'Follow this money', href: keep({ view: 'movements', src: n.start }) },
        { label: 'As a tree', href: `${c.base}?tab=tree&src=${n.start}` },
      ],
    };
  if (n.kind === 'bank')
    return {
      ...base,
      label: n.bank ?? 'A bank',
      role: 'account',
      links: [{ label: 'This bank only', href: keep({ bank: n.bank ?? '' }) }],
    };
  if (n.kind === 'group' && n.holdingKind)
    return { ...base, label: KIND_LABEL[n.holdingKind], role: KIND_ROLE[n.holdingKind] };
  if (n.kind === 'end' && n.end && n.end !== 'still') {
    const gap = n.gap ? GAP_LABEL[n.gap] : undefined;
    return {
      ...base,
      label: n.holding ? holdingName(c, n.holding) : END_LABEL[n.end],
      ...(n.holding ? { sub: gap ?? END_LABEL[n.end] } : {}),
      role: n.gap ? 'gap' : 'end',
      ...(gap ? { gap } : {}),
      ...(n.holding ? { links: holdingLinks(n.holding) } : {}),
    };
  }
  if (n.kind === 'other')
    return {
      ...base,
      label: n.folded ? `${n.folded} smaller, together` : 'Smaller parts together',
      role: 'other',
    };
  if (n.kind === 'step' && n.holding) {
    const step = n.step ? c.data.chain.nodes.get(n.step) : undefined;
    return {
      ...base,
      label: holdingName(c, n.holding),
      ...(n.date ? { sub: niceDate(n.date) } : {}),
      role: KIND_ROLE[n.holdingKind ?? 'account'],
      links: [
        ...(step && step.kind === 'line'
          ? [
              { label: 'Open the transaction', href: c.lineHref(step.assetId, step.id) },
              { label: 'Its own journey', href: keep({ view: 'journey', l: step.id }) },
            ]
          : []),
        ...holdingLinks(n.holding),
      ],
    };
  }
  const h = n.holding ?? '';
  return {
    ...base,
    label: holdingName(c, h),
    ...(n.id.startsWith('focus:')
      ? { sub: 'The holding you chose' }
      : n.end === 'still'
        ? { sub: 'Still there' }
        : {}),
    role: KIND_ROLE[n.holdingKind ?? holdingKind({ kindOf: () => null, ownerOf: () => null }, h)],
    links: holdingLinks(h),
  };
}
