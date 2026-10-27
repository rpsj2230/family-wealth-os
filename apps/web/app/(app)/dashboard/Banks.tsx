import { formatInr, formatInrCompact, formatPct, type ExplainSet } from '@fwos/core';
import { plural, whole } from '@/app/(app)/accounts/BankOverview';
import { niceDate } from '@/lib/dates';
import type { HomeModel } from '@/lib/home';
import { BarRow, CardHead, Signed, homeLink } from './parts';

/** The money in banks: its value, what it earned today (an estimate), and which banks hold it. Same figures as Accounts. */
export function Banks({
  m,
  sample,
  ex,
}: {
  m: HomeModel;
  sample: boolean;
  ex: ExplainSet<'home'>;
}) {
  const o = m.banks.overview;
  const top = Math.max(0.0001, m.banks.lines[0]?.share ?? 0);
  return (
    <section className="card hm-card" aria-labelledby="hm-banks">
      <CardHead
        title="In banks"
        id="hm-banks"
        why={ex['home.banks']}
        href={homeLink('/accounts', sample)}
        linkLabel="Accounts"
      />
      <div className="hm-figure" data-testid="hm-banks-total">
        {formatInrCompact(o.current)}
      </div>
      <div className="bv-exact">{whole(o.current)}</div>
      <p className="muted small">
        {plural(o.accounts, 'account')} and {plural(o.deposits, 'deposit')} in{' '}
        {plural(o.banks, 'bank')}
      </p>
      <p className="hm-chips">
        <Signed label="Profit so far" amount={o.profit} pct={o.profitPct} />
        <Signed label="Earned today" amount={o.today.change} pct={o.today.changePct} estimate />
      </p>
      <h3 className="bv-h hm-sub">Which bank holds how much</h3>
      <ol className="dv-list" data-testid="hm-bank-lines">
        {m.banks.lines.map((b) => (
          <BarRow
            key={b.key}
            name={b.name}
            amount={formatInrCompact(b.amount)}
            share={formatPct(b.share, 0)}
            scale={b.share / top}
            href={b.key === '__other' ? null : homeLink(`/bank/${b.key}`, sample)}
          />
        ))}
      </ol>
      {m.banks.maturedCounted > 0 && (
        <p className="muted small">
          Not in these figures: {formatInrCompact(m.banks.maturedCounted)} in deposits past their
          date, still counted in net worth until you say where the money went.
        </p>
      )}
    </section>
  );
}

/** The fixed deposits: value, profit and earned today, the journey from put in to maturity, interest, and what matures by year. */
export function Deposits({
  m,
  sample,
  ex,
}: {
  m: HomeModel;
  sample: boolean;
  ex: ExplainSet<'home'>;
}) {
  const d = m.deposits;
  const o = d.overview;
  const done = o.interest.journey;
  const biggest = Math.max(1, ...d.ladder.map((s) => s.amount));
  return (
    <section className="card hm-card" aria-labelledby="hm-deposits">
      <CardHead
        title="Fixed deposits"
        id="hm-deposits"
        why={ex['home.deposits']}
        href={homeLink('/deposits', sample)}
        linkLabel="Deposits"
      />
      {o.deposits === 0 ? (
        <p className="muted small">No deposit is running.</p>
      ) : (
        <>
          <div className="hm-figure" data-testid="hm-deposits-total">
            {formatInrCompact(o.current)}
          </div>
          <div className="bv-exact">{whole(o.current)}</div>
          <p className="muted small">
            {plural(o.deposits, 'deposit')} in {plural(d.banks.length, 'bank')}
            {o.fdRate !== null ? ` · ${formatPct(o.fdRate, 2)} a year on average` : ''}
          </p>
          <p className="hm-chips">
            <Signed label="Profit so far" amount={o.profit} pct={o.profitPct} />
            <Signed label="Earned today" amount={o.today.change} pct={o.today.changePct} estimate />
          </p>
          {done !== null && (
            <div className="hm-journey">
              <div
                className="bv-track"
                role="img"
                aria-label={`${formatPct(done, 0)} of the interest has been earned: ${formatInr(Math.round(o.interest.earned))} of ${formatInr(Math.round(o.interest.total))}`}
              >
                <span className="bv-fill" style={{ width: `${done * 100}%` }} />
                <span className="bv-dot" style={{ left: `${done * 100}%` }} />
              </div>
              <dl className="bv-ends">
                <div>
                  <dt>Invested</dt>
                  <dd>{formatInrCompact(o.invested)}</dd>
                </div>
                <div className="mid">
                  <dt>Now</dt>
                  <dd>{formatInrCompact(o.current)}</dd>
                </div>
                <div className="end">
                  <dt>At maturity</dt>
                  <dd>{formatInrCompact(o.maturity)}</dd>
                </div>
              </dl>
            </div>
          )}
          <p className="small">
            <strong>{formatInrCompact(d.interest.thisYear)}</strong> interest added in{' '}
            {d.interest.fy} so far; <strong>{formatInrCompact(d.interest.ahead)}</strong> more over
            the next 12 months if every deposit is held to maturity.
          </p>
          <h3 className="bv-h hm-sub">What matures, year by year</h3>
          <ol className="dv-list" data-testid="hm-ladder">
            {d.ladder.map((s) => (
              <li key={s.year} className="hm-bar">
                <div className="dv-line">
                  <span className="dv-name">{s.year}</span>
                  <strong className="dv-amt">{formatInrCompact(s.amount)}</strong>
                  <span className="dv-pct">{plural(s.count, 'deposit')}</span>
                </div>
                <div className="dv-bar alt" aria-hidden="true">
                  <span style={{ width: `${(s.amount / biggest) * 100}%` }} />
                </div>
              </li>
            ))}
          </ol>
          {o.next && (
            <p className="muted small">
              Next: {formatInrCompact(o.next.amount)} on {niceDate(o.next.date)} ({o.next.bank}
              {o.next.count > 1 ? ` and ${o.next.count - 1} more` : ''}).
            </p>
          )}
        </>
      )}
    </section>
  );
}
