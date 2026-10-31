import Link from 'next/link';
import {
  TERMS,
  categoryLabel,
  earnedPct,
  formatInr,
  type SavedByTag,
  type SpanFigures,
  type YearFigures,
} from '@fwos/core';
import { niceDate } from '@/lib/dates';
import { pct, rupees, tone } from '../dashboard/parts';
import './earned-saved.css';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthName = (iso: string) => `${MON[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
/** The day before an exclusive end: a stretch "to 1 Nov" ends on 31 Oct. */
const lastDay = (iso: string) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

/** A signed amount in its colour, or a dash for nothing. */
function Amt({ n, plain = false }: { n: number; plain?: boolean }) {
  if (Math.round(n) === 0) return <span className="muted">–</span>;
  return <span className={plain ? '' : tone(n)}>{rupees(n)}</span>;
}

function Pct({ v, note }: { v: number | null; note?: string }) {
  if (v === null) return <span className="muted">–</span>;
  return (
    <span className={tone(v)}>
      {pct(v, 1)}
      {note ? <span className="muted small"> {note}</span> : null}
    </span>
  );
}

/** The years chained: what ₹1 at work at the start grew to by its earnings alone, year after year. */
function chained(years: YearFigures[]): number | null {
  let g = 1;
  let any = false;
  for (const y of years)
    if (y.pct !== null) {
      g *= 1 + y.pct;
      any = true;
    }
  return any ? g - 1 : null;
}

/**
 * Earned and saved: every financial year on one table (what the holdings earned, what was saved, and the return on the money at work),
 * then the chosen year by month and by tag, each with its total at the bottom. Earned + saved = the change in net worth, every row.
 */
export function EarnedSavedView({
  years,
  fy,
  base,
  byTag,
  sample = false,
}: {
  years: YearFigures[];
  /** the year opened below the summary */
  fy: number;
  base: string;
  /** the chosen year's bank lines by tag; null when there are no bank lines (or in the sample) */
  byTag: SavedByTag | null;
  sample?: boolean;
}) {
  if (years.length === 0)
    return (
      <section className="card">
        <p className="muted">
          Nothing to show yet: the figures start once balances or deposits are recorded.
        </p>
      </section>
    );
  const year = years.find((y) => y.fy === fy) ?? years[0]!;
  const sum = (f: (y: YearFigures) => number) => years.reduce((a, y) => a + f(y), 0);
  const all = chained([...years].reverse());
  return (
    <>
      <section className="card es" aria-labelledby="es-years-h" data-testid="es-years">
        <h2 id="es-years-h">Year by year</h2>
        <p className="muted small">
          <strong>{TERMS.earnedFy.label.replace(' this FY', '')}</strong>: what the holdings earned
          (interest, fund profit and loss, exchange-rate moves, earnings less costs).{' '}
          <strong>Saved</strong>: money that came in less money that went out (salary, transfers
          from abroad, money back, spending). <strong>%</strong>: earned ÷ the money at work (net
          worth on 1 April plus half of what was saved, as savings arrive through the year). Choose
          a year for its months.
        </p>
        <div className="tablewrap">
          <table className="tbl es-table">
            <thead>
              <tr>
                <th scope="col">Year</th>
                <th scope="col" className="num">
                  Earned
                </th>
                <th scope="col" className="num">
                  Saved
                </th>
                <th scope="col" className="num">
                  %
                </th>
              </tr>
            </thead>
            <tbody>
              {years.map((y) => (
                <tr
                  key={y.fy}
                  className={y.fy === year.fy ? 'es-on' : undefined}
                  data-testid={`es-year-${y.fy}`}
                >
                  <th scope="row">
                    <Link href={`${base}?fy=${y.fy}`} aria-current={y.fy === year.fy || undefined}>
                      {y.label}
                    </Link>
                    {y.partial && (
                      <div className="muted small">
                        {niceDate(y.from)} to {niceDate(lastDay(y.to))}
                      </div>
                    )}
                  </th>
                  <td className="num">
                    <Amt n={y.earned} />
                  </td>
                  <td className="num">
                    <Amt n={y.saved} />
                  </td>
                  <td className="num">
                    <Pct v={y.pct} />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="sum" data-testid="es-years-total">
                <th scope="row">Total</th>
                <td className="num">
                  <Amt n={sum((y) => y.earned)} />
                </td>
                <td className="num">
                  <Amt n={sum((y) => y.saved)} />
                </td>
                <td className="num">
                  <Pct v={all} note="overall" />
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        {years.some((y) => y.estimated) && (
          <p className="muted small">
            Some figures rest on estimates (savings interest worked out from rates, funds valued
            from the latest prices); they settle as statements arrive.
          </p>
        )}
      </section>

      <EarnedByMonth year={year} />
      <SavedByMonth year={year} />
      {byTag ? (
        <SavedTags year={year} t={byTag} sample={sample} />
      ) : (
        !sample && (
          <section className="card es">
            <h2>{year.label}: saved, by tag</h2>
            <p className="muted small">No bank lines for this year yet.</p>
          </section>
        )
      )}
    </>
  );
}

function EarnedByMonth({ year }: { year: YearFigures }) {
  const cols: { key: keyof SpanFigures['earnings']; label: string }[] = [
    { key: 'savings', label: 'Savings interest' },
    { key: 'deposits', label: 'Deposit interest' },
    { key: 'funds', label: 'Funds' },
    { key: 'fx', label: 'Exchange rate' },
    { key: 'others', label: 'Others' },
    { key: 'income', label: 'Earnings less costs' },
  ];
  const sum = (k: keyof SpanFigures['earnings']) =>
    year.months.reduce((a, m) => a + m.earnings[k], 0);
  return (
    <section className="card es" aria-labelledby="es-earned-h" data-testid="es-earned">
      <h2 id="es-earned-h">{year.label}: earned, by month</h2>
      <div className="tablewrap">
        <table className="tbl es-table">
          <thead>
            <tr>
              <th scope="col">Month</th>
              {cols.map((c) => (
                <th key={c.key} scope="col" className="num">
                  {c.label}
                </th>
              ))}
              <th scope="col" className="num">
                Earned
              </th>
              <th scope="col" className="num">
                %
              </th>
            </tr>
          </thead>
          <tbody>
            {year.months.map((m) => (
              <tr key={m.from}>
                <th scope="row">{monthName(m.from)}</th>
                {cols.map((c) => (
                  <td key={c.key} className="num">
                    <Amt n={m.earnings[c.key]} />
                  </td>
                ))}
                <td className="num">
                  <strong>
                    <Amt n={m.earnings.total} />
                  </strong>
                </td>
                <td className="num">
                  <Pct v={earnedPct(m.start, m.earnings.total, m.moved)} />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="sum" data-testid="es-earned-total">
              <th scope="row">Total</th>
              {cols.map((c) => (
                <td key={c.key} className="num">
                  <Amt n={sum(c.key)} />
                </td>
              ))}
              <td className="num">
                <Amt n={year.earned} />
              </td>
              <td className="num">
                <Pct v={year.pct} />
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

function SavedByMonth({ year }: { year: YearFigures }) {
  const sum = (f: (m: SpanFigures) => number) => year.months.reduce((a, m) => a + f(m), 0);
  return (
    <section className="card es" aria-labelledby="es-saved-h" data-testid="es-saved">
      <h2 id="es-saved-h">{year.label}: saved, by month</h2>
      <p className="muted small">
        Saved = net worth at the end − net worth at the start − earned. It needs no tags:
        &ldquo;Confirmed&rdquo; is money you or a bank line said came in or went out (and
        corrections); &ldquo;From balances&rdquo; is the rest, which the balances show moved but
        nothing explains yet.
      </p>
      <div className="tablewrap">
        <table className="tbl es-table">
          <thead>
            <tr>
              <th scope="col">Month</th>
              <th scope="col" className="num">
                Net worth at start
              </th>
              <th scope="col" className="num">
                Confirmed
              </th>
              <th scope="col" className="num">
                From balances
              </th>
              <th scope="col" className="num">
                Saved
              </th>
            </tr>
          </thead>
          <tbody>
            {year.months.map((m) => (
              <tr key={m.from}>
                <th scope="row">{monthName(m.from)}</th>
                <td className="num">{formatInr(Math.round(m.start))}</td>
                <td className="num">
                  <Amt n={m.confirmedExternal + m.corrections} />
                </td>
                <td className="num">
                  <Amt n={m.unexplained} />
                </td>
                <td className="num">
                  <strong>
                    <Amt n={m.moved} />
                  </strong>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="sum" data-testid="es-saved-total">
              <th scope="row">Total</th>
              <td className="num">{formatInr(Math.round(year.start))}</td>
              <td className="num">
                <Amt n={sum((m) => m.confirmedExternal + m.corrections)} />
              </td>
              <td className="num">
                <Amt n={sum((m) => m.unexplained)} />
              </td>
              <td className="num">
                <Amt n={year.saved} />
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="small es-check" data-testid="es-check">
        Check: net worth {formatInr(Math.round(year.start))} on {niceDate(year.from)} + earned{' '}
        {rupees(year.earned)} + saved {rupees(year.saved)} = {formatInr(Math.round(year.end))} on{' '}
        {niceDate(lastDay(year.to))}.
      </p>
    </section>
  );
}

function SavedTags({ year, t, sample }: { year: YearFigures; t: SavedByTag; sample: boolean }) {
  const href = (tag: string | null) =>
    sample || tag === null ? null : `/transactions?tab=lines&tag=${encodeURIComponent(tag)}`;
  return (
    <section className="card es" aria-labelledby="es-tags-h" data-testid="es-tags">
      <h2 id="es-tags-h">{year.label}: saved, by tag</h2>
      <p className="muted small">
        The bank lines of the year that brought money into the family or took it out, by tag (moves
        between your own accounts, deposits and funds are left out; interest is under earned). The
        last row is money with no bank line behind it (transfers from abroad, accounts with no
        statement, balances that changed), so the total is the year&rsquo;s saved figure exactly.
        {t.bestGuess > 0
          ? ` ${t.bestGuess} of these lines ${t.bestGuess === 1 ? 'is' : 'are'} tagged by best guess; a wrong tag moves money between rows here, never the total.`
          : ''}
      </p>
      <div className="tablewrap">
        <table className="tbl es-table">
          <thead>
            <tr>
              <th scope="col">Tag</th>
              <th scope="col" className="num">
                In
              </th>
              <th scope="col" className="num">
                Out
              </th>
              <th scope="col" className="num">
                Net
              </th>
            </tr>
          </thead>
          <tbody>
            {t.rows.map((r) => {
              const h = href(r.tag);
              const name = r.tag ? categoryLabel(r.tag) : 'No tag';
              return (
                <tr key={r.tag ?? '-'}>
                  <th scope="row">
                    {h ? <Link href={h}>{name}</Link> : name}{' '}
                    <span className="muted small">
                      · {r.lines} line{r.lines === 1 ? '' : 's'}
                    </span>
                  </th>
                  <td className="num">
                    <Amt n={r.into} plain />
                  </td>
                  <td className="num">
                    <Amt n={r.out} plain />
                  </td>
                  <td className="num">
                    <Amt n={r.net} />
                  </td>
                </tr>
              );
            })}
            <tr className="es-rest" data-testid="es-tags-rest">
              <th scope="row">Not on bank lines</th>
              <td />
              <td />
              <td className="num">
                <Amt n={t.notOnLines} />
              </td>
            </tr>
          </tbody>
          <tfoot>
            <tr className="sum" data-testid="es-tags-total">
              <th scope="row">Total = saved</th>
              <td className="num">
                <Amt n={t.rows.reduce((a, r) => a + r.into, 0)} plain />
              </td>
              <td className="num">
                <Amt n={t.rows.reduce((a, r) => a + r.out, 0)} plain />
              </td>
              <td className="num">
                <Amt n={t.total} />
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
