'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { niceDate } from '@/lib/dates';
import './transactions.css';

export interface TxnRow {
  id: string;
  date: string;
  amount: number;
  balance: number | null;
  narration: string;
  kind: string;
  /** what it was spent on or came in as (the tag), and whether it is the best explanation rather than a certain one */
  tag?: string | null;
  bestGuess?: boolean;
  /** the account, when lines of several accounts are listed together */
  account?: string;
  assetId?: string;
  toAnswer: boolean;
  /** the bank's order of the lines (oldest 0): it settles lines of the same day */
  seq?: number;
}

type SortKey = 'date' | 'amount' | 'balance' | 'kind' | 'narration';
type Period =
  | 'all'
  | 'this-week'
  | 'last-week'
  | 'this-month'
  | 'last-month'
  | 'this-quarter'
  | 'last-quarter'
  | 'this-year'
  | 'last-year'
  | 'this-fy'
  | 'last-fy'
  | 'last-30'
  | 'last-90'
  | 'last-365'
  | 'custom';

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const day = (y: number, m: number, d: number) => iso(new Date(y, m, d));

/** The days a period covers, from today: weeks start on Monday, quarters and years are the Indian financial year's (April). */
export function periodRange(p: Period, today: Date): { from: string; to: string } | null {
  const y = today.getFullYear();
  const m = today.getMonth();
  const d = today.getDate();
  const back = (n: number) => ({ from: day(y, m, d - n + 1), to: iso(today) });
  const monday = d - ((today.getDay() + 6) % 7);
  // the financial year's quarters: Apr–Jun, Jul–Sep, Oct–Dec, Jan–Mar
  const qStart = m - ((m + 9) % 3);
  const fyStart = m >= 3 ? y : y - 1;
  switch (p) {
    case 'this-week':
      return { from: day(y, m, monday), to: day(y, m, monday + 6) };
    case 'last-week':
      return { from: day(y, m, monday - 7), to: day(y, m, monday - 1) };
    case 'this-month':
      return { from: day(y, m, 1), to: day(y, m + 1, 0) };
    case 'last-month':
      return { from: day(y, m - 1, 1), to: day(y, m, 0) };
    case 'this-quarter':
      return { from: day(y, qStart, 1), to: day(y, qStart + 3, 0) };
    case 'last-quarter':
      return { from: day(y, qStart - 3, 1), to: day(y, qStart, 0) };
    case 'this-year':
      return { from: day(y, 0, 1), to: day(y, 11, 31) };
    case 'last-year':
      return { from: day(y - 1, 0, 1), to: day(y - 1, 11, 31) };
    case 'this-fy':
      return { from: day(fyStart, 3, 1), to: day(fyStart + 1, 2, 31) };
    case 'last-fy':
      return { from: day(fyStart - 1, 3, 1), to: day(fyStart, 2, 31) };
    case 'last-30':
      return back(30);
    case 'last-90':
      return back(90);
    case 'last-365':
      return back(365);
    default:
      return null;
  }
}

const PERIODS: { key: Period; label: string }[] = [
  { key: 'all', label: 'All dates' },
  { key: 'this-week', label: 'This week' },
  { key: 'last-week', label: 'Last week' },
  { key: 'this-month', label: 'This month' },
  { key: 'last-month', label: 'Last month' },
  { key: 'this-quarter', label: 'This quarter' },
  { key: 'last-quarter', label: 'Last quarter' },
  { key: 'this-fy', label: 'This financial year' },
  { key: 'last-fy', label: 'Last financial year' },
  { key: 'this-year', label: 'This calendar year' },
  { key: 'last-year', label: 'Last calendar year' },
  { key: 'last-30', label: 'Last 30 days' },
  { key: 'last-90', label: 'Last 90 days' },
  { key: 'last-365', label: 'Last 12 months' },
  { key: 'custom', label: 'Custom dates…' },
];

const inr = (n: number) =>
  `₹${Math.abs(n).toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 0 })}`;
const signed = (n: number) => `${n >= 0 ? '+' : '−'}${inr(n)}`;
const num = (s: string) => {
  const v = Number(s.replace(/[,₹\s]/g, ''));
  return s.trim() === '' || !Number.isFinite(v) ? null : v;
};
const csvCell = (v: string | number | null) => {
  const s = v === null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * A statement's lines as a working table: search, a date period (or custom dates), money in or out, kind, amount range and lines
 * still to answer; sort by any column (newest first to start); pages of 25, 50 or 100; totals of what is shown; and a CSV of it.
 * Every line opens its own page (`hrefTemplate` with {id}).
 */
export function TransactionsTable({
  rows,
  hrefTemplate,
  fileName = 'transactions',
  initialTag = '',
}: {
  rows: TxnRow[];
  /** a line's page, with {id} for the line and {asset} for its account */
  hrefTemplate: string;
  fileName?: string;
  /** open with only the lines of this tag (its label) */
  initialTag?: string;
}) {
  const [tag, setTag] = useState(initialTag);
  const tags = useMemo(
    () => [...new Set(rows.map((r) => r.tag).filter((t): t is string => !!t))].sort(),
    [rows],
  );
  const withAccount = rows.some((r) => r.account);
  const [q, setQ] = useState('');
  const [period, setPeriod] = useState<Period>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [dir, setDir] = useState<'all' | 'in' | 'out'>('all');
  const [kind, setKind] = useState('');
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  const [onlyAsk, setOnlyAsk] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'date', desc: true });
  const [size, setSize] = useState(25);
  const [page, setPage] = useState(0);

  const kinds = useMemo(() => [...new Set(rows.map((r) => r.kind))].sort(), [rows]);
  const range = useMemo(
    () =>
      period === 'custom'
        ? from || to
          ? { from: from || '0000-01-01', to: to || '9999-12-31' }
          : null
        : periodRange(period, new Date()),
    [period, from, to],
  );

  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const lo = num(min);
    const hi = num(max);
    const out = rows.filter((r) => {
      if (range && (r.date < range.from || r.date > range.to)) return false;
      if (dir === 'in' && r.amount < 0) return false;
      if (dir === 'out' && r.amount >= 0) return false;
      if (kind && r.kind !== kind) return false;
      if (tag && r.tag !== tag) return false;
      if (onlyAsk && !r.toAnswer) return false;
      const a = Math.abs(r.amount);
      if (lo !== null && a < lo) return false;
      if (hi !== null && a > hi) return false;
      if (words.length) {
        const hay =
          `${r.narration} ${r.kind} ${r.tag ?? ''} ${r.account ?? ''} ${niceDate(r.date)} ${r.date} ${a} ${a.toLocaleString('en-IN')}`.toLowerCase();
        if (!words.every((w) => hay.includes(w))) return false;
      }
      return true;
    });
    const k = sort.key;
    const sign = sort.desc ? -1 : 1;
    out.sort((x, y) => {
      const c =
        k === 'date'
          ? x.date.localeCompare(y.date) || (x.seq ?? 0) - (y.seq ?? 0)
          : k === 'amount'
            ? x.amount - y.amount
            : k === 'balance'
              ? (x.balance ?? -Infinity) - (y.balance ?? -Infinity)
              : x[k].localeCompare(y[k]);
      // ties: newest first, in the bank's order
      return c * sign || y.date.localeCompare(x.date) || (y.seq ?? 0) - (x.seq ?? 0);
    });
    return out;
  }, [rows, q, range, dir, kind, tag, onlyAsk, min, max, sort]);

  const pages = Math.max(1, Math.ceil(shown.length / size));
  const at = Math.min(page, pages - 1);
  const slice = shown.slice(at * size, at * size + size);
  const ins = shown.filter((r) => r.amount > 0).reduce((s, r) => s + r.amount, 0);
  const outs = shown.filter((r) => r.amount < 0).reduce((s, r) => s - r.amount, 0);
  const filtered =
    q || period !== 'all' || dir !== 'all' || kind || tag || min || max || onlyAsk ? true : false;
  const reset = () => {
    setQ('');
    setPeriod('all');
    setFrom('');
    setTo('');
    setDir('all');
    setKind('');
    setTag('');
    setMin('');
    setMax('');
    setOnlyAsk(false);
    setSort({ key: 'date', desc: true });
    setPage(0);
  };
  const by = (key: SortKey) => () => {
    setSort((s) => ({ key, desc: s.key === key ? !s.desc : key === 'date' || key === 'amount' }));
    setPage(0);
  };
  const arrow = (key: SortKey) => (sort.key === key ? (sort.desc ? ' ↓' : ' ↑') : '');
  const ariaSort = (key: SortKey) =>
    sort.key === key ? (sort.desc ? 'descending' : 'ascending') : 'none';
  const exportCsv = () => {
    const head = [
      'Date',
      'What the bank wrote',
      'What it is',
      'Tag',
      'Account',
      'Money in',
      'Money out',
      'Balance',
      'To answer',
    ];
    const body = shown.map((r) =>
      [
        r.date,
        r.narration,
        r.kind,
        r.tag ?? '',
        r.account ?? '',
        r.amount > 0 ? r.amount : null,
        r.amount < 0 ? -r.amount : null,
        r.balance,
        r.toAnswer ? 'yes' : '',
      ]
        .map(csvCell)
        .join(','),
    );
    const blob = new Blob([`\uFEFF${[head.join(','), ...body].join('\n')}\n`], {
      type: 'text/csv;charset=utf-8',
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${fileName}${range ? `-${range.from}-to-${range.to}` : ''}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const reset0 =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v);
      setPage(0);
    };

  return (
    <div className="tx" data-testid="txn-table">
      <div className="tx-filters" role="search" aria-label="Find transactions">
        <label className="tx-search">
          <span className="sr-only">Search</span>
          <input
            type="search"
            placeholder="Search: name, words, amount…"
            value={q}
            onChange={(e) => reset0(setQ)(e.target.value)}
          />
        </label>
        <label>
          <span>Period</span>
          <select value={period} onChange={(e) => reset0(setPeriod)(e.target.value as Period)}>
            {PERIODS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        {period === 'custom' && (
          <>
            <label>
              <span>From date</span>
              <input type="date" value={from} onChange={(e) => reset0(setFrom)(e.target.value)} />
            </label>
            <label>
              <span>To date</span>
              <input type="date" value={to} onChange={(e) => reset0(setTo)(e.target.value)} />
            </label>
          </>
        )}
        <label>
          <span>Direction</span>
          <select
            value={dir}
            onChange={(e) => reset0(setDir)(e.target.value as 'all' | 'in' | 'out')}
          >
            <option value="all">In and out</option>
            <option value="in">Money in</option>
            <option value="out">Money out</option>
          </select>
        </label>
        <label>
          <span>What it is</span>
          <select value={kind} onChange={(e) => reset0(setKind)(e.target.value)}>
            <option value="">Every kind</option>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
        {tags.length > 0 && (
          <label>
            <span>Tag</span>
            <select value={tag} onChange={(e) => reset0(setTag)(e.target.value)}>
              <option value="">Every tag</option>
              {tags.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="tx-amt">
          <span>Min amount</span>
          <input
            inputMode="decimal"
            placeholder="₹ min"
            value={min}
            onChange={(e) => reset0(setMin)(e.target.value)}
          />
        </label>
        <label className="tx-amt">
          <span>Max amount</span>
          <input
            inputMode="decimal"
            placeholder="₹ max"
            value={max}
            onChange={(e) => reset0(setMax)(e.target.value)}
          />
        </label>
        <label className="tx-check">
          <input
            type="checkbox"
            checked={onlyAsk}
            onChange={(e) => reset0(setOnlyAsk)(e.target.checked)}
          />
          <span>Only those to answer</span>
        </label>
      </div>

      <div className="tx-summary" aria-live="polite">
        <span>
          <strong>{shown.length}</strong> of {rows.length} lines
          {range && (
            <span className="muted">
              {' '}
              · {range.from === '0000-01-01' ? 'the start' : niceDate(range.from)} to{' '}
              {range.to === '9999-12-31' ? 'today' : niceDate(range.to)}
            </span>
          )}
        </span>
        <span className="tx-totals">
          <span className="good">In {inr(ins)}</span>
          <span>Out {inr(outs)}</span>
          <span className="muted">Net {signed(ins - outs)}</span>
        </span>
        <span className="tx-actions">
          {filtered && (
            <button type="button" className="linkbtn" onClick={reset}>
              Clear filters
            </button>
          )}
          <button
            type="button"
            className="btn compact"
            onClick={exportCsv}
            disabled={!shown.length}
          >
            Export CSV
          </button>
        </span>
      </div>

      {shown.length === 0 ? (
        <p className="tx-empty">No line matches. Change or clear the filters.</p>
      ) : (
        <table className="tx-table">
          <thead>
            <tr>
              <th scope="col" aria-sort={ariaSort('date')}>
                <button type="button" onClick={by('date')}>
                  Date{arrow('date')}
                </button>
              </th>
              <th scope="col" aria-sort={ariaSort('narration')}>
                <button type="button" onClick={by('narration')}>
                  What the bank wrote{arrow('narration')}
                </button>
              </th>
              <th scope="col" aria-sort={ariaSort('kind')}>
                <button type="button" onClick={by('kind')}>
                  What it is{arrow('kind')}
                </button>
              </th>
              <th scope="col" className="num" aria-sort={ariaSort('amount')}>
                <button type="button" onClick={by('amount')}>
                  Amount{arrow('amount')}
                </button>
              </th>
              <th scope="col" className="num" aria-sort={ariaSort('balance')}>
                <button type="button" onClick={by('balance')}>
                  Balance{arrow('balance')}
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {slice.map((r) => {
              const href = hrefTemplate.replace('{id}', r.id).replace('{asset}', r.assetId ?? '');
              return (
                <tr key={r.id} className={r.toAnswer ? 'tx-ask' : undefined}>
                  <td className="tx-date" data-label="Date">
                    <Link href={href}>{niceDate(r.date)}</Link>
                  </td>
                  <td className="tx-narr" data-label="What the bank wrote">
                    <Link href={href} title={r.narration}>
                      {r.narration || '—'}
                    </Link>
                    {withAccount && r.account && <div className="muted small">{r.account}</div>}
                  </td>
                  <td className="tx-kind" data-label="What it is">
                    {r.kind}
                    {r.tag && (
                      <span
                        className="tx-tag"
                        title={r.bestGuess ? 'Best explanation, not certain' : undefined}
                      >
                        {r.tag}
                        {r.bestGuess ? ' (best guess)' : ''}
                      </span>
                    )}
                    {r.toAnswer && <span className="tx-flag">To answer</span>}
                  </td>
                  <td
                    className={`num tx-amount ${r.amount >= 0 ? 'good' : ''}`}
                    data-label="Amount"
                  >
                    {signed(r.amount)}
                  </td>
                  <td className="num tx-bal muted" data-label="Balance">
                    {r.balance === null ? '—' : inr(r.balance)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {shown.length > 0 && (
        <nav className="tx-pager" aria-label="Pages">
          <label>
            <span>Rows</span>
            <select
              value={size}
              onChange={(e) => {
                setSize(Number(e.target.value));
                setPage(0);
              }}
            >
              {[25, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <span className="muted small">
            {at * size + 1}–{Math.min(shown.length, at * size + size)} of {shown.length}
          </span>
          <span className="tx-pages">
            <button
              type="button"
              className="btn compact"
              onClick={() => setPage(0)}
              disabled={at === 0}
            >
              «
            </button>
            <button
              type="button"
              className="btn compact"
              onClick={() => setPage(at - 1)}
              disabled={at === 0}
            >
              Previous
            </button>
            <span className="small">
              Page {at + 1} of {pages}
            </span>
            <button
              type="button"
              className="btn compact"
              onClick={() => setPage(at + 1)}
              disabled={at >= pages - 1}
            >
              Next
            </button>
            <button
              type="button"
              className="btn compact"
              onClick={() => setPage(pages - 1)}
              disabled={at >= pages - 1}
            >
              »
            </button>
          </span>
        </nav>
      )}
    </div>
  );
}
