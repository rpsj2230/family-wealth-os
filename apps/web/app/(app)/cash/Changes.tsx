import Link from 'next/link';
import {
  balanceChanges,
  bankRowFigures,
  formatForeign,
  formatInr,
  type BalanceChange,
  type BankBlock,
  type BankRow,
  type ObservationRow,
  type PersonStyle,
} from '@fwos/core';
import { BankBadge } from '@/components/BankBadge';
import { PersonBadge } from '@/components/Person';
import { niceDate } from '@/lib/dates';

const money = (n: number, currency: string) =>
  currency === 'INR' ? formatInr(Math.round(n)) : formatForeign(n, currency);
const signed = (n: number, currency: string) =>
  `${n > 0 ? '+' : n < 0 ? '−' : ''}${money(Math.abs(n), currency)}`;

type ChangeRow = {
  r: BankRow;
  bank: string;
  c: BalanceChange | null;
};

function ChangeTable({
  rows,
  styles,
  sample,
}: {
  rows: ChangeRow[];
  styles: Record<string, PersonStyle>;
  sample: boolean;
}) {
  return (
    <table className="tbl lines responsive">
      <caption className="sr-only">Previous and latest balance of each savings account</caption>
      <thead>
        <tr>
          <th>Account</th>
          <th className="num">Previous</th>
          <th className="num">Latest</th>
          <th className="num">Change</th>
          <th>Updated</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ r, bank, c }) => (
          <tr key={r.assetId} data-stale={r.stale ? 'true' : undefined}>
            <td data-label="Account">
              <div className="codeline">
                <BankBadge name={bank} size={26} />
                <div>
                  <Link href={sample ? '/demo/asset' : `/asset/${r.assetId}`}>{r.code}</Link>
                  <div className="small muted">
                    {bank} · <PersonBadge p={styles[r.ownerId]} name size={14} />
                  </div>
                </div>
              </div>
            </td>
            <td className="num" data-label="Previous">
              {c?.previous ? (
                <>
                  {money(c.previous.amount, c.currency)}
                  <div className="small muted">{niceDate(c.previous.date)}</div>
                </>
              ) : (
                <span className="muted small">{c ? 'only one reading' : 'none'}</span>
              )}
            </td>
            <td className="num" data-label="Latest">
              {c ? (
                <>
                  <b>{money(c.latest.amount, c.currency)}</b>
                  <div className="small muted">{niceDate(c.latest.date)}</div>
                </>
              ) : (
                <span className="muted small">none recorded</span>
              )}
            </td>
            <td className="num" data-label="Change">
              {c?.change !== null && c?.change !== undefined ? (
                <span className={c.change > 0 ? 'gain' : c.change < 0 ? 'fail' : undefined}>
                  {signed(c.change, c.currency)}
                </span>
              ) : (
                <span className="muted small">—</span>
              )}
            </td>
            <td data-label="Updated">
              {r.stale ? (
                <span className="pill warn">Out of date</span>
              ) : (
                <span className="pill ok">Recent</span>
              )}
              {c && (
                <div className="small muted">
                  {c.days === 0 ? 'today' : `${c.days} day${c.days === 1 ? '' : 's'} ago`}
                </div>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Each savings account's previous and latest recorded balance, the change between them and how long ago the latest one was, with
 * the accounts out of date first. A change between two readings is a move in the balance (money in and out, interest and transfers
 * together), not a profit.
 */
export function BalanceChanges({
  blocks,
  observations,
  today,
  styles,
  sample = false,
}: {
  blocks: BankBlock[];
  observations: ObservationRow[];
  today: string;
  styles: Record<string, PersonStyle>;
  sample?: boolean;
}) {
  const rows = blocks
    .flatMap((b) => b.sections.flatMap((s) => s.rows.map((r) => ({ r, bank: b.name }))))
    .filter((x) => bankRowFigures(x.r).counted);
  const changes = new Map(
    balanceChanges(
      observations,
      rows.map((x) => x.r.assetId),
      today,
    ).map((c) => [c.assetId, c]),
  );
  const list = rows
    .map((x) => ({ ...x, c: changes.get(x.r.assetId) ?? null }))
    .sort(
      (a, b) =>
        Number(b.r.stale) - Number(a.r.stale) ||
        (b.c?.days ?? Number.MAX_SAFE_INTEGER) - (a.c?.days ?? Number.MAX_SAFE_INTEGER),
    );
  if (list.length === 0) return null;
  const staleRows = list.filter((x) => x.r.stale);
  const recentRows = list.filter((x) => !x.r.stale);
  const stale = staleRows.length;
  const never = list.filter((x) => !x.c).length;
  return (
    <section className="card cashreg" aria-labelledby="cash-chg-h" data-testid="cash-changes">
      <h2 id="cash-chg-h">Balance changes and out-of-date records</h2>
      <p className="small muted" data-testid="cash-changes-summary">
        {stale > 0
          ? `${stale} of ${list.length} balance${list.length === 1 ? ' is' : 's are'} out of date (older than the account's update window); they are listed first and still counted at their last value.`
          : `Every balance is within its update window.`}
        {never > 0 ? ` ${never} ${never === 1 ? 'has' : 'have'} no recorded balance.` : ''} A change
        between two readings is a move in the balance — money in and out, interest and transfers
        together — not a profit.
      </p>
      {staleRows.length > 0 && <ChangeTable rows={staleRows} styles={styles} sample={sample} />}
      {recentRows.length > 0 && (
        <details className="disclose" data-testid="cash-changes-recent">
          <summary>
            {staleRows.length > 0 ? 'Show the other' : 'Show all'} {recentRows.length} account
            {recentRows.length === 1 ? '' : 's'} with their previous and latest balance
          </summary>
          <ChangeTable rows={recentRows} styles={styles} sample={sample} />
        </details>
      )}
    </section>
  );
}
