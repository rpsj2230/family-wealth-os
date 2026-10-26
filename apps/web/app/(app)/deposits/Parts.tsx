import Link from 'next/link';
import {
  capacityLabel,
  formatInr,
  formatInrCompact,
  partnerMissing,
  type PersonStyle,
} from '@fwos/core';
import './deposits.css';
import { BankBadge } from '@/components/BankBadge';
import { KpiStrip } from '@/components/KpiStrip';
import { PersonBadge } from '@/components/Person';
import { daysPhrase, niceDate } from '@/lib/dates';
import type { DepositsView, FdLine } from '@/lib/deposits';
import {
  depositStatusWord,
  needsConfirmation,
  type DepositSummary,
  type MonthGroup,
} from '@/lib/deposits-summary';
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

export function DepositKpis({
  s,
  v,
  windowDays,
}: {
  s: DepositSummary;
  v: DepositsView;
  windowDays: number;
}) {
  return (
    <KpiStrip
      label="Deposits at a glance"
      items={[
        {
          label: 'Fixed deposits today',
          value: formatInrCompact(s.runningValue),
          sub: `${s.runningCount} running · ${formatInrCompact(s.runningPrincipal)} put in${s.averageRate === null ? '' : ` · ${(s.averageRate * 100).toFixed(2)}% on average`}`,
          main: true,
        },
        {
          label: `Matures in ${windowDays} days`,
          value: s.soon.length,
          sub:
            s.soon.length > 0
              ? `${formatInrCompact(s.soonTotal)} coming back${s.next ? ` · next ${niceDate(s.next.maturityOn)}` : ''}`
              : s.next
                ? `next: ${niceDate(s.next.maturityOn)}, ${s.next.bank}`
                : 'no running deposit',
          href: '/deposits?tab=maturities',
        },
        {
          label: 'To confirm',
          value: s.confirm.length,
          sub: s.confirm.length > 0 ? 'matured, say where the money went' : 'nothing waiting',
          tone: s.confirm.length > 0 ? 'warn' : undefined,
          href: '/deposits?tab=maturities',
        },
        {
          label: 'Above insurance limit',
          value: formatInrCompact(v.cover.uninsured),
          sub: `${formatInr(v.cover.limit)} insured per bank and name`,
          tone: v.cover.uninsured > 0 ? 'fail' : undefined,
          href: '/deposits?tab=cover',
        },
      ]}
    />
  );
}

/** Every deposit, one row each, linking to the deposit's own page. */
export function RegisterTab({
  fds,
  styles,
  links,
}: {
  fds: FdLine[];
  styles: Record<string, PersonStyle>;
  links: DepositLinks;
}) {
  if (fds.length === 0)
    return (
      <p className="empty">
        No fixed deposits yet. Add one from the <Link href="/monthly">monthly update</Link>{' '}
        (&ldquo;Add a deposit or account here&rdquo;), or import your workbook.
      </p>
    );
  return (
    <section className="card" aria-labelledby="reg">
      <div className="cardhead">
        <h2 id="reg">All fixed deposits</h2>
        <span className="small muted">Soonest maturity first. Open a deposit for its history.</span>
      </div>
      <table className="tbl lines responsive">
        <thead>
          <tr>
            <th>Deposit</th>
            <th className="num">Principal</th>
            <th className="num">Value today</th>
            <th>Rate</th>
            <th>Matures</th>
            <th className="num">At maturity</th>
          </tr>
        </thead>
        <tbody>
          {fds.map((f) => {
            const bank = links.bank(f);
            const check =
              f.varianceVsBankPct !== null && Math.abs(f.varianceVsBankPct) > 0.05
                ? f.varianceVsBankPct
                : null;
            return (
              <tr
                key={f.id}
                className={f.status !== 'active' && !needsConfirmation(f) ? 'dim' : ''}
              >
                <td data-label="Deposit">
                  <PersonBadge p={styles[f.ownerId]} size={16} />{' '}
                  <Link href={links.asset(f)}>
                    <strong>{f.bank}</strong>
                  </Link>{' '}
                  <span className="muted">· {f.owner}</span>
                  <div className="muted small">
                    {KIND[f.kind] ?? f.kind} · from {niceDate(f.bookedOn)}
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
                </td>
                <td className="num" data-label="Principal">
                  {rupee(f.principal)}
                </td>
                <td className="num" data-label="Value today">
                  {rupee(f.accruedToday)}
                </td>
                <td data-label="Rate">{(f.rate * 100).toFixed(2)}%</td>
                <td data-label="Matures">
                  {niceDate(f.maturityOn)}
                  <div className="muted small">{daysPhrase(f.daysLeft)}</div>
                </td>
                <td className="num" data-label="At maturity">
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
        </tbody>
      </table>
    </section>
  );
}

/** What needs a decision, what comes back soon, and the month-by-month calendar. */
export function MaturitiesTab({
  s,
  months,
  windowDays,
  links,
  styles,
}: {
  s: DepositSummary;
  months: MonthGroup[];
  windowDays: number;
  links: DepositLinks;
  styles: Record<string, PersonStyle>;
}) {
  return (
    <>
      {s.confirm.length > 0 && (
        <section className="card" aria-labelledby="conf">
          <div className="cardhead">
            <h2 id="conf">Confirm what happened ({s.confirm.length})</h2>
            <span className="small muted">Not counted in net worth until you do.</span>
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
                <Link className="btn compact" href={links.monthly(f)}>
                  Set its status
                </Link>
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
export function CoverTab({ v, links }: { v: DepositsView; links: DepositLinks }) {
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
    </>
  );
}
