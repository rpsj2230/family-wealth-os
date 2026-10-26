import Link from 'next/link';
import { formatInr, formatInrCompact, type PersonStyle } from '@fwos/core';
import '@/app/detail.css';
import './accounts.css';
import { PersonBadge } from '@/components/Person';
import { KpiStrip } from '@/components/KpiStrip';
import { AddButton } from '@/components/QuickEdit';
import { niceDate } from '@/lib/dates';
import type { AccountsSummary, ForeignLine } from '@/lib/accounts-summary';

/** The five figures that say how the banks stand and whether anything needs doing. */
export function AccountsKpis({ s, month }: { s: AccountsSummary; month: string }) {
  return (
    <KpiStrip
      label="Accounts at a glance"
      items={[
        {
          label: 'In banks today',
          value: formatInrCompact(s.total),
          sub: `${formatInr(Math.round(s.total))} across ${s.banks} bank${s.banks === 1 ? '' : 's'}`,
          main: true,
        },
        {
          label: 'Savings and cash',
          value: formatInrCompact(s.savings),
          sub: 'last balance you or the bank recorded',
        },
        {
          label: 'Fixed deposits today',
          value: formatInrCompact(s.fdToday),
          sub: `${formatInrCompact(s.fdInvested)} put in · ${formatInrCompact(s.fdMaturity)} at maturity`,
          href: '/deposits',
        },
        {
          label: `Updated in ${month}`,
          value: (
            <>
              {s.banksDone}
              <span className="muted"> / {s.banks}</span>
            </>
          ),
          sub:
            s.needsYou > 0
              ? `${s.needsYou} need you: old balances or deposits to confirm`
              : s.oldestUpdate
                ? `nothing waiting · oldest balance ${niceDate(s.oldestUpdate)}`
                : 'no balance yet',
          tone: s.needsYou > 0 ? 'warn' : undefined,
          href: '/monthly',
        },
      ]}
    />
  );
}

/** Foreign-currency accounts: the balance as recorded, the rate used and what it is worth in rupees today. */
export function ForeignCard({
  lines,
  styles,
}: {
  lines: ForeignLine[];
  styles: Record<string, PersonStyle>;
}) {
  if (lines.length === 0) return null;
  return (
    <details className="disclose card" id="foreign">
      <summary>Foreign-currency accounts ({lines.length}) · rate used for rupees</summary>
      <table className="tbl lines responsive">
        <thead>
          <tr>
            <th>Account</th>
            <th className="num">Balance</th>
            <th className="num">Rate used</th>
            <th className="num">In rupees today</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.assetId}>
              <td data-label="Account">
                <PersonBadge p={styles[l.ownerId]} size={16} />{' '}
                <Link href={`/asset/${l.assetId}`}>{l.name}</Link>
              </td>
              <td className="num" data-label="Balance">
                {l.amount === null ? '–' : `${l.currency} ${l.amount.toLocaleString('en-IN')}`}
                {l.asOf && <div className="muted small">recorded {niceDate(l.asOf)}</div>}
              </td>
              <td className="num" data-label="Rate used">
                {l.rate === null ? '–' : `₹${l.rate.toFixed(3)}`}
                {l.rateDate && <div className="muted small">{niceDate(l.rateDate)}</div>}
              </td>
              <td className="num" data-label="In rupees today">
                {l.inr === null ? '–' : formatInr(Math.round(l.inr))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">
        The exchange rate is refreshed every day from a public source. A change in the rate moves
        the rupee value, not the balance.
      </p>
    </details>
  );
}

/** Where the person is inside Manage: Accounts › Manage › the tool. */
export function ManageCrumbs({ current }: { current: string }) {
  return (
    <nav className="crumbs" aria-label="Breadcrumb">
      <Link href="/accounts">Accounts</Link> <span aria-hidden>›</span>{' '}
      <Link href="/accounts?tab=manage">Manage</Link> <span aria-hidden>›</span>{' '}
      <span aria-current="page">{current}</span>
    </nav>
  );
}

export interface ManageFacts {
  /** rows whose NRE/NRO type is guessed from the savings account */
  assumedTypes: number;
  /** account notes that hold a fact about the whole bank */
  notesToMove: number | null;
  banks: number;
  accounts: number;
}

/** One place for everything that changes the shape of the account list. Each card says what it does and how much there is to do. */
export function ManageCards({
  facts,
  base = '/accounts',
  sample = false,
}: {
  facts: ManageFacts;
  base?: string;
  sample?: boolean;
}) {
  const href = (path: string) => (sample ? `/demo/accounts/${path}` : `/accounts/${path}`);
  return (
    <div className="cardgrid">
      <article className={`pickcard ${facts.assumedTypes > 0 ? 'attention' : ''}`}>
        <h3>Edit many accounts at once</h3>
        <p className="meta">
          One table of every account and deposit: set the type (NRE, NRO), the name, a note or a
          deposit&apos;s terms for several lines together.
        </p>
        <p className="small">
          {facts.assumedTypes > 0 ? (
            <strong>
              {facts.assumedTypes} row{facts.assumedTypes === 1 ? '' : 's'} with a guessed type
            </strong>
          ) : (
            <span className="muted">Every row has its type.</span>
          )}
        </p>
        <div className="cardactions">
          <Link className="btn primary" href={href('edit')}>
            Open the table
          </Link>
        </div>
      </article>
      <article className="pickcard">
        <h3>Change the order</h3>
        <p className="meta">
          Banks and the rows inside them follow your sheet. Drag, or use the arrows, to put them
          where you want them. Accounts and the monthly update follow.
        </p>
        <p className="small muted">
          {facts.banks} banks · {facts.accounts} rows
        </p>
        <div className="cardactions">
          <Link className="btn" href={href('reorder')}>
            Change the order
          </Link>
        </div>
      </article>
      <article className={`pickcard ${facts.notesToMove ? 'attention' : ''}`}>
        <h3>Tidy bank notes</h3>
        <p className="meta">
          Facts about a whole bank (minimum balance, lounge cards, no debit card) belong on the bank
          once, not on every account.
        </p>
        <p className="small">
          {facts.notesToMove === null ? (
            <span className="muted">Checked when you open it.</span>
          ) : facts.notesToMove > 0 ? (
            <strong>
              {facts.notesToMove} account note{facts.notesToMove === 1 ? '' : 's'} can move up
            </strong>
          ) : (
            <span className="muted">Nothing to move.</span>
          )}
        </p>
        <div className="cardactions">
          <Link className="btn" href={href('tidy-notes')}>
            Review the notes
          </Link>
        </div>
      </article>
      <article className="pickcard">
        <h3>Add an account or a deposit</h3>
        <p className="meta">
          Choose the bank and the person; it is placed where it belongs in your bank order.
        </p>
        <div className="cardactions">
          <AddButton label="Add an account or a deposit" />
        </div>
      </article>
      <p className="small muted" style={{ gridColumn: '1 / -1' }}>
        A note about one bank is edited on that bank&apos;s card under{' '}
        <Link href={base}>Banks</Link> (&ldquo;Edit note&rdquo;). To put the order back to your
        Excel sheet&apos;s, upload the workbook under <Link href="/import">Import</Link>.
      </p>
    </div>
  );
}
