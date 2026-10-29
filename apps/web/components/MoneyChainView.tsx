import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  END_LABEL,
  formatInrCompact,
  REAL_STARTS,
  type ChainCoverage,
  endPoints,
  formatInr,
  formatPct,
  holdingSources,
  LINE_CLASS_LABEL,
  mainPath,
  ORIGIN_LABEL,
  pointsOf,
  startPoints,
  traceBack,
  traceForward,
  type ChainLink,
  type ChainNode,
  type EndPoint,
  type MoneyChain,
  type StartPoint,
  type TraceOptions,
  type TraceStep,
} from '@fwos/core';
import { niceDate } from '@/lib/dates';
import '@/app/(app)/trail/trail.css';

/** What the chain views need to name and link every step. */
export interface ChainContext {
  chain: MoneyChain;
  opts: TraceOptions;
  labels: Record<string, string>;
  names: Record<string, string>;
  /** the transfers from Singapore on file, by id */
  remitById: Map<string, { receivedOn: string; amount: number }>;
  /** the page of a statement line */
  lineHref: (assetId: string, lineId: string) => string;
  /** the page of a holding */
  assetHref: (assetId: string) => string;
}

const inr = (n: number) => formatInr(Math.round(n));
/** trees open this many steps deep; the rest open with a tap */
const OPEN_STEPS = 2;
/** at most this many trees for one holding (the largest parts); the summary still counts everything */
const MOST_TREES = 12;

const nameOf = (c: ChainContext, id: string | null | undefined) => {
  if (!id) return 'an account with no statement on file';
  if (id.startsWith('away:'))
    return `${c.names[id.slice(5)] ?? 'someone'}’s accounts with no statement on file`;
  if (id.startsWith('held:'))
    return `a deposit not on file, booked from ${c.labels[id.slice(5)] ?? 'this account'}`;
  return c.labels[id] ?? 'a holding not on file';
};
const isFundLine = (n: ChainNode) => n.cls === 'fund_buy' || n.cls === 'fund_sell';

/** One step in words: what happened, where. */
function stepTitle(s: TraceStep, c: ChainContext): string {
  const n = s.node;
  if (n.kind === 'opening')
    return `${nameOf(c, n.assetId)}: already in the account before its first statement`;
  if (n.kind === 'deposit_before')
    return n.from.length
      ? `${nameOf(c, n.assetId)}: booked from money sent to accounts with no statement on file`
      : `${nameOf(c, n.assetId)}: booked with money the statements on file do not show`;
  if (n.kind === 'payback')
    return `${nameOf(c, n.assetId)}: paid back into an account with no statement on file`;
  if (n.kind === 'renewal')
    return `${nameOf(c, n.assetId)}: renewed from the deposit that ended that day`;
  if (s.pair) {
    const [out, inn] = n.amount < 0 ? [n, s.pair] : [s.pair, n];
    return `Transfer from ${nameOf(c, out.assetId)} to ${nameOf(c, inn.assetId)}`;
  }
  if (n.amount < 0) {
    if (n.holding)
      return `${isFundLine(n) ? 'Bought' : 'Booked'} ${nameOf(c, n.holding)} from ${nameOf(c, n.assetId)}`;
    return `Out of ${nameOf(c, n.assetId)}: ${n.cls ? LINE_CLASS_LABEL[n.cls].toLowerCase() : 'money out'}`;
  }
  if (n.holding)
    return `${nameOf(c, n.holding)} ${isFundLine(n) ? 'sold' : 'paid back'} into ${nameOf(c, n.assetId)}`;
  // money that starts here and came from nowhere the statements follow: say where it came from
  const top =
    n.from.length === 0 ? [...n.starts].sort((a, b) => b.amount - a.amount)[0] : undefined;
  if (top) return `${ORIGIN_LABEL[top.kind]} into ${nameOf(c, n.assetId)}`;
  return `Into ${nameOf(c, n.assetId)}: ${n.cls ? LINE_CLASS_LABEL[n.cls].toLowerCase() : 'money in'}`;
}

/** The date or dates of a step, and the bank's words. */
function stepMeta(s: TraceStep): string {
  const dates = s.pair && s.pair.date !== s.node.date ? [s.pair, s.node] : [s.node];
  const when = dates
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((x) => niceDate(x.date))
    .join(' → ');
  const words = (s.pair && s.node.amount > 0 ? s.pair : s.node).narration;
  return [when, words ? words.slice(0, 70) : null].filter(Boolean).join(' · ');
}

/** "matched by amount and date" wherever the step is a match made here, not the bank's or the records' own link */
function guessed(s: TraceStep) {
  return (
    s.pairBasis === 'guess' ||
    s.basis === 'guess' ||
    s.node.holdingBasis === 'guess' ||
    s.node.kind === 'renewal' ||
    s.node.kind === 'payback'
  );
}

function StepRow({ s, c, followed }: { s: TraceStep; c: ChainContext; followed: number }) {
  const n = s.node;
  const line = n.kind === 'line' ? n : null;
  const whole = Math.abs(n.amount);
  return (
    <span className="ch-row">
      <span className="ch-what">
        {line ? (
          <Link href={c.lineHref(line.assetId, line.id)}>{stepTitle(s, c)}</Link>
        ) : (
          stepTitle(s, c)
        )}
        {s.via && <span className="ch-via"> through {nameOf(c, s.via)}</span>}
        <span className="muted small ch-meta">
          {' '}
          {stepMeta(s)}
          {guessed(s) ? ' · matched by amount and date' : ''}
        </span>
      </span>
      <span className="ch-amt">
        <strong>{inr(s.amount)}</strong>
        {whole - s.amount > 1 && <span className="muted small"> of {inr(whole)}</span>}
        {followed > 0 && (
          <span className="muted small"> · {formatPct(s.amount / followed, 0)}</span>
        )}
      </span>
    </span>
  );
}

function startText(
  p: { kind: StartPoint['kind']; assetId?: string | null; remittanceId?: string },
  c: ChainContext,
) {
  const r = p.remittanceId ? c.remitById.get(p.remittanceId) : undefined;
  const detail =
    p.kind === 'singapore' && r
      ? `Wise transfer received ${niceDate(r.receivedOn)}`
      : p.assetId &&
          (p.kind === 'untraced_account' ||
            p.kind.endsWith('interest') ||
            p.kind === 'untraced_deposit' ||
            p.kind === 'untraced_fund' ||
            p.kind === 'fund_gain')
        ? nameOf(c, p.assetId)
        : null;
  return `${ORIGIN_LABEL[p.kind]}${detail ? ` (${detail})` : ''}`;
}

function Leaf({ kind, children, amount }: { kind: string; children: ReactNode; amount: number }) {
  return (
    <li className="ch-leaf">
      <span className="ch-row">
        <span className="ch-what">
          <span className={`tr-swatch tr-${kind}`} aria-hidden="true" /> {children}
        </span>
        <span className="ch-amt">
          <strong>{inr(amount)}</strong>
        </span>
      </span>
    </li>
  );
}

/** A step and the steps behind (or after) it, as nested lists that open with a tap. */
function Tree({
  s,
  c,
  dir,
  depth,
  followed,
}: {
  s: TraceStep;
  c: ChainContext;
  dir: 'back' | 'forward';
  depth: number;
  followed: number;
}) {
  const leaves: ReactNode[] = [];
  for (const [i, p] of s.starts.entries())
    leaves.push(
      <Leaf key={`s${i}`} kind={p.kind} amount={p.amount}>
        Started here: {startText(p, c)}
        <span className="muted small"> · {c.names[p.person] ?? 'someone'}’s money</span>
      </Leaf>,
    );
  for (const [i, l] of s.left.entries())
    leaves.push(
      <Leaf key={`l${i}`} kind="still" amount={l.amount}>
        Still in {nameOf(c, l.assetId)}
      </Leaf>,
    );
  for (const [i, e] of s.ends.entries())
    leaves.push(
      <Leaf key={`e${i}`} kind={`end-${e.kind}`} amount={e.amount}>
        {END_LABEL[e.kind]}
        {e.assetId ? ` (${nameOf(c, e.assetId)})` : ''}
      </Leaf>,
    );
  if (s.small > 0.5)
    leaves.push(
      <Leaf key="small" kind="small" amount={s.small}>
        Smaller parts, each under {inr(c.opts.smallest)}
      </Leaf>,
    );
  if (s.cut) {
    const line = s.node.kind === 'line' ? s.node : null;
    leaves.push(
      <li key="cut" className="ch-leaf muted small">
        The trail goes on{' '}
        {line ? (
          <Link href={c.lineHref(line.assetId, line.id)}>from this step’s own page</Link>
        ) : (
          'further back'
        )}
        .
      </li>,
    );
  }
  const kids = [
    ...s.steps.map((k, i) => (
      <Tree key={`t${i}`} s={k} c={c} dir={dir} depth={depth + 1} followed={followed} />
    )),
    ...leaves,
  ];
  const row = <StepRow s={s} c={c} followed={followed} />;
  return (
    <li className={depth >= 5 ? 'ch-node ch-deep' : 'ch-node'}>
      {kids.length ? (
        <details open={depth < OPEN_STEPS}>
          <summary>{row}</summary>
          <ul className="ch-kids plain">{kids}</ul>
        </details>
      ) : (
        <div className="ch-solo">{row}</div>
      )}
    </li>
  );
}

/** The holdings the money passed through along its largest share, from where it started to here (back) or to where it is (forward). */
function Path({ s, c, dir }: { s: TraceStep; c: ChainContext; dir: 'back' | 'forward' }) {
  const steps = mainPath(s);
  const ids: string[] = [];
  const add = (id: string | undefined | null) => {
    if (id && ids[ids.length - 1] !== id) ids.push(id);
  };
  const ordered = dir === 'back' ? [...steps].reverse() : steps;
  for (const x of ordered) {
    const n = x.node;
    const out = x.pair ? (n.amount < 0 ? n : x.pair) : null;
    const inn = x.pair ? (n.amount < 0 ? x.pair : n) : null;
    if (dir === 'back' && x.via) add(x.via);
    if (out && inn) {
      add(out.assetId);
      add(inn.assetId);
    } else if (n.amount < 0 && n.holding) {
      add(n.assetId);
      add(n.holding);
    } else if (n.amount > 0 && n.holding) {
      add(n.holding);
      add(n.assetId);
    } else add(n.assetId);
    if (dir === 'forward' && x.via) add(x.via);
  }
  const last = steps[steps.length - 1]!;
  const head =
    dir === 'back' && last.starts.length
      ? ORIGIN_LABEL[[...last.starts].sort((a, b) => b.amount - a.amount)[0]!.kind]
      : null;
  const tail =
    dir === 'forward'
      ? last.left.length
        ? `Still in ${nameOf(c, [...last.left].sort((a, b) => b.amount - a.amount)[0]!.assetId)}`
        : last.ends.length
          ? END_LABEL[[...last.ends].sort((a, b) => b.amount - a.amount)[0]!.kind]
          : null
      : null;
  // "Still in" the holding the path already ends at says it once
  const lastLeft =
    dir === 'forward' && last.left.length
      ? [...last.left].sort((a, b) => b.amount - a.amount)[0]!.assetId
      : null;
  const tailShown = tail && !(lastLeft && ids[ids.length - 1] === lastLeft) ? tail : null;
  if (ids.length < 2 && !head && !tailShown) return null;
  return (
    <ol className="ch-path plain" aria-label="The way most of the money went">
      {head && <li className="ch-chip ch-chip-start">{head}</li>}
      {ids.map((id) => (
        <li key={id} className="ch-chip">
          {c.labels[id] ? <Link href={c.assetHref(id)}>{c.labels[id]}</Link> : nameOf(c, id)}
        </li>
      ))}
      {tailShown && <li className="ch-chip ch-chip-start">{tailShown}</li>}
    </ol>
  );
}

/** Where the money started, in full, by kind, with the steps each part starts at. */
function Starts({ points, c }: { points: StartPoint[]; c: ChainContext }) {
  const total = points.reduce((s, p) => s + p.amount, 0);
  if (total <= 0.5) return null;
  const groups = new Map<string, StartPoint[]>();
  for (const p of points) groups.set(p.kind, [...(groups.get(p.kind) ?? []), p]);
  const kinds = [...groups].sort(
    (a, b) => b[1].reduce((s, p) => s + p.amount, 0) - a[1].reduce((s, p) => s + p.amount, 0),
  );
  return (
    <>
      <div className="tr-bar" aria-hidden="true">
        {kinds.map(([k, ps]) => (
          <span
            key={k}
            className={`tr-cut tr-${k}`}
            style={{ width: `${(ps.reduce((s, p) => s + p.amount, 0) / total) * 100}%` }}
          />
        ))}
      </div>
      <ul className="tr-parts plain" data-testid="chain-starts">
        {kinds.map(([k, ps]) => {
          const amt = ps.reduce((s, p) => s + p.amount, 0);
          return (
            <li key={k} className="ch-group">
              <span className={`tr-swatch tr-${k}`} aria-hidden="true" />
              <span className="tr-what">
                {ORIGIN_LABEL[k as StartPoint['kind']]}
                {ps.length > 1 && <span className="muted small"> · {ps.length} parts</span>}
                <ul className="plain small ch-items">
                  {ps.slice(0, 6).map((p, i) => {
                    const at = c.chain.nodes.get(p.node);
                    const text = `${
                      startText(p, c)
                        .replace(`${ORIGIN_LABEL[p.kind]}`, '')
                        .replace(/^ \((.*)\)$/, '$1') || niceDate(p.date)
                    } · ${c.names[p.person] ?? 'someone'}’s money`;
                    return (
                      <li key={i}>
                        {at && at.kind === 'line' ? (
                          <Link href={c.lineHref(at.assetId, at.id)}>{text}</Link>
                        ) : (
                          text
                        )}{' '}
                        <span className="muted">{inr(p.amount)}</span>
                      </li>
                    );
                  })}
                  {ps.length > 6 && (
                    <li className="muted">
                      and {ps.length - 6} more, {inr(ps.slice(6).reduce((s, p) => s + p.amount, 0))}
                    </li>
                  )}
                </ul>
              </span>
              <strong>{inr(amt)}</strong>
              <span className="muted small">{formatPct(amt / total, 0)}</span>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** Where the money is now, in full: still in a holding, spent, sent to an account not on file. */
function Ends({ points, c }: { points: EndPoint[]; c: ChainContext }) {
  const total = points.reduce((s, p) => s + p.amount, 0);
  if (total <= 0.5) return null;
  return (
    <ul className="tr-parts plain" data-testid="chain-ends">
      {points.slice(0, 15).map((p, i) => {
        const at = c.chain.nodes.get(p.node);
        const what =
          p.kind === 'still'
            ? `Still in ${nameOf(c, p.assetId)}`
            : `${END_LABEL[p.kind]}${p.assetId ? ` (${nameOf(c, p.assetId)})` : ''}`;
        return (
          <li key={i}>
            <span className={`tr-swatch tr-end-${p.kind}`} aria-hidden="true" />
            <span className="tr-what">
              {p.kind === 'still' && p.assetId && c.labels[p.assetId] ? (
                <Link href={c.assetHref(p.assetId)}>{what}</Link>
              ) : at &&
                at.kind === 'line' &&
                p.kind !== 'spent' &&
                p.kind !== 'fee' &&
                p.kind !== 'tax' ? (
                <Link href={c.lineHref(at.assetId, at.id)}>{what}</Link>
              ) : (
                what
              )}
            </span>
            <strong>{inr(p.amount)}</strong>
            <span className="muted small">{formatPct(p.amount / total, 0)}</span>
          </li>
        );
      })}
      {points.length > 15 && (
        <li className="muted small">
          and {points.length - 15} more, {inr(points.slice(15).reduce((s, p) => s + p.amount, 0))}
        </li>
      )}
    </ul>
  );
}

/** Several trees (a holding's parts), the largest first, sharing the steps a page shows. */
function Forest({
  links,
  c,
  dir,
}: {
  links: ChainLink[];
  c: ChainContext;
  dir: 'back' | 'forward';
}) {
  const sorted = [...links].sort((a, b) => b.amount - a.amount);
  const shown = sorted.slice(0, MOST_TREES);
  const opts = {
    ...c.opts,
    budget: Math.max(20, Math.floor(c.opts.budget / Math.max(1, shown.length))),
  };
  const total = sorted.reduce((s, l) => s + l.amount, 0);
  const trees = shown
    .map((l) =>
      dir === 'back'
        ? traceBack(c.chain, l.node, opts, l.amount)
        : traceForward(c.chain, l.node, opts, l.amount),
    )
    .filter((t): t is TraceStep => !!t);
  const rest = sorted.slice(MOST_TREES);
  return (
    <ul className="ch-tree plain" data-testid={dir === 'back' ? 'chain-back' : 'chain-forward'}>
      {trees.map((t, i) => (
        <Tree key={i} s={t} c={c} dir={dir} depth={0} followed={total} />
      ))}
      {rest.length > 0 && (
        <li className="ch-leaf muted small">
          and {rest.length} smaller parts, {inr(rest.reduce((s, l) => s + l.amount, 0))}: open the
          account’s lines to follow them.
        </li>
      )}
    </ul>
  );
}

const HOW =
  'Each step opens its own page. Money out of an account is taken from the money that came into it before';

/** One statement line's trail: where its money started and how it got here, and where it went from here. */
export function LineChain({ c, lineId }: { c: ChainContext; lineId: string }) {
  const n = c.chain.nodes.get(lineId);
  if (!n) return null;
  const back = traceBack(c.chain, lineId, c.opts);
  const fwd = traceForward(c.chain, lineId, c.opts);
  const starts = startPoints(c.chain, lineId);
  const ends = endPoints(c.chain, lineId);
  const amt = Math.abs(n.amount);
  return (
    <div className="ch" data-testid="line-chain">
      <h3 className="tr-h3">Where its {inr(amt)} started</h3>
      <Starts points={starts} c={c} />
      {back && <Path s={back} c={c} dir="back" />}
      {back && (back.steps.length > 0 || back.starts.length > 0) && (
        <>
          <h3 className="tr-h3">Step by step, back to the start</h3>
          <ul className="ch-tree plain" data-testid="chain-back">
            <Tree s={back} c={c} dir="back" depth={0} followed={amt} />
          </ul>
        </>
      )}
      <h3 className="tr-h3">Where it went, and where it is now</h3>
      <Ends points={ends} c={c} />
      {fwd && <Path s={fwd} c={c} dir="forward" />}
      {fwd && (fwd.steps.length > 0 || fwd.left.length > 0 || fwd.ends.length > 0) && (
        <>
          <h3 className="tr-h3">Step by step, forward</h3>
          <ul className="ch-tree plain" data-testid="chain-forward">
            <Tree s={fwd} c={c} dir="forward" depth={0} followed={amt} />
          </ul>
        </>
      )}
      <p className="muted small">
        {HOW}
        {c.chain.method === 'recent'
          ? ', the latest money first'
          : ', a share of everything in the account'}{' '}
        (Settings → Clubbing and money trail). Steps marked “matched by amount and date” were linked
        here because the statements do not name the other side.
      </p>
    </div>
  );
}

/** A holding's trail: for a deposit or fund, the money that booked or bought it and where it went when paid back; for an account, where today's money came from. */
export function HoldingChain({
  c,
  assetId,
  kind,
}: {
  c: ChainContext;
  assetId: string;
  kind: 'account' | 'deposit' | 'fund';
}) {
  const src = holdingSources(c.chain, assetId);
  const out = kind === 'account' ? [] : (c.chain.outOf.get(assetId) ?? []);
  if (src.length === 0 && out.length === 0) return null;
  const starts = pointsOf((id, a) => startPoints(c.chain, id, a), src);
  const ends = pointsOf((id, a) => endPoints(c.chain, id, a), out);
  const inTotal = src.reduce((s, l) => s + l.amount, 0);
  return (
    <div className="ch" data-testid="holding-chain">
      <h3 className="tr-h3">
        {kind === 'account'
          ? `Where today’s ${inr(inTotal)} came from`
          : kind === 'deposit'
            ? `Where the ${inr(inTotal)} that booked it came from`
            : `Where the ${inr(inTotal)} that bought it came from (purchases paid from a statement on file)`}
      </h3>
      <Starts points={starts} c={c} />
      {src.length > 0 && (
        <>
          <h3 className="tr-h3">Step by step</h3>
          <Forest links={src} c={c} dir="back" />
        </>
      )}
      {out.length > 0 && (
        <>
          <h3 className="tr-h3">
            {kind === 'deposit'
              ? 'Paid back, and where the money went'
              : 'Sold, and where the money went'}
          </h3>
          <Ends points={ends} c={c} />
          <Forest links={out} c={c} dir="forward" />
        </>
      )}
      <p className="muted small">
        {HOW}
        {c.chain.method === 'recent'
          ? ', the latest money first'
          : ', a share of everything in the account'}
        . Steps marked “matched by amount and date” were linked here because the statements do not
        name the other side.
      </p>
    </div>
  );
}

const WHERE_LABEL: Record<ChainCoverage['where'][number]['kind'], string> = {
  account: 'In accounts with statements',
  deposit: 'In deposits',
  fund: 'In funds',
  outside: 'In accounts with no statement on file',
  held: 'In deposits not on file',
};

/** What each place the statements stop at needs, so the trail can go further. */
const GAP_HELP: Partial<Record<StartPoint['kind'], string>> = {
  untraced_deposit:
    'Deposits booked before your earliest statement, or from an account with no statement on file: older statements of the account that booked them take the trail further back.',
  untraced_account:
    'Money from an account with no statement on file: its statement shows where that money came from.',
  untraced_fund: 'A fund sold that was bought with money not on the statements.',
  unexplained:
    'Lines not answered yet, or money out of an account beyond what the statements show coming in (a missing statement).',
};

/**
 * How complete the trail is, for all of today's money at once: the share traced back to where it really started (Singapore,
 * interest, earnings, money there before the statements), where the money is now, and each place the statements stop with what
 * would take the trail further.
 */
export function ChainCompleteness({
  c,
  coverage,
  exportHref,
  answerHref,
  importHref,
}: {
  c: ChainContext;
  coverage: ChainCoverage;
  exportHref?: string;
  answerHref: string;
  importHref: string;
}) {
  const gaps = new Map<StartPoint['kind'], number>();
  for (const p of coverage.starts)
    if (!REAL_STARTS.has(p.kind)) gaps.set(p.kind, (gaps.get(p.kind) ?? 0) + p.amount);
  const g = c.chain.guessed;
  return (
    <section className="card" aria-labelledby="ch-cov" data-testid="chain-coverage">
      <h2 id="ch-cov">How complete the trail is</h2>
      <div className="kpis ch-kpis">
        <article className="kpi">
          <div className="kpi-label">Today’s money followed</div>
          <div className="kpi-value">{formatInrCompact(coverage.total)}</div>
        </article>
        <article className="kpi">
          <div className="kpi-label">Traced back to where it started</div>
          <div className="kpi-value">{formatPct(coverage.traced, 0)}</div>
          <div className="kpi-sub muted">Singapore, interest, earnings, money there before</div>
        </article>
        <article className="kpi">
          <div className="kpi-label">Links matched by amount and date</div>
          <div className="kpi-value">
            {g.transfers +
              g.depositBooked +
              g.depositPaidBack +
              g.renewals +
              g.fromOutside +
              g.paidOutside}
          </div>
          <div className="kpi-sub muted">marked on every step</div>
        </article>
      </div>
      <h3 className="tr-h3">Where today’s money started</h3>
      <Starts points={coverage.starts} c={c} />
      <h3 className="tr-h3">Where it is</h3>
      <ul className="tr-parts plain" data-testid="chain-where">
        {coverage.where.map((w) => (
          <li key={w.kind}>
            <span
              className={`tr-swatch tr-${w.kind === 'outside' ? 'untraced_account' : 'still'}`}
              aria-hidden="true"
            />
            <span className="tr-what">{WHERE_LABEL[w.kind]}</span>
            <strong>{inr(w.amount)}</strong>
            <span className="muted small">{formatPct(w.amount / (coverage.total || 1), 0)}</span>
          </li>
        ))}
      </ul>
      {gaps.size > 0 && (
        <>
          <h3 className="tr-h3">Where the statements stop, and what takes the trail further</h3>
          <ul className="plain small ch-gaps" data-testid="chain-gaps">
            {[...gaps]
              .sort((a, b) => b[1] - a[1])
              .map(([k, v]) => (
                <li key={k}>
                  <strong>
                    {ORIGIN_LABEL[k]}: {inr(v)} ({formatPct(v / (coverage.total || 1), 0)})
                  </strong>{' '}
                  {GAP_HELP[k] ?? ''}{' '}
                  {k === 'unexplained' ? (
                    <Link href={answerHref}>Answer the lines</Link>
                  ) : (
                    <Link href={importHref}>Add a statement</Link>
                  )}
                </li>
              ))}
          </ul>
        </>
      )}
      {exportHref && (
        <p className="small">
          <a className="btn compact" href={exportHref} download>
            Download the whole trail (Excel)
          </a>{' '}
          <span className="muted">every step, every start and where every amount is now</span>
        </p>
      )}
    </section>
  );
}
