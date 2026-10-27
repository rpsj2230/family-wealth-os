import Link from 'next/link';
import {
  formatInrCompact,
  formatPct,
  type ClassPeriod,
  type ExplainSet,
  type PeriodGainsRow,
  type PeriodWindow,
} from '@fwos/core';
import { plural } from '@/app/(app)/accounts/BankOverview';
import { Est } from '@/components/Est';
import { WhyHead } from '@/components/Why';
import { niceDate } from '@/lib/dates';
import type { HomeModel } from '@/lib/home';
import { homeLink } from './parts';

/** "26 Sep to today", "1 Apr 2025 to 31 Mar 2026". */
function span(w: PeriodWindow, today: string): string {
  if (w.days === 0) return w.clamped ? 'before the data starts' : 'starts today';
  if (w.clamped) return `data starts ${niceDate(w.from)}`;
  return `${niceDate(w.from)} to ${w.through === today ? 'today' : niceDate(w.through)}`;
}

/** What one kind earned in one period: an arrow and a word as well as the colour, the per cent, and any money moved beneath. */
function Cell({ c }: { c: ClassPeriod }) {
  if (c.empty)
    return (
      <span className="hm-nil">
        –<span className="sr-only"> nothing held in this period</span>
      </span>
    );
  const r = Math.round(c.profit);
  const dir = r > 0 ? 'up' : r < 0 ? 'down' : 'flat';
  const moved = [
    c.putIn >= 1 ? `${formatInrCompact(c.putIn)} put in` : null,
    c.takenOut >= 1 ? `${formatInrCompact(c.takenOut)} paid out` : null,
  ].filter(Boolean);
  return (
    <span className={`hm-pcell ${dir}`}>
      <span className="hm-signed-line">
        <span aria-hidden="true" className="bv-arrow">
          {dir === 'up' ? '▲' : dir === 'down' ? '▼' : '▬'}
        </span>
        <span className="sr-only">
          {dir === 'up' ? 'Up ' : dir === 'down' ? 'Down ' : 'No change '}
        </span>
        <strong>{formatInrCompact(Math.abs(c.profit))}</strong>
        {c.pct !== null && <span className="hm-signed-pct">{formatPct(Math.abs(c.pct), 2)}</span>}
        {c.estimated && <Est />}
      </span>
      {moved.length > 0 && <span className="hm-moved">{moved.join(' · ')}</span>}
    </span>
  );
}

const rowSince = (r: PeriodGainsRow) => (r.since ? `${r.label} from ${niceDate(r.since)}` : null);

/**
 * Profit earned in the last days, this month, quarter and financial year, the last financial year and since the start, for every
 * kind of holding and in all. Worked out from the terms of each holding (the shared period figures), not from saved totals; money
 * put in or paid out is shown beneath and is never counted as profit. A table on a wide page, a card per kind on a phone.
 */
export function Periods({
  m,
  sample,
  ex,
}: {
  m: HomeModel;
  sample: boolean;
  ex: ExplainSet<'home'>;
}) {
  const p = m.periods;
  const w = p.windows;
  const rows = [...p.rows, p.total];
  const settings = homeLink('/settings', sample);
  const total = p.total.cells;
  const sentence = (key: PeriodWindow['key']) => {
    const win = w.find((x) => x.key === key)!;
    const c = total[key];
    return `${win.label.toLowerCase()} ${c.empty ? 'nothing held' : `${c.profit < 0 ? 'lost' : 'earned'} ${formatInrCompact(Math.abs(c.profit))}`}`;
  };
  const basis = p.basis;
  const starts = p.rows.map(rowSince).filter((x): x is string => x !== null);
  return (
    <section className="card hm-card hm-wide hm-periods-card" aria-labelledby="hm-periods">
      <header className="hm-head">
        <WhyHead why={ex['home.periods']}>
          <h2 id="hm-periods">Profit earned, by period</h2>
        </WhyHead>
        <span className="muted small">
          worked out from the records and terms, not from saved totals
        </span>
      </header>
      <p className="small" data-testid="hm-periods-summary">
        In all, {sentence('recent')}; {sentence('month')}; {sentence('fy')}; {sentence('lastFy')}.
      </p>
      <p className="small muted">
        Each % is the profit as a share of the money at work in that period; money put in or paid
        out is shown beneath and is never counted as profit.
      </p>
      <table className="hm-periods" data-testid="hm-periods">
        <caption className="sr-only">
          Profit earned by kind of holding in each period, in rupees and as a share of the money at
          work, with money put in or paid out shown separately
        </caption>
        <thead>
          <tr>
            <th scope="col">Kind</th>
            {w.map((x) => (
              <th scope="col" key={x.key}>
                {x.label}
                <span className="hm-pspan">{span(x, m.today)}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className={r.key === 'total' ? 'hm-ptotal' : ''}>
              <th scope="row">{r.label}</th>
              {w.map((x) => (
                <td key={x.key} data-label={x.label}>
                  <Cell c={r.cells[x.key]} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <details className="bv-how">
        <summary>How these are worked out</summary>
        <ul className="list small muted">
          <li>
            This is profit only. The change in net worth also includes money you added or took out,
            so the two differ by design. Every holding is valued on the first day of a period from
            the nearest record on or before it, moved forward at its rate, its fund price or the
            exchange rate; a period that begins before the first record begins where the data does
            and says “data starts”.
          </li>
          <li>
            <strong>Last {plural(w[0]!.days, 'day')}</strong> is the length set in{' '}
            {settings ? <Link href={settings}>Settings</Link> : 'Settings'}. This month, quarter and
            financial year run from the first of the month, from 1 April, 1 July, 1 October or 1
            January, and from 1 April; last financial year is 1 April to 31 March before it.
          </li>
          <li>
            <strong>Fixed deposits:</strong> the interest accrued in the period on each deposit’s
            own terms. A deposit booked in the period starts at its amount on its booking day; one
            that was paid out or renewed adds its interest up to that day. The payout and the new
            booking are money moved, not profit.
            {basis.depositsEndedGuessed > 0
              ? ` For ${plural(basis.depositsEndedGuessed, 'deposit')} no payout day is recorded, so its maturity date is used.`
              : ''}
          </li>
          <li>
            <strong>Mutual funds:</strong> the change in value over the period less the money put
            in, so a purchase is not a gain and a sale is not a loss; a gain already booked by
            selling counts in the period it was sold. Value is the units held then times the price
            of the day. <Est /> marks a period that rests on instalments assumed from a SIP plan or
            on a fund with no statement
            {basis.fundsFromPlan > 0
              ? ` (${plural(basis.fundsFromPlan, 'fund')}, rebuilt from the start date and plan you entered)`
              : ''}
            .
          </li>
          <li>
            <strong>Cash:</strong> the interest the last recorded balance earns at the account’s
            rate, after the tax taken at source, until the next record. Money paid in or taken out
            of an account is not profit. Always <Est />: banks credit interest in lumps.
            {basis.foreignAccounts > 0
              ? ` ${plural(basis.foreignAccounts, 'foreign-currency account')} earn no gain here, because an exchange rate is not interest.`
              : ''}
            {basis.accountsWithoutBalance > 0
              ? ` ${plural(basis.accountsWithoutBalance, 'account')} with no balance recorded yet cannot be worked out.`
              : ''}
          </li>
          <li>
            <strong>Others:</strong> no profit is counted, only the value that was recorded.
          </li>
          <li>
            The per cent is of the money at work: the value at the start plus each sum put in for
            the days it was there. With nothing moved it is exactly the value at the start. Since
            the start is against all the money put in.
            {starts.length > 0 ? ` Since the start begins ${starts.join(', ')}.` : ''} Deposits and
            funds already paid out or sold are included there, so it can be more than the profit on
            what you still hold.
          </li>
        </ul>
      </details>
    </section>
  );
}
