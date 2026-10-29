import Link from 'next/link';
import {
  formatInr,
  formatInrCompact,
  type FundGroup,
  type GroupTotals,
  type Mover,
  type PersonStyle,
  type UpcomingSip,
} from '@fwos/core';
import { pct, rupees, tone } from '@/components/InvestHeadline';
import { PersonBadge } from '@/components/Person';
import { daysPhrase, niceDate } from '@/lib/dates';
import './invest.css';

const inr = (n: number) => formatInr(Math.round(n));

/** The funds that moved most today and over their life, with a link to each. */
export function Movers({
  best,
  worst,
  bestDay,
  worstDay,
  href,
  count,
}: {
  best: Mover | null;
  worst: Mover | null;
  bestDay: Mover | null;
  worstDay: Mover | null;
  href: (id: string) => string;
  count: number;
}) {
  void count;
  const item = (label: string, m: Mover | null, digits: number) => (
    <li key={label}>
      <span className="mv-l">{label}</span>
      {m ? (
        <>
          <Link href={href(m.assetId)} className="mv-n" title={m.name}>
            {m.name}
          </Link>
          <b className={tone(m.pct)}>{pct(m.pct, digits)}</b>
        </>
      ) : (
        <span className="muted small">needs two funds</span>
      )}
    </li>
  );
  return (
    <ul className="movers">
      {item('Best today', bestDay, 2)}
      {item('Weakest today', worstDay, 2)}
      {item('Best overall', best, 1)}
      {item('Weakest overall', worst, 1)}
    </ul>
  );
}

export function UpcomingSips({ list, today }: { list: UpcomingSip[]; today: string }) {
  if (list.length === 0) return <p className="empty">No monthly investment is running.</p>;
  const total = list.reduce((a, x) => a + x.amount, 0);
  return (
    <>
      <ul className="upsips">
        {list.map((s) => {
          const days = Math.max(
            0,
            Math.round(
              (Date.parse(`${s.on}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
            ),
          );
          return (
            <li key={s.assetId}>
              <span className="d">
                <b>{niceDate(s.on)}</b>
                <span className="muted small"> {daysPhrase(days)}</span>
              </span>
              <span className="f" title={s.fund}>
                {s.fund}
              </span>
              <span className="a">{inr(s.amount)}</span>
              {s.estimated && (
                <span
                  className="estchip"
                  title="Expected from the SIP plan; there is no statement to read the day from"
                >
                  expected
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <p className="cardnote">
        {inr(total)} goes in over these instalments. The days follow your past instalments on the
        statement; funds without one use the start date.
      </p>
    </>
  );
}

/** Goal by goal: what is set aside, what it is worth and what it has gained, as bars. */
export function GoalSummary({
  groups,
  grand,
  groupHref,
  goalsHref,
}: {
  groups: FundGroup[];
  grand: GroupTotals;
  groupHref: string;
  goalsHref: string;
}) {
  const max = Math.max(1, ...groups.map((g) => g.totals.value));
  if (groups.length === 0) return null;
  return (
    <>
      <ul className="goalbars" aria-label="Value by goal">
        {groups.map((g) => (
          <li key={g.key} className={g.key.startsWith('__') ? 'nogoal' : ''}>
            <span className="gb-name">
              <b>{g.label}</b>
              <span className="muted small">
                {' '}
                {g.totals.funds} fund{g.totals.funds === 1 ? '' : 's'}
              </span>
            </span>
            <span className="gb-track" role="presentation">
              <span
                className="gb-in"
                style={{ width: `${(Math.min(g.totals.invested, g.totals.value) / max) * 100}%` }}
              />
              {g.totals.value > g.totals.invested && (
                <span
                  className="gb-gain"
                  style={{ width: `${((g.totals.value - g.totals.invested) / max) * 100}%` }}
                />
              )}
            </span>
            <span className="gb-val">
              {formatInrCompact(g.totals.value)}
              <span className={`small ${tone(g.totals.gain)}`}>
                {' '}
                {rupees(g.totals.gain)}
                {g.totals.gainPct !== null ? ` (${pct(g.totals.gainPct, 1)})` : ''}
              </span>
            </span>
          </li>
        ))}
      </ul>
      <ul className="vizlegend">
        <li>
          <span className="sw" style={{ background: 'var(--viz-1)' }} aria-hidden="true" /> Money
          put in
        </li>
        <li>
          <span className="sw" style={{ background: 'var(--viz-good)' }} aria-hidden="true" />{' '}
          Growth
        </li>
      </ul>
      <p className="cardnote">
        {formatInrCompact(grand.value)} in all.{' '}
        <Link href={groupHref}>See the funds goal by goal</Link>
        {' · '}
        <Link href={goalsHref}>Goals and what each needs</Link>
      </p>
    </>
  );
}

export interface PersonRow {
  ownerId: string;
  name: string;
  totals: GroupTotals;
  folios: number;
  r1y: number | null;
  longShare: number | null;
  topShare: number | null;
}

/** One line per person with the figures side by side, so two people can be compared at a glance. */
export function PersonCompare({
  rows,
  styles,
  topN,
}: {
  rows: PersonRow[];
  styles: Record<string, PersonStyle>;
  topN: number;
}) {
  return (
    <div className="cmpwrap">
      <table className="tbl lines cmp">
        <thead>
          <tr>
            <th>Person</th>
            <th className="num">Funds</th>
            <th className="num">Invested now</th>
            <th className="num">Value today</th>
            <th className="num">Profit or loss</th>
            <th className="num">Today</th>
            <th className="num">Return a year</th>
            <th className="num">Last 1Y</th>
            <th className="num">Share</th>
            <th className="num">SIP a month</th>
            <th className="num">Long-term</th>
            <th className="num">Top {topN}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.ownerId}>
              <td data-label="Person">
                <span className="personline">
                  <PersonBadge p={styles[r.ownerId]} name size={20} />
                </span>
              </td>
              <td className="num" data-label="Funds">
                {r.totals.funds}
                {r.folios > 0 && <span className="fl-s">{r.folios} folios</span>}
              </td>
              <td className="num" data-label="Invested now">
                {inr(r.totals.invested)}
              </td>
              <td className="num" data-label="Value today">
                {inr(r.totals.value)}
              </td>
              <td className={`num ${tone(r.totals.gain)}`} data-label="Profit or loss">
                {rupees(r.totals.gain)}
                <span className="fl-s">
                  {r.totals.gainPct === null ? '' : pct(r.totals.gainPct, 1)}
                </span>
              </td>
              <td className={`num ${tone(r.totals.dayAmount)}`} data-label="Today">
                {r.totals.dayAmount === null ? '–' : rupees(r.totals.dayAmount)}
                <span className="fl-s">{r.totals.dayPct === null ? '' : pct(r.totals.dayPct)}</span>
              </td>
              <td className={`num ${tone(r.totals.xirr)}`} data-label="Return a year">
                {r.totals.xirr === null ? '–' : pct(r.totals.xirr, 1)}
                {r.totals.xirr !== null && r.totals.xirrEstimated && (
                  <span className="fl-est"> ~</span>
                )}
              </td>
              <td className={`num ${tone(r.r1y)}`} data-label="Last 1Y">
                {r.r1y === null ? '–' : pct(r.r1y, 1)}
              </td>
              <td className="num" data-label="Share">
                {(r.totals.share * 100).toFixed(r.totals.share < 0.1 ? 1 : 0)}%
              </td>
              <td className="num" data-label="SIP a month">
                {r.totals.sipMonthly > 0 ? inr(r.totals.sipMonthly) : '–'}
              </td>
              <td className="num" data-label="Long-term">
                {r.longShare === null ? '–' : `${Math.round(r.longShare * 100)}%`}
              </td>
              <td className="num" data-label={`Top ${topN}`}>
                {r.topShare === null ? '–' : `${Math.round(r.topShare * 100)}%`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
