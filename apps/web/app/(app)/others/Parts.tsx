import Link from 'next/link';
import { formatInr, formatInrCompact, type PersonStyle } from '@fwos/core';
import { ActionForm, type ActionResult } from '@/components/ActionForm';
import { UpdatedCell } from '@/components/BankTable';
import { KpiStrip } from '@/components/KpiStrip';
import { PersonBadge } from '@/components/Person';
import { daysPhrase, niceDate } from '@/lib/dates';
import {
  POLICY_KIND,
  loanTotals,
  policyDue,
  policyKindLabel,
  type HoldingLine,
  type LoanLine,
} from '@/lib/others-summary';

import './others.css';

type Act = (prev: ActionResult | null, f: FormData) => Promise<ActionResult>;

export interface OthersActions {
  addLoan: Act;
  recordRepayment: Act;
  setExpectedDate: Act;
  setLoanKind: Act;
  addPolicy: Act;
  updatePolicy: Act;
  addHolding: Act;
  recordHoldingValue: Act;
}

export interface PolicyLine {
  id: string;
  kind: string;
  insurer: string;
  coverage: string | null;
  paidBy: string | null;
  renewalOn: string | null;
  expiresOn: string | null;
  nominee: string | null;
  documents: string | null;
  insured: string[];
}

export interface Person {
  id: string;
  name: string;
}

const rupee = (n: number) => formatInr(Math.round(n));

export function OthersKpis({
  loans,
  policies,
  holdings,
  today,
  policyDays,
}: {
  loans: LoanLine[];
  policies: PolicyLine[];
  holdings: HoldingLine[];
  today: string;
  policyDays: number;
}) {
  const t = loanTotals(loans);
  const dues = policies.map((p) => ({ p, d: policyDue(p, today, policyDays) }));
  const soon = dues.filter((x) => x.d.state === 'soon' || x.d.state === 'lapsed');
  const next = dues
    .filter((x) => x.d.state === 'soon' || x.d.state === 'ok')
    .sort((a, b) => (a.d.days ?? 0) - (b.d.days ?? 0))[0];
  const total = holdings.reduce((s, h) => s + (h.value ?? 0), 0);
  return (
    <KpiStrip
      label="Lent, policies and property at a glance"
      items={[
        {
          label: 'Owed to you',
          value: formatInrCompact(t.owed),
          sub: `${t.openCount} open loan${t.openCount === 1 ? '' : 's'} · not counted as cash`,
          main: true,
          href: '/others?tab=lent',
        },
        {
          label: 'Overdue loans',
          value: t.overdueCount,
          sub:
            t.overdueCount > 0 ? `${formatInrCompact(t.overdueAmount)} past its date` : 'none late',
          tone: t.overdueCount > 0 ? 'fail' : undefined,
          href: '/others?tab=lent',
        },
        {
          label: 'Renewal or end soon',
          value: soon.length,
          sub: next?.d.on
            ? `next: ${policyKindLabel(next.p.kind)}, ${niceDate(next.d.on)}`
            : `${policies.length} polic${policies.length === 1 ? 'y' : 'ies'} · reminded ${policyDays} days ahead`,
          tone: soon.length > 0 ? 'warn' : undefined,
          href: '/others?tab=policies',
        },
        {
          label: 'Property and other',
          value: formatInrCompact(total),
          sub: `${holdings.length} holding${holdings.length === 1 ? '' : 's'}, counted in net worth`,
          href: '/others?tab=property',
        },
      ]}
    />
  );
}

/* ------------------------------------------------------------------------------------ money lent */

export function LoansTab({
  loans,
  people,
  styles,
  today,
  actions,
}: {
  loans: LoanLine[];
  people: Person[];
  styles: Record<string, PersonStyle>;
  today: string;
  actions: Pick<OthersActions, 'addLoan' | 'recordRepayment' | 'setExpectedDate' | 'setLoanKind'>;
}) {
  return (
    <>
      <p className="lead muted">
        The amount owed is always the amount lent minus the repayments you record. It is not counted
        as cash. Money you gave away and do not expect back can be recorded as a{' '}
        <strong>gift</strong>: it is kept here for the record and never counted in your net worth,
        totals or reminders.
      </p>
      <details className="card addbox" open={loans.length === 0}>
        <summary>Add a loan or a gift</summary>
        <ActionForm action={actions.addLoan} submit="Save" primary>
          <label>
            What is it
            <select name="kind" defaultValue="loan">
              <option value="loan">Loan (comes back, counted)</option>
              <option value="gift">Gift (will not come back, not counted)</option>
            </select>
          </label>
          <label>
            Lent by
            <select name="owner" required defaultValue={people[0]?.id}>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Lent to
            <input name="who" required maxLength={120} placeholder="Name of person or firm" />
          </label>
          <label>
            Amount (₹)
            <input name="lent" inputMode="decimal" required placeholder="2,00,000" />
          </label>
          <label>
            Lent on
            <input name="lent_on" type="date" max={today} />
          </label>
          <label>
            Expected back by
            <input name="expected" type="date" />
          </label>
        </ActionForm>
      </details>

      {loans.length === 0 ? (
        <p className="empty">
          No loans recorded. When you lend money, add it above and record each repayment as it
          arrives.
        </p>
      ) : (
        <div className="cardgrid" role="list" aria-label="Loans">
          {loans.map((l) => (
            <article
              key={l.assetId}
              role="listitem"
              data-item
              data-f-borrower={l.counterparty}
              data-f-lent={String(l.lent)}
              data-f-owed={String(l.outstanding)}
              data-f-expected={l.expectedOn ?? ''}
              data-f-status={l.status}
              className={`pickcard ${l.status === 'overdue' ? 'attention' : ''} ${
                l.status === 'settled' || l.status === 'gift' ? 'settled' : ''
              }`}
            >
              <div className="cardhead">
                <h3>
                  <Link href={`/asset/${l.assetId}`}>{l.counterparty}</Link>
                </h3>
                <PersonBadge p={l.ownerId ? styles[l.ownerId] : undefined} size={18} />
              </div>
              <p>
                <span className="figure">{rupee(l.outstanding)}</span>{' '}
                <span className="muted small">
                  {l.status === 'gift'
                    ? 'gift · not counted'
                    : l.status === 'settled'
                      ? 'settled'
                      : l.status === 'overpaid'
                        ? 'repaid in full and more'
                        : 'still owed'}
                </span>
              </p>
              {l.status === 'overdue' && (
                <p className="fail small">
                  {l.daysOverdue} day{l.daysOverdue === 1 ? '' : 's'} overdue
                </p>
              )}
              <dl>
                <dt>{l.status === 'gift' ? 'Given' : 'Lent'}</dt>
                <dd>
                  {rupee(l.lent)}
                  {l.lentOn ? ` · ${niceDate(l.lentOn)}` : ''}
                </dd>
                {l.status !== 'gift' && (
                  <>
                    <dt>Repaid</dt>
                    <dd>{rupee(l.repaid)}</dd>
                    <dt>Expected back</dt>
                    <dd>
                      {l.expectedOn ? (
                        <>
                          {niceDate(l.expectedOn)}
                          {l.status === 'outstanding' && l.daysToExpected !== null && (
                            <span className="muted small"> · {daysPhrase(l.daysToExpected)}</span>
                          )}
                        </>
                      ) : (
                        <span className="muted">no date set</span>
                      )}
                    </dd>
                  </>
                )}
              </dl>
              {l.repayments.length > 0 && (
                <details className="disclose">
                  <summary>Repayments ({l.repayments.length})</summary>
                  <ul className="list small">
                    {l.repayments.map((r, i) => (
                      <li key={i}>
                        {rupee(r.amount)} on {niceDate(r.on)}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {l.status === 'gift' ? (
                <ActionForm
                  action={actions.setLoanKind}
                  submit="Count it as a loan again"
                  keepAfterSave
                >
                  <input type="hidden" name="asset" value={l.assetId} />
                  <input type="hidden" name="kind" value="loan" />
                </ActionForm>
              ) : (
                <>
                  <details className="disclose">
                    <summary>Record a repayment or change the date</summary>
                    <ActionForm action={actions.recordRepayment} submit="Record repayment">
                      <input type="hidden" name="asset" value={l.assetId} />
                      <label>
                        Amount received (₹)
                        <input name="amount" inputMode="decimal" required />
                      </label>
                      <label>
                        Date received
                        <input name="on" type="date" max={today} defaultValue={today} required />
                      </label>
                    </ActionForm>
                    <ActionForm action={actions.setExpectedDate} submit="Save date" keepAfterSave>
                      <input type="hidden" name="asset" value={l.assetId} />
                      <label>
                        Expected back by
                        <input name="on" type="date" defaultValue={l.expectedOn ?? ''} />
                      </label>
                    </ActionForm>
                  </details>
                  <details className="disclose">
                    <summary>This was a gift, not a loan</summary>
                    <p className="muted small">
                      It stays on this list for the record but is removed from your net worth and
                      reminders.
                    </p>
                    <ActionForm action={actions.setLoanKind} submit="Mark as a gift" keepAfterSave>
                      <input type="hidden" name="asset" value={l.assetId} />
                      <input type="hidden" name="kind" value="gift" />
                    </ActionForm>
                  </details>
                </>
              )}
            </article>
          ))}
        </div>
      )}
    </>
  );
}

export const LOAN_COLS = [
  { key: 'borrower', label: 'Borrower' },
  { key: 'lent', label: 'Lent' },
  { key: 'owed', label: 'Owed' },
  { key: 'expected', label: 'Expected back' },
  { key: 'status', label: 'Status' },
];

/* ------------------------------------------------------------------------------------ policies */

const DUE_TONE = { soon: 'warn', lapsed: 'bad', ok: '', none: '' } as const;

export function PoliciesTab({
  policies,
  people,
  today,
  policyDays,
  actions,
}: {
  policies: PolicyLine[];
  people: Person[];
  today: string;
  policyDays: number;
  actions: Pick<OthersActions, 'addPolicy' | 'updatePolicy'>;
}) {
  const withDue = policies
    .map((p) => ({ p, d: policyDue(p, today, policyDays) }))
    .sort((a, b) => {
      const rank = (s: string) => (s === 'lapsed' ? 0 : s === 'soon' ? 1 : s === 'ok' ? 2 : 3);
      return rank(a.d.state) - rank(b.d.state) || (a.d.days ?? 9e9) - (b.d.days ?? 9e9);
    });
  return (
    <>
      <p className="lead muted">
        Cover is information only and never part of net worth. You are reminded {policyDays} days
        before a renewal or end date (change this in Settings).
      </p>
      <details className="card addbox" open={policies.length === 0}>
        <summary>Add a policy</summary>
        <ActionForm action={actions.addPolicy} submit="Add policy" primary>
          <label>
            Kind
            <select name="kind" required defaultValue="term">
              {Object.entries(POLICY_KIND).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label>
            Insurer
            <input name="insurer" required maxLength={120} />
          </label>
          <label>
            Cover, in a few words
            <input
              name="coverage"
              maxLength={300}
              placeholder="e.g. ₹1 crore term cover to age 65"
            />
          </label>
          <label>
            Policy number (last 4 only)
            <input name="ref" maxLength={4} inputMode="text" />
          </label>
          <label>
            Paid by
            <input name="paid_by" maxLength={120} />
          </label>
          <label>
            Next renewal
            <input name="renewal" type="date" />
          </label>
          <label>
            Policy ends
            <input name="expires" type="date" />
          </label>
          <label>
            Nominee (name and relationship)
            <input name="nominee" maxLength={500} />
          </label>
          <label>
            Where the documents are
            <input name="documents" maxLength={500} />
          </label>
          <fieldset className="insuredset">
            <legend className="small muted">Insured</legend>
            {people.map((p) => (
              <label key={p.id} className="check">
                <input type="checkbox" name="insured" value={p.id} /> {p.name}
              </label>
            ))}
          </fieldset>
        </ActionForm>
      </details>

      {policies.length === 0 ? (
        <p className="empty">
          No policies recorded. Add each term, health or other policy so its renewal date reminds
          you and the family emergency guide shows where the papers are.
        </p>
      ) : (
        <div className="cardgrid" role="list" aria-label="Policies">
          {withDue.map(({ p, d }) => (
            <article
              key={p.id}
              role="listitem"
              data-item
              data-f-insurer={p.insurer}
              data-f-kind={policyKindLabel(p.kind)}
              data-f-next={d.on ?? ''}
              data-f-insured={p.insured.join(', ')}
              className={`pickcard ${d.state === 'lapsed' || d.state === 'soon' ? 'attention' : ''}`}
            >
              <div className="cardhead">
                <h3>
                  <Link href={`/policy/${p.id}`}>{p.insurer}</Link>
                </h3>
                <span className="pill">{policyKindLabel(p.kind)}</span>
              </div>
              {p.coverage && <p className="small">{p.coverage}</p>}
              {d.state !== 'none' && d.on && (
                <p className="small">
                  <span className={`pill ${DUE_TONE[d.state]}`}>
                    {d.what === 'end' ? 'Ends' : 'Renews'} {niceDate(d.on)}
                  </span>{' '}
                  <span className="muted">
                    {d.state === 'lapsed'
                      ? `${daysPhrase(d.days ?? 0)}: renew it, or enter the new date`
                      : daysPhrase(d.days ?? 0)}
                  </span>
                </p>
              )}
              {d.state === 'none' && (
                <p className="small muted">No renewal or end date set, so no reminder.</p>
              )}
              <dl>
                <dt>Insured</dt>
                <dd>{p.insured.join(', ') || '–'}</dd>
                {p.paidBy && (
                  <>
                    <dt>Paid by</dt>
                    <dd>{p.paidBy}</dd>
                  </>
                )}
                {p.nominee && (
                  <>
                    <dt>Nominee</dt>
                    <dd>{p.nominee}</dd>
                  </>
                )}
              </dl>
              <details className="disclose">
                <summary>Update dates, nominee and documents</summary>
                <ActionForm action={actions.updatePolicy} submit="Save" keepAfterSave>
                  <input type="hidden" name="id" value={p.id} />
                  <label>
                    Next renewal
                    <input name="renewal" type="date" defaultValue={p.renewalOn ?? ''} />
                  </label>
                  <label>
                    Policy ends
                    <input name="expires" type="date" defaultValue={p.expiresOn ?? ''} />
                  </label>
                  <label>
                    Nominee
                    <input name="nominee" defaultValue={p.nominee ?? ''} />
                  </label>
                  <label>
                    Where the documents are
                    <input name="documents" defaultValue={p.documents ?? ''} />
                  </label>
                </ActionForm>
                <p className="small">
                  <Link href={`/policy/${p.id}`}>Open the policy to change everything else</Link>
                </p>
              </details>
            </article>
          ))}
        </div>
      )}
    </>
  );
}

export const POLICY_COLS = [
  { key: 'insurer', label: 'Insurer' },
  { key: 'kind', label: 'Kind' },
  { key: 'next', label: 'Next date' },
  { key: 'insured', label: 'Insured' },
];

/* ------------------------------------------------------------------------------------ property */

export function HoldingsTab({
  holdings,
  people,
  styles,
  today,
  actions,
}: {
  holdings: HoldingLine[];
  people: Person[];
  styles: Record<string, PersonStyle>;
  today: string;
  actions: Pick<OthersActions, 'addHolding' | 'recordHoldingValue'>;
}) {
  return (
    <>
      <p className="lead muted">
        Counted in net worth, but not as money you can spend: the &ldquo;I need money&rdquo; page
        treats property as a last resort. A value is only as good as its date.
      </p>
      {holdings.length === 0 ? (
        <p className="empty">
          No property or retirement holdings yet. Add one below, or import your workbook.
        </p>
      ) : (
        <section className="card" aria-labelledby="hold">
          <div className="cardhead">
            <h2 id="hold">Holdings</h2>
            <span className="small muted">
              {rupee(holdings.reduce((s, h) => s + (h.value ?? 0), 0))} in all
            </span>
          </div>
          <table className="tbl lines responsive">
            <thead>
              <tr>
                <th>Holding</th>
                <th>Kind</th>
                <th className="num">Value</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {holdings.map((h) => (
                <tr key={h.assetId}>
                  <td data-label="Holding">
                    <PersonBadge p={styles[h.ownerId]} size={16} />{' '}
                    <Link href={`/asset/${h.assetId}`}>{h.name}</Link>
                    {h.notes ? <div className="muted small">{h.notes}</div> : null}
                  </td>
                  <td data-label="Kind">{h.kind}</td>
                  <td className="num" data-label="Value">
                    {h.value === null ? (
                      <span className="muted">no value yet</span>
                    ) : (
                      rupee(h.value)
                    )}
                  </td>
                  <td className="upd" data-label="Updated">
                    <UpdatedCell asOf={h.asOf} source={h.source} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <div className="cardgrid">
        <details className="card addbox" open={holdings.length === 0}>
          <summary>Record a new value</summary>
          {holdings.length === 0 ? (
            <p className="small muted">Add a holding first.</p>
          ) : (
            <ActionForm action={actions.recordHoldingValue} submit="Save value" primary>
              <label>
                Holding
                <select name="asset" required defaultValue="">
                  <option value="" disabled>
                    Choose…
                  </option>
                  {holdings.map((h) => (
                    <option key={h.assetId} value={h.assetId}>
                      {h.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                New value (₹)
                <input name="amount" inputMode="decimal" required />
              </label>
              <label>
                As on
                <input name="as_of" type="date" max={today} defaultValue={today} required />
              </label>
            </ActionForm>
          )}
        </details>
        <details className="card addbox">
          <summary>Add a property or other holding</summary>
          <ActionForm action={actions.addHolding} submit="Add holding" primary>
            <label>
              Whose
              <select name="owner" required defaultValue={people[0]?.id}>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Kind
              <select name="type" required defaultValue="property">
                <option value="property">Property</option>
                <option value="nps">NPS</option>
                <option value="ulip">ULIP or pension plan</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label>
              Name
              <input name="name" required maxLength={120} placeholder="e.g. Flat in Kochi" />
            </label>
            <label>
              Value (₹)
              <input name="amount" inputMode="decimal" required />
            </label>
            <label>
              As on
              <input name="as_of" type="date" max={today} defaultValue={today} required />
            </label>
          </ActionForm>
        </details>
      </div>
    </>
  );
}
