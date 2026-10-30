import { Fragment } from 'react';
import Link from 'next/link';
import { capacityLabel, formatInr, partnerMissing, type PersonStyle } from '@fwos/core';
import './deposits.css';
import { BankBadge } from '@/components/BankBadge';
import { ConfirmMatured } from '@/components/ConfirmMatured';
import { NoticeHost } from '@/components/NoticeHost';
import { PersonBadge } from '@/components/Person';
import { daysPhrase, niceDate } from '@/lib/dates';
import type { DepositsView, FdLine } from '@/lib/deposits';
import {
  depositStatusWord,
  interestAhead,
  maturityWindows,
  needsConfirmation,
  type DepositSummary,
  type MonthGroup,
} from '@/lib/deposits-summary';
import { maturedNote } from '@/lib/matured-list';
import { slugify } from '@/lib/slug';

const KIND: Record<string, string> = {
  NRE: 'NRE',
  NRO: 'NRO',
  FCNR: 'FCNR',
  SB: 'Savings',
  joint: 'Joint',
  unknown: 'Type not stated',
};
const rupee = (n: number) => formatInr(Math.round(n));
/** average rate of a set of deposits, weighted by amount, as shown in the totals row */
const pctOf = (fds: FdLine[]) => {
  const p = fds.reduce((a, f) => a + f.principal, 0);
  return p > 0
    ? `${((fds.reduce((a, f) => a + f.principal * f.rate, 0) / p) * 100).toFixed(2)}%`
    : '–';
};
const monthName = (m: string) =>
  new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

export interface DepositLinks {
  /** where a bank's page is; the sample points at its own pages */
  bank: (f: FdLine) => string | null;
  asset: (f: FdLine) => string;
  monthly: (f: FdLine) => string;
  edit: string;
  /** opens one deposit's edit panel */
  editOne: (f: FdLine) => string;
  sample: boolean;
}

export const liveLinks: DepositLinks = {
  bank: (f) => (f.bankId ? `/bank/${f.bankId}` : null),
  asset: (f) => `/asset/${f.id}`,
  monthly: (f) => `/monthly/${slugify(f.bank)}`,
  edit: '/accounts/edit',
  editOne: (f) => `/accounts?edit=${f.id}`,
  sample: false,
};

/** Every deposit, one row each, linking to the deposit's own page. */
export function RegisterTab({
  fds,
  styles,
  links,
  group = 'none',
  allHidden = false,
}: {
  fds: FdLine[];
  /** every deposit is hidden by the matured-deposit rule: say so instead of "no deposits yet" */
  allHidden?: boolean;
  styles: Record<string, PersonStyle>;
  links: DepositLinks;
  /** one block of rows per bank or per person, each with its own subtotal, or one flat list */
  group?: 'none' | 'bank' | 'owner';
}) {
  if (fds.length === 0 && allHidden)
    return <p className="empty">No running deposits to list. The matured ones are hidden.</p>;
  if (fds.length === 0)
    return (
      <p className="empty">
        No fixed deposits yet. Add one from the <Link href="/monthly">monthly update</Link>{' '}
        (&ldquo;Add a deposit or account here&rdquo;), or import your workbook.
      </p>
    );
  const keyOf = (f: FdLine) =>
    group === 'bank'
      ? { key: f.bankId ?? f.bank, label: f.bank }
      : { key: f.ownerId, label: f.owner };
  const groups: { key: string; label: string; list: FdLine[] }[] =
    group === 'none'
      ? [{ key: 'all', label: '', list: fds }]
      : [
          ...fds
            .reduce((m, f) => {
              const k = keyOf(f);
              const g = m.get(k.key) ?? { key: k.key, label: k.label, list: [] as FdLine[] };
              g.list.push(f);
              return m.set(k.key, g);
            }, new Map<string, { key: string; label: string; list: FdLine[] }>())
            .values(),
        ].sort(
          (a, b) =>
            b.list.reduce((x, f) => x + f.accruedToday, 0) -
            a.list.reduce((x, f) => x + f.accruedToday, 0),
        );
  // a deposit that is not running (past its date, closed, renewed) is listed but is in none of the totals
  const counted = fds.filter((f) => f.status === 'active' && !needsConfirmation(f));
  return (
    <section className="card" aria-labelledby="reg">
      <NoticeHost />
      <div className="cardhead">
        <h2 id="reg">All fixed deposits</h2>
        <span className="small muted">Soonest maturity first. Open a deposit for its history.</span>
      </div>
      <div className="xlwrap">
        <table className="tbl lines responsive">
          <thead>
            <tr>
              <th>Deposit</th>
              <th>Created</th>
              <th className="num">Principal</th>
              <th className="num">Current value</th>
              <th>Rate</th>
              <th>Matures</th>
              <th className="num">Maturity value</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <Fragment key={g.key}>
                {group !== 'none' && (
                  <tr className="secthead">
                    <td colSpan={7}>
                      <strong>{g.label}</strong>{' '}
                      <span className="muted small">
                        {g.list.length} deposit{g.list.length === 1 ? '' : 's'} · invested{' '}
                        {rupee(g.list.reduce((a, f) => a + f.principal, 0))} · current value{' '}
                        {rupee(g.list.reduce((a, f) => a + f.accruedToday, 0))} · pays{' '}
                        {rupee(g.list.reduce((a, f) => a + (f.bankMaturity ?? 0), 0))} at maturity
                      </span>
                    </td>
                  </tr>
                )}
                {g.list.map((f) => {
                  const bank = links.bank(f);
                  const check =
                    f.varianceVsBankPct !== null && Math.abs(f.varianceVsBankPct) > 0.05
                      ? f.varianceVsBankPct
                      : null;
                  return (
                    <tr
                      key={f.id}
                      className={
                        f.listState === 'hidden' || (f.status !== 'active' && !needsConfirmation(f))
                          ? 'dim'
                          : ''
                      }
                      {...(f.status === 'active' && !needsConfirmation(f)
                        ? {}
                        : { 'data-nosum': '' })}
                    >
                      <td data-label="Deposit">
                        <PersonBadge p={styles[f.ownerId]} size={16} />{' '}
                        <Link href={links.asset(f)}>
                          <strong>{f.bank}</strong>
                        </Link>{' '}
                        <span className="muted">· {f.owner}</span>
                        <div className="muted small">
                          {KIND[f.kind] ?? f.kind}
                          {f.status !== 'active' || needsConfirmation(f) ? (
                            <>
                              {' · '}
                              <span className={needsConfirmation(f) ? 'pill warn' : ''}>
                                {depositStatusWord(f)}
                              </span>
                            </>
                          ) : null}
                          {bank && (
                            <>
                              {' · '}
                              <Link href={bank}>bank page</Link>
                            </>
                          )}
                        </div>
                        {f.listState === 'confirm' && (
                          <div className="small">
                            <span className="muted">{maturedNote(!!f.proceedsAwaiting)}.</span>{' '}
                            <ConfirmMatured assetId={f.id} name={f.bank} sample={links.sample} />
                          </div>
                        )}
                      </td>
                      <td className="nowrap" data-label="Created">
                        {niceDate(f.bookedOn)}
                      </td>
                      <td className="num" data-label="Principal">
                        {rupee(f.principal)}
                      </td>
                      <td className="num" data-label="Current value">
                        {f.status === 'active' && !needsConfirmation(f) ? (
                          rupee(f.accruedToday)
                        ) : f.proceedsAwaiting ? (
                          <span title="Matured: counted once in net worth until you say where the money went">
                            {rupee(f.accruedToday)}
                            <div className="small" style={{ color: 'var(--warn-fg)' }}>
                              awaiting confirmation
                            </div>
                          </span>
                        ) : (
                          <span
                            className="muted"
                            title="Not counted: the money is probably already in another account or a new deposit"
                          >
                            {rupee(f.accruedToday)}
                            <div className="small">not counted</div>
                          </span>
                        )}
                      </td>
                      <td data-label="Rate">{(f.rate * 100).toFixed(2)}%</td>
                      <td data-label="Matures">
                        {niceDate(f.maturityOn)}
                        <div className="muted small">{daysPhrase(f.daysLeft)}</div>
                      </td>
                      <td className="num" data-label="Maturity value">
                        {f.bankMaturity === null ? (
                          <>
                            –<div className="muted small wrapnote">bank figure not entered</div>
                          </>
                        ) : (
                          <>
                            {rupee(f.bankMaturity)}
                            <div className="muted small wrapnote">bank figure</div>
                          </>
                        )}
                        {check !== null && (
                          <div className="fail small wrapnote">
                            Our calculation differs by {Math.abs(check).toFixed(2)}%.{' '}
                            <Link href={links.editOne(f)}>Check the rate and dates</Link>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </Fragment>
            ))}
          </tbody>
          <tfoot>
            <tr data-totals className="sumrow">
              <th scope="row" data-count>
                Total · <span data-count-n>{counted.length}</span> running deposits
              </th>
              <td />
              <td className="num" data-sum>
                {rupee(counted.reduce((a, f) => a + f.principal, 0))}
              </td>
              <td className="num" data-sum>
                {rupee(counted.reduce((a, f) => a + f.accruedToday, 0))}
              </td>
              <td data-wavg="2">{pctOf(counted)}</td>
              <td />
              <td className="num" data-sum>
                {rupee(counted.reduce((a, f) => a + (f.bankMaturity ?? 0), 0))}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

/** What needs a decision, what comes back soon, and the month-by-month calendar. */
export function MaturitiesTab({
  s,
  months,
  windowDays,
  windows,
  today,
  links,
  styles,
}: {
  s: DepositSummary;
  months: MonthGroup[];
  windowDays: number;
  /** the maturity windows in days, from Settings (deposits.maturityAlertDays) */
  windows: readonly number[];
  /** ISO date the interest ahead is counted from */
  today: string;
  links: DepositLinks;
  styles: Record<string, PersonStyle>;
}) {
  const bands = maturityWindows(s.running, windows);
  const ahead = interestAhead(s.running, today);
  const peak = Math.max(1, ...ahead.byMonth.map((m) => m.amount));
  const byId = new Map(s.running.map((f) => [f.id, f]));
  return (
    <>
      <NoticeHost />
      <section className="card" aria-labelledby="mwin" data-testid="dep-windows">
        <div className="cardhead">
          <h2 id="mwin">Maturing within</h2>
          <span className="small muted">
            Running deposits by days to maturity (windows from Settings → Deposits); each window
            includes the shorter ones
          </span>
        </div>
        <table className="tbl lines responsive">
          <caption className="sr-only">Deposits maturing within each window</caption>
          <thead>
            <tr>
              <th>Within</th>
              <th className="num">Deposits</th>
              <th className="num">Principal</th>
              <th className="num">Comes back</th>
            </tr>
          </thead>
          <tbody>
            {bands.map((b) => (
              <tr key={b.days}>
                <td data-label="Within">
                  <strong>{b.days} days</strong>
                </td>
                <td className="num" data-label="Deposits">
                  {b.count}
                </td>
                <td className="num" data-label="Principal">
                  {b.count ? rupee(b.principal) : '—'}
                </td>
                <td className="num" data-label="Comes back">
                  {b.count ? rupee(b.comesBack) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="small muted">
          &ldquo;Comes back&rdquo; is the bank&rsquo;s maturity amount where it is on file, else the
          amount worked out from the deposit&rsquo;s terms. A dash means no deposit matures in that
          window.
        </p>
      </section>

      <section className="card" aria-labelledby="int12" data-testid="dep-interest-ahead">
        <div className="cardhead">
          <h2 id="int12">Interest expected in the next 12 months</h2>
          <span className="small muted">Estimated, before tax, to {niceDate(ahead.until)}</span>
        </div>
        {ahead.rows.length === 0 ? (
          <p className="empty">No running deposit earns interest in the next 12 months.</p>
        ) : (
          <>
            <dl className="dep-ahead-kpis">
              <div>
                <dt>All running deposits</dt>
                <dd data-testid="dep-interest-ahead-total">{rupee(ahead.total)}</dd>
              </div>
              <div>
                <dt>From deposits maturing in the period</dt>
                <dd>{rupee(ahead.fromMaturing)}</dd>
              </div>
              <div>
                <dt>Still building up at its end</dt>
                <dd>{rupee(ahead.total - ahead.fromMaturing)}</dd>
              </div>
            </dl>
            <table className="tbl lines dep-ahead-months">
              <caption className="sr-only">Interest expected by month</caption>
              <thead>
                <tr>
                  <th>Month</th>
                  <th className="num">Interest</th>
                </tr>
              </thead>
              <tbody>
                {ahead.byMonth.map((m) => (
                  <tr key={m.month}>
                    <td data-label="Month">{monthName(m.month)}</td>
                    <td className="num" data-label="Interest">
                      <span
                        className="dep-ahead-bar"
                        aria-hidden="true"
                        style={{ width: `${Math.round((m.amount / peak) * 100)}%` }}
                      />
                      {rupee(m.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <details className="disclose">
              <summary>By deposit ({ahead.rows.length})</summary>
              <ul className="list small">
                {ahead.rows.map((r) => (
                  <li key={r.id} className="listlink">
                    <span>
                      <PersonBadge p={styles[r.ownerId]} size={16} />{' '}
                      <Link href={links.asset(byId.get(r.id)!)}>{r.bank}</Link>, {r.owner}
                      <span className="muted">
                        {' '}
                        · {r.matures ? `matures ${niceDate(r.maturityOn)}` : 'runs past the period'}
                      </span>
                    </span>
                    <span className="num">{rupee(r.amount)}</span>
                  </li>
                ))}
              </ul>
            </details>
            <p className="small muted">
              Worked out from each deposit&rsquo;s principal, rate, booking date and compounding,
              from today to its maturity or the end of the 12 months, whichever comes first. Money
              paid back at maturity is not assumed to go into a new deposit. Interest paid out to a
              savings account during the year is included. Tax deducted at source is not taken off.
            </p>
          </>
        )}
      </section>

      {s.confirm.length > 0 && (
        <section className="card" aria-labelledby="conf">
          <div className="cardhead">
            <h2 id="conf">Confirm what happened ({s.confirm.length})</h2>
            <span className="small muted">
              Counted once in net worth until you say where the money went; a deposit whose money a
              new deposit or a later balance already holds is not counted twice.
            </span>
          </div>
          <ul className="list">
            {s.confirm.map((f) => (
              <li key={f.id} className="listlink">
                <span>
                  <PersonBadge p={styles[f.ownerId]} size={16} />{' '}
                  <Link href={links.asset(f)}>
                    <strong>{f.bank}</strong>
                  </Link>{' '}
                  · {f.nickname} matured on {niceDate(f.maturityOn)} ({daysPhrase(f.daysLeft)}).
                  Renewed, paid out or still waiting?
                </span>
                <span className="confirmrow">
                  <ConfirmMatured assetId={f.id} name={f.bank} sample={links.sample} />
                  <Link className="btn compact ghost" href={links.monthly(f)}>
                    Renewed or other
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card" aria-labelledby="soon">
        <div className="cardhead">
          <h2 id="soon">Maturing in the next {windowDays} days</h2>
          {s.soon.length > 0 && (
            <span className="small muted">
              {formatInr(Math.round(s.soonTotal))} comes back in all
            </span>
          )}
        </div>
        {s.soon.length === 0 ? (
          <p className="empty">Nothing matures in the next {windowDays} days.</p>
        ) : (
          <table className="tbl lines responsive">
            <thead>
              <tr>
                <th>Matures</th>
                <th>Deposit</th>
                <th className="num">Comes back</th>
              </tr>
            </thead>
            <tbody>
              {s.soon.map((f) => (
                <tr key={f.id}>
                  <td data-label="Matures">
                    <strong>{niceDate(f.maturityOn)}</strong>
                    <div className="muted small">{daysPhrase(f.daysLeft)}</div>
                  </td>
                  <td data-label="Deposit">
                    <PersonBadge p={styles[f.ownerId]} size={16} />{' '}
                    <Link href={links.asset(f)}>{f.bank}</Link>{' '}
                    <span className="muted">· {f.owner}</span>
                  </td>
                  <td className="num" data-label="Comes back">
                    {rupee(f.bankMaturity ?? f.accruedToday)}
                    <div className="muted small">
                      {f.bankMaturity === null ? 'worked out by us' : 'bank figure'}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card" aria-labelledby="cal">
        <div className="cardhead">
          <h2 id="cal">Maturity calendar</h2>
          <span className="small muted">Running deposits, month by month</span>
        </div>
        {months.length === 0 ? (
          <p className="empty">No running deposit has a maturity date ahead.</p>
        ) : (
          <div className="stack">
            {months.map((m, i) => (
              <details key={m.month} className="calmonth" open={i === 0}>
                <summary>
                  <strong>{monthName(m.month)}</strong>
                  <span className="muted small">
                    {' '}
                    · {m.items.length} deposit{m.items.length === 1 ? '' : 's'}
                  </span>
                  <span className="num calsum">{rupee(m.total)}</span>
                </summary>
                <ul className="list small">
                  {m.items.map((f) => (
                    <li key={f.id} className="listlink">
                      <span>
                        {niceDate(f.maturityOn)} · <Link href={links.asset(f)}>{f.bank}</Link>,{' '}
                        {f.owner}
                      </span>
                      <span className="num">{rupee(f.bankMaturity ?? f.accruedToday)}</span>
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </div>
        )}
        <details className="disclose">
          <summary>What happens when a deposit matures</summary>
          <p className="small muted">
            The money moves from this list to your bank balance. It is not new wealth. Renewals are
            never assumed at the old rate: you enter the new rate and dates when you renew.
          </p>
        </details>
      </section>
    </>
  );
}

/** The deposit-insurance position per bank and per ownership name. */
export interface CoverBank {
  id: string;
  name: string;
  outside: boolean;
}

export function CoverTab({
  v,
  links,
  banks,
  saveForeign,
}: {
  v: DepositsView;
  links: DepositLinks;
  /** every bank, with whether it is a foreign bank outside the scheme */
  banks?: CoverBank[];
  saveForeign?: (f: FormData) => Promise<void>;
}) {
  const byBank = Object.entries(v.cover.byBank)
    .map(([id, b]) => ({ id, name: v.cover.bankNames[id] ?? 'Unknown', ...b }))
    .sort((a, b) => b.uninsured - a.uninsured);
  const over = byBank.filter((b) => b.uninsured > 0).length;
  return (
    <>
      <p className="callout">
        Bank deposits are insured up to <strong>{formatInr(v.cover.limit)}</strong> for each
        ownership name at each bank (the deposit insurance scheme, DICGC). This is not your life or
        health insurance: those are under{' '}
        <Link href="/others?tab=policies">Lent, policies, property</Link>.{' '}
        {over > 0
          ? `${over} bank${over === 1 ? ' has' : 's have'} money above the limit. Spreading it to another bank, or to an account in another ownership name, brings it under cover.`
          : 'Nothing is above the limit today.'}
      </p>
      <section className="card" aria-labelledby="cover">
        <div className="cardhead">
          <h2 id="cover">By bank</h2>
          <span className="small muted">
            Insured today <b className="num">{formatInr(v.cover.insured)}</b> · above the limit{' '}
            <b className={`num ${v.cover.uninsured > 0 ? 'fail' : ''}`}>
              {formatInr(v.cover.uninsured)}
            </b>
          </span>
        </div>
        <table className="tbl lines responsive">
          <thead>
            <tr>
              <th>Bank</th>
              <th className="num">Deposits incl. interest</th>
              <th className="num">Above the limit</th>
            </tr>
          </thead>
          <tbody>
            {byBank.map((b) => (
              <tr key={b.id}>
                <td data-label="Bank">
                  <BankBadge name={b.name} />{' '}
                  {links.sample ? b.name : <Link href={`/bank/${b.id}`}>{b.name}</Link>}
                </td>
                <td className="num" data-label="Deposits incl. interest">
                  {rupee(b.total)}
                </td>
                <td className={`num ${b.uninsured > 0 ? 'fail' : ''}`} data-label="Above the limit">
                  {rupee(b.uninsured)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card" aria-labelledby="byname">
        <div className="cardhead">
          <h2 id="byname">By ownership name</h2>
          <span className="small muted">
            Each name as written is insured separately at each bank.
          </span>
        </div>
        <table className="tbl lines responsive">
          <thead>
            <tr>
              <th>Bank</th>
              <th>Name on the account</th>
              <th className="num">Total incl. interest</th>
              <th className="num">Insured</th>
              <th className="num">Above the limit</th>
            </tr>
          </thead>
          <tbody>
            {[...v.cover.rows]
              .sort(
                (a, b) =>
                  (v.cover.bankNames[a.bankId] ?? '').localeCompare(
                    v.cover.bankNames[b.bankId] ?? '',
                  ) || a.capacityKey.localeCompare(b.capacityKey),
              )
              .map((r) => (
                <tr key={r.bankId + r.capacityKey}>
                  <td data-label="Bank">{v.cover.bankNames[r.bankId]}</td>
                  <td data-label="Name on the account">
                    {capacityLabel(r.capacityKey, v.cover.ownerNames)}
                    <details className="parts">
                      <summary className="small muted">
                        {r.parts.length} account{r.parts.length === 1 ? '' : 's'} counted
                      </summary>
                      <ul className="small">
                        {[...r.parts]
                          .sort((a, b) => b.amount - a.amount)
                          .map((p) => (
                            <li key={p.id}>
                              {p.kind} · {p.label} · {rupee(p.amount)}
                              {p.status !== 'active' ? ` · ${p.status.replace('_', ' ')}` : ''}
                            </li>
                          ))}
                      </ul>
                    </details>
                    {partnerMissing(r.capacityKey) && (
                      <>
                        {' '}
                        <Link className="small" href={links.edit}>
                          set the second name
                        </Link>
                      </>
                    )}
                  </td>
                  <td className="num" data-label="Total incl. interest">
                    {rupee(r.total)}
                  </td>
                  <td className="num" data-label="Insured">
                    {rupee(r.insured)}
                  </td>
                  <td
                    className={`num ${r.uninsured > 0 ? 'fail' : ''}`}
                    data-label="Above the limit"
                  >
                    {rupee(r.uninsured)}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
        <details className="disclose">
          <summary>How the cover is counted</summary>
          <ul className="list small muted">
            {v.cover.assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </details>
      </section>
      {banks && banks.length > 0 && (
        <section className="card" aria-labelledby="foreignbanks">
          <div className="cardhead">
            <h2 id="foreignbanks">Banks outside the Indian scheme</h2>
            <span className="small muted">
              Foreign banks are not covered by the Indian deposit insurance, so their money is left
              out of every figure above.
            </span>
          </div>
          <form action={saveForeign} className="foreignform">
            <ul className="checks">
              {banks.map((b) => (
                <li key={b.id}>
                  <label className="check">
                    <input
                      type="checkbox"
                      name="foreign"
                      value={b.id}
                      defaultChecked={b.outside}
                      disabled={links.sample}
                    />{' '}
                    <BankBadge name={b.name} /> {b.name}
                    <span className="muted small"> foreign bank, not covered</span>
                  </label>
                </li>
              ))}
            </ul>
            <button className="btn primary compact" disabled={links.sample}>
              Save
            </button>
          </form>
        </section>
      )}
    </>
  );
}
