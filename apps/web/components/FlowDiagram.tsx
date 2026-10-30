'use client';

import Link from 'next/link';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent,
} from 'react';
import { bandPath, sankeyLayout, type FlowStatus } from '@fwos/core';
import { inrCompact } from './charts';
import './fundviz.css';
import './flowdiagram.css';

/** What a node is, for its colour and shape. */
export type FlowRole =
  | 'singapore'
  | 'earning'
  | 'source'
  | 'account'
  | 'deposit'
  | 'fund'
  | 'outside'
  | 'end'
  | 'other'
  | 'gap';

export interface DiagramNode {
  id: string;
  column: number;
  value: number;
  label: string;
  /** a second line: a date, a kind, "transaction link not found" */
  sub?: string;
  role: FlowRole;
  /** the words for a gap node: what is missing */
  gap?: string;
  /** where a click on it goes: its journey, its page */
  links?: { label: string; href: string }[];
}

export interface DiagramLink {
  source: string;
  target: string;
  amount: number;
  status: FlowStatus;
  /** what the status means for this link, in words */
  note: string;
  count: number;
  first: string;
  last: string;
}

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const day = (iso: string) =>
  iso
    ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : '';
const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const COLUMN_WIDTH = 210;
const NODE = 14;

const ROLE_LABEL: Record<FlowRole, string> = {
  singapore: 'Money from Singapore',
  earning: 'Interest and profit',
  source: 'Other starting points',
  account: 'Bank accounts',
  deposit: 'Fixed deposits',
  fund: 'Mutual funds',
  outside: 'Accounts with no statement on file',
  end: 'Spent, charges and tax',
  other: 'Smaller parts together',
  gap: 'Missing or unverified',
};

/**
 * A Sankey diagram of money moving between sources, holdings and destinations. Bands are as wide as the money; solid bands are
 * verified, dashed ones matched by amount and date, dotted grey ones where a statement, a link or an answer is missing (the flow
 * carries on past it). Hover or tap a node or band for its figures; tap a node for its journey and its page. Zoom, pan and fit with
 * the buttons, the mouse wheel (with Ctrl) or by dragging. A table of every flow sits under it.
 */
export function FlowDiagram({
  nodes,
  links,
  columnTitles,
  label,
  emptyText = 'No money moved in what you chose.',
}: {
  nodes: DiagramNode[];
  links: DiagramLink[];
  columnTitles?: string[];
  /** what the diagram shows, for screen readers and the table */
  label: string;
  emptyText?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);
  const [view, setView] = useState({ k: 1, x: 0, y: 0 });
  const [hover, setHover] = useState<{
    kind: 'node' | 'link';
    id: string;
    x: number;
    y: number;
  } | null>(null);
  const [picked, setPicked] = useState<{ kind: 'node' | 'link'; id: string } | null>(null);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(
    null,
  );

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver((e) => setWidth(Math.max(280, e[0]!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const columns = Math.max(1, new Set(nodes.map((n) => n.column)).size);
  const inner = Math.max(width - 24, columns * COLUMN_WIDTH);
  const layout = useMemo(
    () =>
      sankeyLayout(
        nodes.map((n) => ({ id: n.id, column: n.column, value: n.value })),
        links.map((l) => ({ source: l.source, target: l.target, amount: l.amount })),
        {
          width: inner,
          height: Math.min(900, Math.max(200, nodes.length * 26)),
          nodeWidth: NODE,
          gap: 14,
          minNode: 6,
        },
      ),
    [nodes, links, inner],
  );
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const colX = useMemo(() => {
    const xs = [...new Set(layout.nodes.map((n) => n.x))].sort((a, b) => a - b);
    return xs;
  }, [layout]);
  const lastX = colX[colX.length - 1] ?? 0;
  // a label gets half the space to the next column (the next column's labels take the other half)
  const spacing = colX.length > 1 ? colX[1]! - colX[0]! : inner;
  const room = Math.max(10, Math.floor((spacing / 2 - 24) / 6.6) - 8);
  const top = columnTitles?.length ? 26 : 6;
  const height = layout.height + top + 12;

  const fit = () => setView({ k: Math.min(1, (width - 24) / inner), x: 0, y: 0 });
  // opens readable: the whole diagram when it fits, else at most a little smaller, to be moved by dragging
  useEffect(() => {
    setView({ k: Math.min(1, Math.max(0.75, (width - 24) / inner)), x: 0, y: 0 });
  }, [width, inner]);

  const lit = (l: { source: string; target: string }, i: number) => {
    const sel = hover ?? picked;
    if (!sel) return true;
    if (sel.kind === 'link') return String(i) === sel.id;
    return l.source === sel.id || l.target === sel.id;
  };

  const zoomBy = (f: number) => setView((v) => ({ ...v, k: Math.max(0.2, Math.min(4, v.k * f)) }));
  const onWheel = (e: WheelEvent<SVGSVGElement>) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15);
  };
  const onDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if ((e.target as Element).closest('[data-hit]')) return;
    drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };
  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    setView((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy }));
  };
  const onUp = () => {
    if (drag.current && !drag.current.moved) setPicked(null);
    drag.current = null;
  };
  const tipAt = (e: ReactPointerEvent<Element>, kind: 'node' | 'link', id: string) => {
    const r = box.current!.getBoundingClientRect();
    setHover({ kind, id, x: e.clientX - r.left, y: e.clientY - r.top });
  };
  const key = (kind: 'node' | 'link', id: string) => (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setPicked({ kind, id });
    }
  };

  if (!nodes.length || !links.length)
    return (
      <p className="viz-empty" data-testid="flow-empty">
        {emptyText}
      </p>
    );

  const tip = hover ? describe(hover, byId, links) : null;
  const sel = picked ? describe(picked, byId, links) : null;
  const pickedNode = picked?.kind === 'node' ? byId.get(picked.id) : undefined;

  return (
    <div className="fl" data-testid="flow-diagram">
      <div className="fl-tools" role="toolbar" aria-label="Diagram controls">
        <button
          type="button"
          className="btn compact"
          onClick={() => zoomBy(1.25)}
          aria-label="Zoom in"
        >
          +
        </button>
        <button
          type="button"
          className="btn compact"
          onClick={() => zoomBy(0.8)}
          aria-label="Zoom out"
        >
          −
        </button>
        <button type="button" className="btn compact" onClick={fit} data-testid="flow-fit">
          Fit to screen
        </button>
        <span className="muted small">Drag to move · Ctrl + wheel to zoom · tap a box or band</span>
      </div>
      <div className="fl-box" ref={box}>
        <svg
          role="img"
          aria-label={label}
          width="100%"
          height={Math.max(220, height * view.k + 8)}
          onWheel={onWheel}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerLeave={() => {
            drag.current = null;
            setHover(null);
          }}
          className="fl-svg"
        >
          <defs>
            <pattern
              id="fl-hatch"
              width="6"
              height="6"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <rect width="6" height="6" className="fl-hatch-bg" />
              <line x1="0" y1="0" x2="0" y2="6" className="fl-hatch-line" />
            </pattern>
          </defs>
          <g transform={`translate(${view.x + 8},${view.y + 4}) scale(${view.k})`}>
            {columnTitles?.map((t, i) =>
              colX[i] !== undefined ? (
                <text
                  key={t}
                  x={i === colX.length - 1 && colX.length > 1 ? colX[i]! + NODE : colX[i]!}
                  y={14}
                  textAnchor={i === colX.length - 1 && colX.length > 1 ? 'end' : 'start'}
                  className="fl-coltitle"
                >
                  {t}
                </text>
              ) : null,
            )}
            <g transform={`translate(0,${top})`}>
              {layout.links.map((l, i) => {
                const d = links[l.index]!;
                const s = byId.get(d.source);
                return (
                  <path
                    key={i}
                    d={bandPath(l)}
                    data-hit
                    className={`fl-link s-${d.status} r-${s?.role ?? 'other'}${lit(d, i) ? '' : ' dim'}`}
                    strokeWidth={l.width}
                    tabIndex={0}
                    aria-label={`${byId.get(d.source)?.label ?? ''} to ${byId.get(d.target)?.label ?? ''}: ${inr(d.amount)}, ${d.note}`}
                    onPointerMove={(e) => tipAt(e, 'link', String(i))}
                    onPointerLeave={() => setHover(null)}
                    onClick={() => setPicked({ kind: 'link', id: String(i) })}
                    onKeyDown={key('link', String(i))}
                  />
                );
              })}
              {layout.nodes.map((p) => {
                const n = byId.get(p.id)!;
                const right = p.x >= lastX && colX.length > 1;
                return (
                  <g
                    key={p.id}
                    data-hit
                    className={`fl-node r-${n.role}${n.gap ? ' gap' : ''}`}
                    tabIndex={0}
                    role="button"
                    aria-label={`${n.label}${n.sub ? `, ${n.sub}` : ''}: ${inr(n.value)}`}
                    onPointerMove={(e) => tipAt(e, 'node', p.id)}
                    onPointerLeave={() => setHover(null)}
                    onClick={() => setPicked({ kind: 'node', id: p.id })}
                    onKeyDown={key('node', p.id)}
                  >
                    <rect x={p.x} y={p.y} width={p.width} height={p.height} rx={3} />
                    <text
                      x={right ? p.x - 6 : p.x + p.width + 6}
                      y={p.y + p.height / 2}
                      textAnchor={right ? 'end' : 'start'}
                      dominantBaseline="middle"
                      className="fl-label"
                    >
                      <tspan>{short(n.label, room)}</tspan>
                      <tspan className="fl-amt"> {inrCompact(n.value)}</tspan>
                    </text>
                    {n.sub && p.height >= 22 && (
                      <text
                        x={right ? p.x - 6 : p.x + p.width + 6}
                        y={p.y + p.height / 2 + 13}
                        textAnchor={right ? 'end' : 'start'}
                        dominantBaseline="middle"
                        className="fl-sub"
                      >
                        {short(n.sub, room + 8)}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          </g>
        </svg>
        {tip && hover && (
          <div
            className="plot-tip fl-tip"
            style={{
              left: Math.min(hover.x + 12, width - 250),
              top: hover.y + 12,
            }}
            role="status"
          >
            {tip.title && <div className="tipdate">{tip.title}</div>}
            {tip.rows.map((r) => (
              <div key={r[0]} className="tiprow">
                <span>{r[0]}</span>
                <b>{r[1]}</b>
              </div>
            ))}
            {tip.note && <div className="tipnote">{tip.note}</div>}
          </div>
        )}
      </div>

      {sel && (
        <section className="fl-picked" aria-live="polite" data-testid="flow-picked">
          <h3 className="tr-h3">{sel.title}</h3>
          <ul className="plain small">
            {sel.rows.map((r) => (
              <li key={r[0]}>
                {r[0]}: <strong>{r[1]}</strong>
              </li>
            ))}
          </ul>
          {sel.note && <p className="small muted">{sel.note}</p>}
          {pickedNode?.links?.length ? (
            <p className="small fl-actions">
              {pickedNode.links.map((l) => (
                <Link key={l.href} className="btn compact" href={l.href}>
                  {l.label}
                </Link>
              ))}
            </p>
          ) : null}
        </section>
      )}

      <ul className="vizlegend fl-legend" aria-label="Legend" data-testid="flow-legend">
        <li>
          <span className="fl-key s-verified" aria-hidden="true" /> Verified: both sides on the
          statements or the records
        </li>
        <li>
          <span className="fl-key s-matched" aria-hidden="true" /> Matched by amount and date:
          counterpart not confirmed
        </li>
        <li>
          <span className="fl-key s-gap" aria-hidden="true" /> Missing or unverified: statement,
          link or answer missing (the flow carries on)
        </li>
        {[...new Set(nodes.map((n) => n.role))].map((r) => (
          <li key={r}>
            <span className={`sw fl-sw r-${r}`} aria-hidden="true" /> {ROLE_LABEL[r]}
          </li>
        ))}
      </ul>

      <details className="viztable fl-table">
        <summary>See every flow as a table</summary>
        <div className="tablewrap">
          <table className="tbl lines small">
            <thead>
              <tr>
                <th>From</th>
                <th>To</th>
                <th className="num">Amount</th>
                <th>Status</th>
                <th className="num">Steps</th>
                <th>Dates</th>
              </tr>
            </thead>
            <tbody>
              {[...links]
                .sort((a, b) => b.amount - a.amount)
                .map((l, i) => (
                  <tr key={i}>
                    <td>{byId.get(l.source)?.label}</td>
                    <td>{byId.get(l.target)?.label}</td>
                    <td className="num">{inr(l.amount)}</td>
                    <td>{l.note}</td>
                    <td className="num">{l.count}</td>
                    <td>
                      {day(l.first)}
                      {l.last && l.last !== l.first ? ` – ${day(l.last)}` : ''}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

function describe(
  sel: { kind: 'node' | 'link'; id: string },
  byId: Map<string, DiagramNode>,
  links: DiagramLink[],
): { title: string; rows: [string, string][]; note?: string } | null {
  if (sel.kind === 'link') {
    const l = links[Number(sel.id)];
    if (!l) return null;
    return {
      title: `${byId.get(l.source)?.label ?? ''} → ${byId.get(l.target)?.label ?? ''}`,
      rows: [
        ['Amount', inr(l.amount)],
        ['Steps', String(l.count)],
        ['Dates', `${day(l.first)}${l.last !== l.first ? ` – ${day(l.last)}` : ''}`],
      ],
      note: l.note,
    };
  }
  const n = byId.get(sel.id);
  if (!n) return null;
  const inn = links.filter((l) => l.target === n.id).reduce((s, l) => s + l.amount, 0);
  const out = links.filter((l) => l.source === n.id).reduce((s, l) => s + l.amount, 0);
  const unverified = links
    .filter((l) => (l.target === n.id || l.source === n.id) && l.status !== 'verified')
    .reduce((s, l) => s + l.amount, 0);
  return {
    title: n.label,
    rows: [
      ...(n.sub ? ([['', n.sub]] as [string, string][]) : []),
      ...(inn > 0 ? ([['In', inr(inn)]] as [string, string][]) : []),
      ...(out > 0 ? ([['Out', inr(out)]] as [string, string][]) : []),
      ...(unverified > 0 ? ([['Not verified', inr(unverified)]] as [string, string][]) : []),
    ].filter((r) => r[1]),
    ...(n.gap ? { note: n.gap } : {}),
  };
}
