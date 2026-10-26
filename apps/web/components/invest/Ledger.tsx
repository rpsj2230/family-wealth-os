'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import {
  LEDGER_TYPES,
  filterLedger,
  formatInr,
  ledgerExportRows,
  ledgerTotals,
  ledgerYears,
  sortLedger,
  NO_LEDGER_FILTER,
  type LedgerFilter,
  type LedgerRow,
  type LedgerSortKey,
} from '@fwos/core';
import { rupees, tone } from '@/components/InvestHeadline';
import { niceDate } from '@/lib/dates';
import { toCsv } from '@/lib/listing';
import './invest.css';

export type LedgerEntry = LedgerRow & {
  assetId?: string;
  fund?: string;
  owner?: string;
  ownerColour?: string;
};

const inr = (n: number) => formatInr(Math.round(n));
const units = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 3 });
const price = (n: number) =>
  `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;

const COLS: { key: LedgerSortKey; label: string; num: boolean }[] = [
  { key: 'date', label: 'Date', num: false },
  { key: 'label', label: 'Type', num: false },
  { key: 'units', label: 'Units', num: true },
  { key: 'nav', label: 'Price', num: true },
  { key: 'amount', label: 'Amount', num: true },
  { key: 'balance', label: 'Units held after', num: true },
];

/** The words in the last column: what a sale booked, what a purchase is worth now, the source. */
function Detail({ r, term, today }: { r: LedgerEntry; term: string; today: string }) {
  const bits: React.ReactNode[] = [];
  if (r.group === 'sell') {
    bits.push(
      r.realisedGain === null ? (
        <span key="g" className="muted">
          gain not known (purchase not on the statement)
        </span>
      ) : (
        <span key="g" className={tone(r.realisedGain)}>
          booked {rupees(r.realisedGain)}
          {r.term ? ` · ${r.term === 'mixed' ? 'short and long term' : `${r.term} term`}` : ''}
        </span>
      ),
    );
    if (r.heldDays !== null)
      bits.push(
        <span key="h" className="muted">
          units held {term}
        </span>,
      );
  } else if (r.unitsLeft !== null && r.valueNow !== null) {
    bits.push(
      <span key="n" className={r.gainNow === null ? '' : tone(r.gainNow)}>
        {units(r.unitsLeft)} units now {inr(r.valueNow)}
        {r.gainNowPct !== null
          ? ` (${r.gainNowPct >= 0 ? '+' : '−'}${Math.abs(r.gainNowPct * 100).toFixed(1)}%)`
          : ''}
      </span>,
    );
    if (r.longTermOn)
      bits.push(
        <span key="l" className="muted">
          {r.longTermOn <= today ? 'long term' : `long term from ${niceDate(r.longTermOn)}`}
        </span>,
      );
  } else if (r.group === 'buy')
    bits.push(
      <span key="s" className="muted">
        all sold
      </span>,
    );
  if (r.navBasis === 'published')
    bits.push(
      <span
        key="p"
        className="muted"
        title="The statement gave no price; the published price of that day is shown"
      >
        price from the published list
      </span>,
    );
  if (r.source)
    bits.push(
      <span key="src" className="muted">
        {r.source}
      </span>,
    );
  return (
    <>
      {bits.map((b, i) => (
        <span key={i}>
          {i > 0 ? ' · ' : ''}
          {b}
        </span>
      ))}
    </>
  );
}

const heldWords = (days: number | null) => {
  if (days === null) return '';
  if (days < 60) return `${days} days`;
  if (days < 730) return `${Math.round(days / 30.4)} months`;
  return `${(days / 365).toFixed(1)} years`;
};

/**
 * Every transaction, with the filters people use: type, year (calendar or financial), search, sort by a column, and export. Long
 * ledgers show a page at a time. All the working-out is in packages/core; this only shows it.
 */
export function Ledger({
  rows,
  withFund,
  pageSize,
  name,
  today,
  demo = false,
  empty,
}: {
  rows: LedgerEntry[];
  withFund: boolean;
  pageSize: number;
  name: string;
  today: string;
  /** the public sample: its fund pages live at another address and lines have no page of their own */
  demo?: boolean;
  empty: string;
}) {
  const [f, setF] = useState<LedgerFilter>(NO_LEDGER_FILTER);
  const [sort, setSort] = useState<{ key: LedgerSortKey; dir: 1 | -1 }>({ key: 'date', dir: -1 });
  const [shown, setShown] = useState(pageSize);
  const present = useMemo(() => new Set(rows.map((r) => r.kind)), [rows]);
  const types = LEDGER_TYPES.filter((t) => t.key === 'all' || t.kinds.some((k) => present.has(k)));
  const cal = useMemo(() => ledgerYears(rows, 'calendar'), [rows]);
  const fy = useMemo(() => ledgerYears(rows, 'financial'), [rows]);
  const list = useMemo(
    () => sortLedger(filterLedger(rows, f), sort.key, sort.dir),
    [rows, f, sort],
  );
  const tot = useMemo(
    () => ledgerTotals([...list].sort((a, b) => a.date.localeCompare(b.date))),
    [list],
  );
  const set = (p: Partial<LedgerFilter>) => {
    setF((x) => ({ ...x, ...p }));
    setShown(pageSize);
  };
  const th = (k: LedgerSortKey) =>
    setSort((s) =>
      s.key === k ? { key: k, dir: s.dir === 1 ? -1 : 1 } : { key: k, dir: k === 'label' ? 1 : -1 },
    );
  const exportCsv = () => {
    const blob = new Blob([toCsv(ledgerExportRows(list, withFund))], {
      type: 'text/csv;charset=utf-8',
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const fundHref = (id: string) => (demo ? `/demo/asset?kind=fund&id=${id}` : `/asset/${id}`);
  const txnHref = (assetId: string, id: string) => (demo ? null : `/asset/${assetId}/txn/${id}`);
  if (rows.length === 0) return <p className="empty">{empty}</p>;
  const active = f.type !== 'all' || f.year !== 'all' || f.q.trim() !== '';
  return (
    <div className="ledger">
      <div
        className="ledger-tools noprint"
        role="search"
        aria-label="Filter, search and export the transactions"
      >
        <nav className="ledger-types" aria-label="Type of transaction">
          {types.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`fchip ${f.type === t.key ? 'on' : ''}`}
              aria-pressed={f.type === t.key}
              onClick={() => set({ type: t.key })}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div className="ledger-row2">
          <input
            type="search"
            className="lt-search"
            placeholder="Search by date, type, fund, amount…"
            aria-label="Search the transactions"
            value={f.q}
            onChange={(e) => set({ q: e.target.value })}
          />
          <label className="lt-sort">
            <span className="sr-only">Year</span>
            <select
              aria-label="Year"
              value={f.year}
              onChange={(e) => set({ year: e.target.value })}
            >
              <option value="all">All years</option>
              <optgroup label="Financial year (April to March)">
                {fy.map((y) => (
                  <option key={y} value={y}>
                    FY {y}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Calendar year">
                {cal.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </optgroup>
            </select>
          </label>
          <label className="lt-sort">
            <span className="sr-only">Sort by</span>
            <select
              aria-label="Sort by"
              value={sort.key}
              onChange={(e) => setSort((x) => ({ ...x, key: e.target.value as LedgerSortKey }))}
            >
              {COLS.map((c) => (
                <option key={c.key} value={c.key}>
                  Sort: {c.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn compact"
            onClick={() => setSort((x) => ({ ...x, dir: x.dir === 1 ? -1 : 1 }))}
            aria-label={`Sorted ${sort.dir === 1 ? 'ascending' : 'descending'}; switch direction`}
          >
            {sort.dir === 1 ? '↑ Low to high' : '↓ High to low'}
          </button>
          <button
            type="button"
            className="btn compact"
            onClick={exportCsv}
            disabled={list.length === 0}
          >
            Export CSV
          </button>
          {active && (
            <button
              type="button"
              className="btn compact ghost"
              onClick={() => set({ type: 'all', year: 'all', q: '' })}
            >
              Clear
            </button>
          )}
        </div>
      </div>

      <p className="ledger-sum small" aria-live="polite">
        <b>{list.length}</b> of {rows.length} lines
        {list.length > 0 && (
          <>
            {' · '}put in <b>{inr(tot.boughtAmount)}</b>
            {tot.sipCount > 0 && (
              <>
                {' '}
                (SIP {inr(tot.sipAmount)}, {tot.sipCount} instalments)
              </>
            )}
            {tot.soldAmount > 0 && (
              <>
                {' · '}taken out <b>{inr(tot.soldAmount)}</b>
                {tot.salesUnknown < list.filter((x) => x.group === 'sell').length && (
                  <>
                    {' · '}gain booked{' '}
                    <b className={tone(tot.realisedGain)}>{rupees(tot.realisedGain)}</b>
                  </>
                )}
              </>
            )}
          </>
        )}
      </p>

      <div className="ledger-wrap">
        <table className="ledger-tbl">
          <thead>
            <tr>
              {COLS.slice(0, 1).map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={c.num ? 'num' : ''}
                  aria-sort={
                    sort.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'
                  }
                >
                  <button type="button" className="thbtn" onClick={() => th(c.key)}>
                    {c.label}
                    <span aria-hidden="true">
                      {sort.key === c.key ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}
                    </span>
                  </button>
                </th>
              ))}
              {withFund && <th scope="col">Fund</th>}
              {COLS.slice(1).map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={c.num ? 'num' : ''}
                  aria-sort={
                    sort.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'
                  }
                >
                  <button type="button" className="thbtn" onClick={() => th(c.key)}>
                    {c.label}
                    <span aria-hidden="true">
                      {sort.key === c.key ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}
                    </span>
                  </button>
                </th>
              ))}
              {!withFund && (
                <th scope="col" className="num">
                  Cost held
                </th>
              )}
              {!withFund && (
                <th scope="col" className="num">
                  Value then
                </th>
              )}
              <th scope="col">Detail</th>
            </tr>
          </thead>
          <tbody>
            {list.slice(0, shown).map((r) => {
              const href = r.id && r.assetId ? txnHref(r.assetId, r.id) : null;
              return (
                <tr key={`${r.assetId ?? ''}-${r.n}`} className={`lg-${r.group}`}>
                  <td data-label="Date" className="lg-date">
                    {href ? <Link href={href}>{niceDate(r.date)}</Link> : niceDate(r.date)}
                  </td>
                  {withFund && (
                    <td data-label="Fund" className="lg-fund">
                      {r.assetId ? (
                        <Link href={fundHref(r.assetId)} title={r.fund}>
                          {r.fund}
                        </Link>
                      ) : (
                        r.fund
                      )}
                      <span className="fl-s">
                        {r.ownerColour && (
                          <span
                            className="dot"
                            style={{ background: r.ownerColour }}
                            aria-hidden="true"
                          />
                        )}
                        {r.owner}
                      </span>
                    </td>
                  )}
                  <td data-label="Type">
                    <span className={`ltype ${r.group}`}>{r.label}</span>
                  </td>
                  <td className="num" data-label="Units">
                    {r.units < 0 ? '−' : ''}
                    {units(Math.abs(r.units))}
                  </td>
                  <td className="num" data-label="Price">
                    {r.nav === null ? '–' : price(r.nav)}
                  </td>
                  <td
                    className={`num lg-amt ${r.group === 'sell' ? 'out' : ''}`}
                    data-label="Amount"
                  >
                    {r.amount < 0 ? '−' : ''}
                    {inr(Math.abs(r.amount))}
                  </td>
                  <td className="num" data-label="Units held after">
                    {r.balance === null ? '–' : units(r.balance)}
                  </td>
                  {!withFund && (
                    <td className="num" data-label="Cost held">
                      {inr(r.costHeld)}
                    </td>
                  )}
                  {!withFund && (
                    <td className="num" data-label="Value then">
                      {r.valueAfter === null ? '–' : inr(r.valueAfter)}
                    </td>
                  )}
                  <td className="lg-detail small" data-label="Detail">
                    <Detail r={r} term={heldWords(r.heldDays)} today={today} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {list.length === 0 && (
          <p className="empty">No transaction matches. Clear the filters to see them all.</p>
        )}
      </div>
      {list.length > shown && (
        <p className="ledger-more">
          <button type="button" className="btn" onClick={() => setShown((s) => s + pageSize)}>
            Show {Math.min(pageSize, list.length - shown)} more
          </button>
          <span className="muted small">
            {' '}
            {shown} of {list.length} shown; the export has all {list.length}.
          </span>
        </p>
      )}
    </div>
  );
}
