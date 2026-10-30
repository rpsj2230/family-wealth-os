import Link from 'next/link';
import {
  formatInr,
  formatInrCompact,
  type PositionCard,
  type PositionChange,
  type PositionLine,
} from '@fwos/core';
import { niceDate } from '@/lib/dates';
import type { HomeModel } from '@/lib/home';
import { CardHead, homeLink } from './parts';

const STATUS: Record<PositionCard['status'], string> = {
  actual: 'Actual',
  estimated: 'Estimated',
  partial: 'Needs attention',
  unavailable: 'Not available',
};

const signed = (n: number) =>
  `${n > 0 ? '+' : n < 0 ? '−' : ''}${formatInrCompact(Math.abs(Math.round(n)))}`;

/** One change line: "1M +₹2.10 L (+3.4%) since 28 Sep 2026". Absent when no snapshot goes back that far. */
function Change({ label, c }: { label: string; c: PositionChange | null }) {
  if (!c) return null;
  const dir = Math.round(c.amount) > 0 ? 'up' : Math.round(c.amount) < 0 ? 'down' : 'flat';
  return (
    <li className={`hm-pos-change ${dir}`} title={`Against the snapshot of ${niceDate(c.since)}`}>
      <span className="hm-pos-change-k">{label}</span>
      <span aria-hidden="true">{dir === 'up' ? '▲' : dir === 'down' ? '▼' : '▬'}</span>
      <span className="sr-only">{dir === 'up' ? 'up' : dir === 'down' ? 'down' : 'no change'}</span>
      <strong>{signed(c.amount)}</strong>
      {c.pct !== null && (
        <span className="muted">
          {' '}
          ({c.pct >= 0 ? '+' : '−'}
          {Math.abs(c.pct * 100).toFixed(1)}%)
        </span>
      )}
    </li>
  );
}

/** The 1M / 3M / 1Y changes in one wrapping row; nothing when no snapshot goes back far enough. */
function Changes({ changes }: { changes: PositionCard['changes'] | undefined }) {
  if (!changes || !(changes.month || changes.quarter || changes.year)) return null;
  return (
    <ul className="hm-pos-changes" aria-label="Change since earlier snapshots">
      <Change label="1M" c={changes.month} />
      <Change label="3M" c={changes.quarter} />
      <Change label="1Y" c={changes.year} />
    </ul>
  );
}

/** One figure of a card: label and value on one line; a sentence across the card; a person's line links to their holdings. */
function Line({ l, sample }: { l: PositionLine; sample: boolean }) {
  const href = l.href ? homeLink(l.href, sample) : null;
  const label = href ? (
    <Link href={href} className="hm-pos-line-link">
      {l.label}
    </Link>
  ) : (
    l.label
  );
  return (
    <div className={l.wide ? 'wide' : undefined}>
      <dt>{label}</dt>
      <dd>
        {l.value !== null ? formatInrCompact(l.value) : null}
        {l.value !== null && l.note ? ' · ' : null}
        {l.note && <span className={l.value !== null ? 'muted' : undefined}>{l.note}</span>}
      </dd>
      {l.changes !== undefined && <Changes changes={l.changes} />}
    </div>
  );
}

function PositionTile({ c, sample }: { c: PositionCard; sample: boolean }) {
  const href = homeLink(c.href, sample);
  const title = href ? (
    <Link href={href} className="hm-class-link">
      {c.label}
    </Link>
  ) : (
    c.label
  );
  return (
    <li className={`hm-pos hm-pos-${c.status}`} data-testid={`hm-pos-${c.key}`}>
      <h3 className="hm-class-title">
        {title}
        {href && (
          <span aria-hidden="true" className="hm-go">
            {' '}
            ›
          </span>
        )}
      </h3>
      {c.native && (
        <div className="hm-pos-native" data-testid={`hm-pos-${c.key}-native`}>
          {c.native.currency}{' '}
          {c.native.amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
        </div>
      )}
      {c.value !== null ? (
        <>
          <div
            className={c.native ? 'hm-pos-inr' : 'hm-class-now'}
            data-testid={`hm-pos-${c.key}-value`}
          >
            {c.native ? `≈ ${formatInrCompact(c.value)}` : formatInrCompact(c.value)}
          </div>
          <div className="bv-exact">{formatInr(Math.round(c.value))}</div>
        </>
      ) : (
        c.lines.length === 0 && <div className="hm-pos-none muted">{STATUS[c.status]}</div>
      )}
      {c.lines.length > 0 && (
        <dl className="hm-pos-lines">
          {c.lines.map((l) => (
            <Line key={l.label} l={l} sample={sample} />
          ))}
        </dl>
      )}
      <Changes changes={c.changes} />
      <p className="hm-pos-foot small muted">
        <span className={`hm-pos-status ${c.status}`}>{STATUS[c.status]}</span>
        {c.asOf ? ` · as of ${niceDate(c.asOf)}` : ''}
      </p>
      <details className="hm-pos-basis small">
        <summary>How it is worked out</summary>
        <p className="muted">{c.basis}</p>
      </details>
    </li>
  );
}

/**
 * The money position: one card per kind of money, each with its own figure, date, basis and status, and a link to the records
 * behind it. It sits under the headline and adds to the cards below; nothing here is a second copy of a figure worked out another way.
 */
export function Position({ m, sample }: { m: HomeModel; sample: boolean }) {
  if (m.position.length === 0) return null;
  return (
    <section
      className="card hm-classes hm-position"
      aria-labelledby="hm-pos-h"
      data-testid="hm-position"
    >
      <CardHead title="Money position" id="hm-pos-h" />
      <p className="small muted">
        Each kind of money on its own: mutual funds are never counted as cash, and deposit interest
        is kept apart from the principal. Changes (1M, 3M, 1Y) compare with the daily snapshot of
        that day: they are moves in value, including money added or withdrawn, not profit.
      </p>
      <ul className="hm-class-grid hm-pos-grid">
        {m.position.map((c) => (
          <PositionTile key={c.key} c={c} sample={sample} />
        ))}
      </ul>
    </section>
  );
}
