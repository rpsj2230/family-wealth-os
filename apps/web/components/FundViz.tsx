import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  FUND_RANGES,
  formatInr,
  formatInrCompact,
  type CalendarCell,
  type FundRangeKey,
  type MonthContribution,
} from '@fwos/core';
import { pct, rupees } from './InvestHeadline';
import { monthShort } from './viz-dates';
import './fundviz.css';

/* The server-drawn parts of the fund graphs: range switch, statistics list, stacked bar, gain bars, monthly columns, SIP calendar. */

/** The time-range switch: links, so each range has an address and works without scripts. */
export function RangeSwitch({
  base = '',
  current,
  keep,
  label = 'Show',
  hrefOf,
}: {
  base?: string;
  current: FundRangeKey;
  keep?: Record<string, string> | undefined;
  label?: string;
  /** builds each link itself, when the page keeps more in its address than a range */
  hrefOf?: (key: FundRangeKey) => string;
}) {
  const href = (key: FundRangeKey) => {
    if (hrefOf) return hrefOf(key);
    const q = new URLSearchParams(keep);
    q.set('range', key);
    return `${base}${base.includes('?') ? '&' : '?'}${q.toString()}`;
  };
  return (
    <nav className="rangeswitch" aria-label="Time range">
      <span className="rangelabel">{label}</span>
      {FUND_RANGES.map((r) => (
        <Link
          key={r.key}
          href={href(r.key)}
          scroll={false}
          className={`fchip ${current === r.key ? 'on' : ''}`}
          aria-current={current === r.key ? 'true' : undefined}
        >
          {r.label}
        </Link>
      ))}
    </nav>
  );
}

export interface Stat {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  tone?: 'gain' | 'fail' | '' | null | undefined;
}

/** A tidy grid of labelled figures, each with one line saying what it is or where it comes from. */
export function StatList({ items, label }: { items: Stat[]; label: string }) {
  return (
    <dl className="statgrid" aria-label={label}>
      {items.map((s) => (
        <div key={s.label}>
          <dt>{s.label}</dt>
          <dd className={`v ${s.tone ?? ''}`}>{s.value}</dd>
          {s.note && <dd className={`n ${s.tone ?? ''}`}>{s.note}</dd>}
        </div>
      ))}
    </dl>
  );
}

/** "real" or "estimated": says which kind of data a figure rests on. */
export function BasisChip({ real, text }: { real: boolean; text?: string }) {
  return (
    <span
      className={`estchip ${real ? 'real' : ''}`}
      title={
        real
          ? 'Worked out from the transactions on a fund statement'
          : 'Estimated from the start date, the SIP and published prices; exact once a fund statement is imported'
      }
    >
      {text ?? (real ? 'statement' : 'estimated')}
    </span>
  );
}

export interface StackPart {
  key: string;
  label: string;
  value: number;
  colour: string;
  /** shown after the amount instead of the share */
  note?: string;
}

/** One horizontal bar split into parts, with a key that lists every part, its amount and share, so colour is never alone. */
export function StackBar({
  parts,
  caption,
  format = formatInrCompact,
}: {
  parts: StackPart[];
  caption: string;
  format?: (n: number) => string;
}) {
  const shown = parts.filter((p) => p.value > 0);
  const total = shown.reduce((a, p) => a + p.value, 0);
  if (total <= 0) return null;
  const share = (v: number) => `${((v / total) * 100).toFixed(v / total < 0.1 ? 1 : 0)}%`;
  return (
    <div>
      <div
        className="stackbar"
        role="img"
        aria-label={`${caption}: ${shown.map((p) => `${p.label} ${share(p.value)}`).join(', ')}`}
      >
        {shown.map((p) => (
          <span
            key={p.key}
            style={{ width: `${(p.value / total) * 100}%`, background: p.colour }}
            title={`${p.label}: ${format(p.value)} (${share(p.value)})`}
          />
        ))}
      </div>
      <ul className="stackkey">
        {shown.map((p) => (
          <li key={p.key}>
            <span className="sw" style={{ background: p.colour }} aria-hidden="true" />
            <span className="lab" title={p.label}>
              {p.label}
              {p.note && <span className="muted small"> · {p.note}</span>}
            </span>
            <span className="amt">{format(p.value)}</span>
            <span className="pc">{share(p.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface GainBarRow {
  key: string;
  label: ReactNode;
  gain: number;
  pctValue: number | null;
}

/** Gain or loss per fund as bars either side of a zero line, in the order given (largest gain first). */
export function GainBars({ rows, caption }: { rows: GainBarRow[]; caption: string }) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.gain)));
  return (
    <ul className="dvbars" aria-label={caption}>
      {rows.map((r) => (
        <li key={r.key}>
          <span className="lab">{r.label}</span>
          <span className="track" role="presentation">
            <span
              className={r.gain >= 0 ? 'pos' : 'neg'}
              style={{ width: `${(Math.abs(r.gain) / max) * 50}%` }}
            />
          </span>
          <span className={`val ${r.gain >= 0 ? 'gain' : 'fail'}`}>
            {rupees(r.gain)}
            {r.pctValue !== null && <span className="muted small"> {pct(r.pctValue, 1)}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

const monthName = monthShort;

/** Money put in per month as columns, one-off and monthly money stacked above the line, sales below it. */
export function MonthColumns({
  months,
  caption,
}: {
  months: MonthContribution[];
  caption: string;
}) {
  const ups = months.map((m) => m.sip + m.lump + m.moved);
  const maxUp = Math.max(0, ...ups);
  const maxDown = Math.max(0, ...months.map((m) => m.out));
  if (maxUp + maxDown <= 0) return null;
  const upShare = maxUp / (maxUp + maxDown);
  const step = Math.ceil(months.length / 6);
  const segs: { key: 'sip' | 'lump' | 'moved'; colour: string; name: string }[] = [
    { key: 'sip', colour: 'var(--viz-1)', name: 'Monthly (SIP)' },
    { key: 'lump', colour: 'var(--viz-2)', name: 'One-off' },
    { key: 'moved', colour: 'var(--viz-5)', name: 'Moved in or reinvested' },
  ];
  return (
    <div>
      <div className="colsmax">
        <span>Most in one month {formatInrCompact(maxUp)}</span>
        {maxDown > 0 && <span>Most taken out {formatInrCompact(maxDown)}</span>}
      </div>
      <div className="cols" role="img" aria-label={caption} style={{ height: 170 }}>
        <div className="axisline" style={{ top: 6 + 164 * upShare }} />
        {months.map((m) => {
          const up = m.sip + m.lump + m.moved;
          const tip = `${monthName(m.month, true)}: ${formatInr(Math.round(up))} in${
            m.out ? `, ${formatInr(Math.round(m.out))} out` : ''
          }`;
          return (
            <div
              className="col"
              key={m.month}
              title={tip}
              style={{
                display: 'grid',
                gridTemplateRows: `${upShare * 100}% ${(1 - upShare) * 100}%`,
              }}
            >
              <div className="up">
                {segs.map((s) =>
                  m[s.key] > 0 ? (
                    <span
                      key={s.key}
                      style={{
                        height: `${(m[s.key] / (maxUp || 1)) * 100}%`,
                        background: s.colour,
                      }}
                    />
                  ) : null,
                )}
              </div>
              <div className="down">
                {m.out > 0 && (
                  <span
                    style={{
                      height: `${(m.out / (maxDown || 1)) * 100}%`,
                      background: 'var(--viz-8)',
                    }}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="colslabels" aria-hidden="true">
        {months.map((m, i) => (
          <span key={m.month}>
            {i % step === 0 ? monthName(m.month, i === 0 || m.month.endsWith('-01')) : ''}
          </span>
        ))}
      </div>
      <ul className="vizlegend">
        {segs.map((s) => (
          <li key={s.key}>
            <span className="sw" style={{ background: s.colour }} aria-hidden="true" />
            {s.name}
          </li>
        ))}
        {maxDown > 0 && (
          <li>
            <span className="sw" style={{ background: 'var(--viz-8)' }} aria-hidden="true" />
            Sold or moved out
          </li>
        )}
      </ul>
      <details className="viztable">
        <summary>Show the figures as a table</summary>
        <table>
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              <th scope="col">Month</th>
              <th scope="col">Monthly</th>
              <th scope="col">One-off</th>
              <th scope="col">Moved in</th>
              <th scope="col">Out</th>
            </tr>
          </thead>
          <tbody>
            {[...months].reverse().map((m) => (
              <tr key={m.month}>
                <td>{monthName(m.month, true)}</td>
                <td>{m.sip ? formatInr(Math.round(m.sip)) : '–'}</td>
                <td>{m.lump ? formatInr(Math.round(m.lump)) : '–'}</td>
                <td>{m.moved ? formatInr(Math.round(m.moved)) : '–'}</td>
                <td>{m.out ? formatInr(Math.round(m.out)) : '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

const CAL: Record<CalendarCell['state'], { glyph: string; word: string }> = {
  paid: { glyph: '✓', word: 'instalment made' },
  missed: { glyph: '×', word: 'no instalment on the statement' },
  pending: { glyph: '○', word: 'this month, not yet seen' },
  lump: { glyph: '●', word: 'one-off purchase only' },
  planned: { glyph: '~', word: 'expected from the SIP plan' },
  idle: { glyph: '–', word: 'no SIP' },
};

/** One tile per month: was the monthly investment made? Each tile has a symbol and a word, not only a colour. */
export function SipStrip({ cells, caption }: { cells: CalendarCell[]; caption: string }) {
  const used = [...new Set(cells.map((c) => c.state))];
  return (
    <div>
      <ol className="sipstrip" aria-label={caption}>
        {cells.map((c, i) => (
          <li
            key={c.month}
            className={c.state}
            title={`${monthName(c.month, true)}: ${CAL[c.state].word}${c.amount ? `, ${formatInr(Math.round(c.amount))}` : ''}`}
          >
            <span className="m">{monthName(c.month, i === 0 || c.month.endsWith('-01'))}</span>
            <span className="g" aria-hidden="true">
              {CAL[c.state].glyph}
            </span>
            <span className="sr-only">{CAL[c.state].word}</span>
            <span className="m">{c.amount ? formatInrCompact(c.amount) : ' '}</span>
          </li>
        ))}
      </ol>
      <ul className="vizlegend">
        {used.map((s) => (
          <li key={s}>
            <b aria-hidden="true">{CAL[s].glyph}</b> {CAL[s].word}
          </li>
        ))}
      </ul>
    </div>
  );
}
