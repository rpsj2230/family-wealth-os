import Link from 'next/link';
import {
  rateAgoText,
  eventLine,
  niceDay,
  ratePct,
  reasonLabel,
  slotText,
  whereFrom,
  type BoardOffer,
  type RateEventRow,
  type SourceStatus,
} from '@fwos/core';
import type { RateHint } from '@/lib/rates-view';
import type { RateRowModel } from './RateRows';
import './rates.css';

const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** One bank's rates split into the groups a person thinks in: savings by balance, then deposits by account type. */
export function rateSections(
  offers: BoardOffer[],
): { key: string; title: string; offers: BoardOffer[] }[] {
  const savings = offers
    .filter((o) => o.product === 'savings')
    .sort((a, b) => (a.balanceFrom ?? 0) - (b.balanceFrom ?? 0));
  const dep = (k: string) =>
    offers
      .filter((o) => o.product === 'fd' && o.accountKind === k)
      .sort((a, b) => a.tenureFrom - b.tenureFrom || a.tenureTo - b.tenureTo);
  return [
    { key: 'savings', title: 'Savings, by balance', offers: savings },
    { key: 'nre', title: 'NRE fixed deposits, by term', offers: dep('NRE') },
    { key: 'nro', title: 'NRO fixed deposits, by term', offers: dep('NRO') },
    { key: 'resident', title: 'Resident fixed deposits, by term', offers: dep('resident') },
    { key: 'any', title: 'Fixed deposits, any account type', offers: dep('any') },
  ].filter((s) => s.offers.length > 0);
}

/** The editable-row shape for one stored rate, with its source and age in words. */
export function rowModel(o: BoardOffer, today: string, staleDays: number): RateRowModel {
  const age = Math.max(0, daysBetween(o.checkedOn, today));
  const w = whereFrom(o);
  return {
    id: o.id,
    what: slotText(o),
    pct: +(o.rate * 100).toFixed(2),
    sourceKind: o.sourceKind,
    note: w.note,
    url: w.url,
    checked: `checked ${rateAgoText(age)} (${niceDay(o.checkedOn)})`,
    stale: age > staleDays,
    conditions: o.conditions,
    readPct: o.aiRate !== null && o.aiRate !== undefined ? +(o.aiRate * 100).toFixed(2) : null,
    readReason:
      o.aiRate !== null && o.aiRate !== undefined ? reasonLabel(o.correctionReason) : null,
    pagePct:
      o.pageRate !== null && o.pageRate !== undefined ? +(o.pageRate * 100).toFixed(2) : null,
    pageSeen: o.pageSeenOn ? niceDay(o.pageSeenOn) : null,
    misread: o.misreadCount ?? 0,
  };
}

/** Did the monthly refresh read this bank's page? What it said, and the way out. */
export function SourcePanel({ status, bank }: { status: SourceStatus; bank: string }) {
  const tone = status.health === 'ok' ? 'ok' : status.health === 'idle' ? '' : status.health;
  return (
    <section className="card" aria-labelledby="src-h">
      <h2 id="src-h">Does the monthly refresh read {bank}?</h2>
      <div className={`rt-note ${tone}`} role="status">
        <p>
          <b>{status.headline}</b>
        </p>
        {status.ranOn && <p>Last tried {niceDay(status.ranOn)}.</p>}
        {status.fix && (
          <p>
            <b>What to do:</b> {status.fix.text}{' '}
            {status.fix.href && (
              <Link href={status.fix.href}>{status.fix.hrefLabel ?? 'Open'}</Link>
            )}
          </p>
        )}
      </div>
      {status.url && (
        <p className="small" style={{ marginBottom: 0 }}>
          Rate page:{' '}
          <a href={status.url} target="_blank" rel="noreferrer">
            {status.url}
          </a>
        </p>
      )}
      {status.detail && (
        <details className="disclose">
          <summary>The refresh&apos;s own words</summary>
          <p className="small muted">{status.detail}</p>
        </details>
      )}
    </section>
  );
}

/** The change log as a table (a stacked list on a phone). Newest first. */
export function LogTable({ events }: { events: RateEventRow[] }) {
  if (events.length === 0)
    return (
      <p className="empty">
        Nothing has been logged for this bank yet. Every change you or the refresh makes is recorded
        here with the old and new rate.
      </p>
    );
  return (
    <table className="tbl lines responsive rt-log">
      <thead>
        <tr>
          <th>Date</th>
          <th>Rate</th>
          <th>What happened</th>
          <th className="num">Old</th>
          <th className="num">New</th>
          <th>By</th>
          <th>Why</th>
        </tr>
      </thead>
      <tbody>
        {events.map((e, i) => {
          const l = eventLine(e);
          return (
            <tr key={`${e.at}${i}`}>
              <td data-label="Date" className="dir">
                {niceDay(e.at)}
              </td>
              <td data-label="Rate">{l.what}</td>
              <td data-label="What happened">
                <span className={`rt-dir ${l.dir}`}>
                  <span aria-hidden="true">
                    {l.dir === 'up' ? '▲ ' : l.dir === 'down' ? '▼ ' : ''}
                  </span>
                  {l.action}
                </span>
              </td>
              <td className="num" data-label="Old">
                {l.oldRate === null ? '–' : ratePct(l.oldRate)}
              </td>
              <td className="num" data-label="New">
                {l.newRate === null ? '–' : ratePct(l.newRate)}
              </td>
              <td data-label="By">{l.who}</td>
              <td data-label="Why">{l.why ?? ''}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** The rules the refresh has learned for this bank, each with an on/off switch. */
export function HintList({
  hints,
  toggle,
}: {
  hints: RateHint[];
  /** server action; absent on the public sample */
  toggle?: ((f: FormData) => Promise<void>) | undefined;
}) {
  if (hints.length === 0)
    return (
      <p className="muted small">
        No rules yet. When you correct a rate the refresh read wrongly, it works out why and saves a
        rule here.
      </p>
    );
  return (
    <div>
      {hints.map((h) => (
        <div key={h.id} className={`rt-hint ${h.active ? '' : 'off'}`}>
          <div>
            <div className="txt">{h.hint}</div>
            <div className="small muted">
              {h.cause === 'Written by you'
                ? 'Written by you'
                : `Learned: ${reasonLabel(h.cause).toLowerCase()}`}{' '}
              · {niceDay(h.createdOn)}
            </div>
          </div>
          {toggle ? (
            <form action={toggle}>
              <input type="hidden" name="id" value={h.id} />
              <button
                className="btn compact"
                aria-pressed={h.active}
                aria-label={`${h.active ? 'Turn off' : 'Turn on'} this rule`}
              >
                {h.active ? 'On' : 'Off'}
              </button>
            </form>
          ) : (
            <span className={`pill ${h.active ? 'ok' : ''}`}>{h.active ? 'On' : 'Off'}</span>
          )}
        </div>
      ))}
    </div>
  );
}
