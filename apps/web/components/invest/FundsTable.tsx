'use client';

import Link from 'next/link';
import { useMemo, useState, type ReactNode } from 'react';
import {
  FUND_COLUMNS,
  formatInr,
  searchLines,
  sortLines,
  type FundGroup,
  type FundLine,
  type FundSortKey,
  type GroupBy,
  type GroupTotals,
  type PersonLedgerSummary,
  type PersonStyle,
} from '@fwos/core';
import { Est, LEDGER_EST_TITLE } from '@/components/Est';
import { pct, rupees, tone } from '@/components/InvestHeadline';
import { PersonBadge } from '@/components/Person';
import { niceMonth } from '@/lib/dates';
import { toCsv } from '@/lib/listing';
import { DataCheck, LedgerChip } from './DataCheck';
import { EditFundButton } from './FundEdit';
import './invest.css';

const inr = (n: number) => formatInr(Math.round(n));
const units = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 3 });
const money2 = (n: number) =>
  `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const COLS: { key: FundSortKey; label: string; cls: string }[] = [
  { key: 'name', label: 'Fund', cls: 'c-name' },
  { key: 'invested', label: 'Invested', cls: 'c-inv' },
  { key: 'value', label: 'Value now', cls: 'c-val' },
  { key: 'gain', label: 'Profit or loss', cls: 'c-pl' },
  { key: 'dayAmount', label: 'Today', cls: 'c-day' },
  { key: 'xirr', label: 'Return a year', cls: 'c-xirr' },
  { key: 'sipMonthly', label: 'SIP a month', cls: 'c-sip' },
];

function Totals({ t, label }: { t: GroupTotals; label?: ReactNode }) {
  return (
    <>
      <td className="c-name fl-glabel">{label}</td>
      <td className="num c-inv" data-label="Invested">
        {inr(t.invested)}
        {t.unreconciled > 0 && <Est title={LEDGER_EST_TITLE} />}
      </td>
      <td className="num c-val" data-label="Value now">
        {inr(t.value)}
        {t.unreconciled > 0 && <Est title={LEDGER_EST_TITLE} />}
        <span className="fl-s">{(t.share * 100).toFixed(t.share < 0.1 ? 1 : 0)}% of total</span>
      </td>
      <td className={`num c-pl ${tone(t.gain)}`} data-label="Profit or loss">
        {rupees(t.gain)}
        {t.unreconciled > 0 && <Est title={LEDGER_EST_TITLE} />}
        <span className="fl-s">{t.gainPct === null ? '–' : pct(t.gainPct, 1)}</span>
      </td>
      <td className={`num c-day ${tone(t.dayAmount)}`} data-label="Today">
        {t.dayAmount === null ? '–' : rupees(t.dayAmount)}
        <span className="fl-s">{t.dayPct === null ? '' : pct(t.dayPct)}</span>
      </td>
      <td className={`num c-xirr ${tone(t.xirr)}`} data-label="Return a year">
        {t.xirr === null ? '–' : pct(t.xirr, 1)}
        {t.xirr !== null && t.xirrEstimated && (
          <span className="fl-est" title="Partly estimated">
            {' '}
            ~
          </span>
        )}
      </td>
      <td className="num c-sip" data-label="SIP a month">
        {t.sipMonthly > 0 ? inr(t.sipMonthly) : '–'}
      </td>
      <td className="c-act" />
    </>
  );
}

function Row({
  l,
  goalName,
  fundHref,
  matchHref,
  showGoal,
}: {
  l: FundLine;
  goalName: Record<string, string>;
  fundHref: (id: string) => string;
  matchHref: string;
  showGoal: boolean;
}) {
  const sub = [
    l.units !== null ? `${units(l.units)} units` : 'units not recorded',
    l.startedOn ? `since ${niceMonth(l.startedOn)}` : null,
    l.nav !== null && l.navDate ? `price ${money2(l.nav)}` : null,
  ].filter(Boolean);
  const full = [
    l.name,
    `${l.categoryLabel}${l.categoryCertain ? '' : ' (guessed from the name)'}`,
    l.amc,
    l.plan !== 'unknown' ? `${l.plan} plan` : null,
    ...sub,
    l.avgCost !== null ? `average cost ${money2(l.avgCost)}` : null,
    `value: ${l.valueBasis}`,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <tr className="fl-row">
      <td className="c-name">
        <div className="fl-name">
          <Link href={fundHref(l.assetId)} title={full}>
            {l.name}
          </Link>
          {l.plan === 'regular' && (
            <span className="plantag" title="Regular plan: the fund pays a distributor commission">
              Regular
            </span>
          )}
          {showGoal && l.goalIds.length > 0 && (
            <span className="goalchip">
              {l.goalIds.length === 1
                ? (goalName[l.goalIds[0]!] ?? 'Goal')
                : `${l.goalIds.length} goals`}
            </span>
          )}
          <LedgerChip chip={l.ledgerChip} />
          {!l.amfiCode && (
            <Link
              className="nopricechip"
              href={matchHref}
              title="Match this fund to its official scheme so its price follows the market"
            >
              No live price
            </Link>
          )}
        </div>
        <div className="fl-sub" title={full}>
          <span
            className="kindchip"
            title={l.categoryCertain ? undefined : 'Guessed from the fund name'}
          >
            {l.categoryLabel}
            {l.categoryCertain ? '' : ' ?'}
          </span>
          <span className="fl-subtext">{sub.join(' · ')}</span>
        </div>
      </td>
      <td className="num c-inv" data-label="Invested">
        {l.invested ? inr(l.invested) : '–'}
        {l.invested > 0 && l.figuresEstimated && <Est title={LEDGER_EST_TITLE} />}
        <span className="fl-s">{l.avgCost !== null ? `avg ${money2(l.avgCost)}` : ''}</span>
      </td>
      <td className="num c-val" data-label="Value now">
        {l.value ? inr(l.value) : '–'}
        {l.value > 0 && l.figuresEstimated && <Est title={LEDGER_EST_TITLE} />}
        <span className="fl-s">
          {l.value > 0 ? `${(l.share * 100).toFixed(l.share < 0.1 ? 1 : 0)}% of total` : ''}
        </span>
      </td>
      <td className={`num c-pl ${l.invested ? tone(l.gain) : ''}`} data-label="Profit or loss">
        {l.invested ? rupees(l.gain) : '–'}
        {l.invested > 0 && l.figuresEstimated && <Est title={LEDGER_EST_TITLE} />}
        <span className="fl-s">{l.gainPct === null ? '' : pct(l.gainPct, 1)}</span>
      </td>
      <td className={`num c-day ${tone(l.dayAmount)}`} data-label="Today">
        {l.dayAmount === null ? '–' : rupees(l.dayAmount)}
        <span className="fl-s">{l.dayPct === null ? '' : pct(l.dayPct)}</span>
      </td>
      <td className={`num c-xirr ${tone(l.xirr)}`} data-label="Return a year">
        {l.xirr === null ? '–' : pct(l.xirr, 1)}
        {l.xirr !== null && l.xirrEstimated && (
          <span
            className="fl-est"
            title="Estimated from the start date and SIP; exact once the fund statement is imported"
          >
            {' '}
            ~
          </span>
        )}
        {l.xirr !== null && l.figuresEstimated && <Est title={LEDGER_EST_TITLE} />}
        <span className={`fl-s ${tone(l.ret1y)}`}>
          {l.ret1y === null ? '' : `1Y price ${pct(l.ret1y, 1)}`}
        </span>
      </td>
      <td className="num c-sip" data-label="SIP a month">
        {l.sipMonthly ? (
          l.sipStopped ? (
            <span className="muted">stopped</span>
          ) : (
            inr(l.sipMonthly)
          )
        ) : (
          '–'
        )}
        <span className="fl-s">{l.sipMonthly && !l.sipStopped ? 'running' : ''}</span>
      </td>
      <td className="c-act">
        <EditFundButton id={l.assetId} name={l.name} />
      </td>
    </tr>
  );
}

/**
 * The funds, one compact row each (name and a slim second line on the left, the figures right-aligned), grouped by person, goal,
 * kind of fund or fund house with a heading row of totals per group and a grand total. Search and sort work on the page. On a phone
 * each fund is a small card. The grouping itself is chosen by link so it has an address.
 */
export function FundsTable({
  groups,
  grand,
  by,
  styles,
  goalName,
  demo,
  matchHref,
  checks,
}: {
  groups: FundGroup[];
  grand: GroupTotals | null;
  by: GroupBy;
  styles: Record<string, PersonStyle>;
  goalName: Record<string, string>;
  demo: boolean;
  matchHref: string;
  /** the data check of each person, shown under the person's heading when the funds are grouped by person */
  checks?: Record<string, PersonLedgerSummary>;
}) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<{ key: FundSortKey; dir: 1 | -1 } | null>(null);
  const fundHref = (id: string) => (demo ? `/demo/asset?kind=fund&id=${id}` : `/asset/${id}`);
  const shown = useMemo(
    () =>
      groups
        .map((g) => {
          const found = searchLines(g.lines, q);
          return { ...g, lines: sort ? sortLines(found, sort.key, sort.dir) : found };
        })
        .filter((g) => g.lines.length > 0),
    [groups, q, sort],
  );
  const total = groups.reduce((a, g) => a + g.lines.length, 0);
  const count = shown.reduce((a, g) => a + g.lines.length, 0);
  const filtering = q.trim() !== '';

  const toggle = (key: FundSortKey) =>
    setSort((s) =>
      s && s.key === key
        ? s.dir === 1
          ? { key, dir: -1 }
          : null
        : { key, dir: key === 'name' ? 1 : -1 },
    );
  const ariaSort = (key: FundSortKey) =>
    sort?.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none';

  const exportCsv = () => {
    const rows: string[][] = [
      [
        'Group',
        'Fund',
        'Person',
        'Kind',
        'Fund house',
        'Invested',
        'Value',
        'Profit or loss',
        'Profit or loss %',
        'Today',
        'Today %',
        'XIRR',
        '1 year price return',
        'Share of total',
        'SIP a month',
      ],
    ];
    const n = (v: number | null, d = 2) => (v === null ? '' : v.toFixed(d));
    for (const g of shown)
      for (const l of g.lines)
        rows.push([
          g.label,
          l.name,
          l.ownerName,
          l.categoryLabel,
          l.amc ?? '',
          n(l.invested),
          n(l.value),
          n(l.gain),
          n(l.gainPct === null ? null : l.gainPct * 100),
          n(l.dayAmount),
          n(l.dayPct === null ? null : l.dayPct * 100),
          n(l.xirr === null ? null : l.xirr * 100),
          n(l.ret1y === null ? null : l.ret1y * 100),
          n(l.share * 100),
          n(l.sipStopped ? null : l.sipMonthly),
        ]);
    const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `funds-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  return (
    <div className="fundslist">
      <div
        className="listtools noprint"
        role="search"
        aria-label="Search, sort and export the funds"
      >
        <input
          type="search"
          className="lt-search"
          placeholder="Search funds, kinds, houses, people…"
          aria-label="Search this list"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <label className="lt-sort">
          <span className="sr-only">Sort by</span>
          <select
            aria-label="Sort by"
            value={sort?.key ?? ''}
            onChange={(e) =>
              setSort(
                e.target.value
                  ? { key: e.target.value as FundSortKey, dir: sort?.dir ?? -1 }
                  : null,
              )
            }
          >
            <option value="">Sort: largest first</option>
            {FUND_COLUMNS.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn compact"
          disabled={!sort}
          onClick={() => sort && setSort({ ...sort, dir: sort.dir === 1 ? -1 : 1 })}
          aria-label={
            sort
              ? `Sorted ${sort.dir === 1 ? 'ascending' : 'descending'}; switch direction`
              : 'Choose a column to sort'
          }
        >
          {sort ? (sort.dir === 1 ? '↑ Low to high' : '↓ High to low') : '↕'}
        </button>
        <button type="button" className="btn compact" onClick={exportCsv} disabled={count === 0}>
          Export CSV
        </button>
        <span className="small muted" aria-live="polite">
          {count === total ? `${total} funds` : `${count} of ${total} funds`}
        </span>
      </div>

      <div className="fl-wrap">
        <table className="fl">
          <colgroup>
            <col className="k-name" />
            <col className="k-inv" />
            <col className="k-val" />
            <col className="k-pl" />
            <col className="k-day" />
            <col className="k-xirr" />
            <col className="k-sip" />
            <col className="k-act" />
          </colgroup>
          <thead>
            <tr>
              {COLS.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={`${c.cls} ${c.key === 'name' ? '' : 'num'}`}
                  aria-sort={ariaSort(c.key)}
                >
                  <button type="button" className="thbtn" onClick={() => toggle(c.key)}>
                    {c.label}
                    <span aria-hidden="true">
                      {sort?.key === c.key ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}
                    </span>
                  </button>
                </th>
              ))}
              <th className="c-act">
                <span className="sr-only">Edit</span>
              </th>
            </tr>
          </thead>
          {shown.map((g) => {
            const person = by === 'person' ? styles[g.key] : undefined;
            return (
              <tbody
                key={g.key}
                style={{ ['--person' as string]: person?.colour }}
                className={person ? 'fl-person' : ''}
              >
                {(groups.length > 1 || by !== 'none') && by !== 'none' && (
                  <tr className="fl-grouphead">
                    {filtering ? (
                      <td className="c-name fl-glabel" colSpan={8}>
                        {person ? (
                          <PersonBadge p={person} name size={20} />
                        ) : (
                          <strong>{g.label}</strong>
                        )}
                        <span className="muted small">
                          {' '}
                          · {g.lines.length} fund{g.lines.length === 1 ? '' : 's'} match
                        </span>
                      </td>
                    ) : (
                      <Totals
                        t={g.totals}
                        label={
                          <>
                            {person ? (
                              <PersonBadge p={person} name size={20} />
                            ) : (
                              <strong>{g.label}</strong>
                            )}
                            <span className="muted small">
                              {' '}
                              · {g.totals.funds} fund{g.totals.funds === 1 ? '' : 's'}
                            </span>
                          </>
                        }
                      />
                    )}
                  </tr>
                )}
                {by === 'person' && !filtering && checks?.[g.key] && (
                  <tr className="fl-datacheck">
                    <td colSpan={8}>
                      <DataCheck summary={checks[g.key]!} fundHref={fundHref} />
                    </td>
                  </tr>
                )}
                {g.lines.map((l) => (
                  <Row
                    key={l.assetId}
                    l={l}
                    goalName={goalName}
                    fundHref={fundHref}
                    matchHref={matchHref}
                    showGoal={by !== 'goal'}
                  />
                ))}
              </tbody>
            );
          })}
          {grand && !filtering && groups.length > 1 && (
            <tfoot>
              <tr className="fl-grand">
                <Totals
                  t={grand}
                  label={
                    <>
                      <strong>All funds shown</strong>
                      <span className="muted small"> · {grand.funds}</span>
                    </>
                  }
                />
              </tr>
            </tfoot>
          )}
        </table>
        {shown.length === 0 && <p className="empty">No fund matches that search.</p>}
      </div>
    </div>
  );
}
