import Link from 'next/link';
import { formatInr } from '@fwos/core';
import { ActionForm, type ActionResult } from '@/components/ActionForm';
import {
  FundFacts,
  FundsWithoutPrice,
  type FundsWithoutPriceActions,
} from '@/components/invest/FundsWithoutPrice';
import { Meter } from '@/components/Meter';
import { niceDate } from '@/lib/dates';
import type { MatchRow } from '@/lib/match-data';
import { exitLoadPercentText, matchProgress, orderForMatching } from '@/lib/match-funds';
import './investments.css';

type Act = (prev: ActionResult | null, f: FormData) => Promise<ActionResult>;

export interface MatchActions extends FundsWithoutPriceActions {
  clearMatch: Act;
  setExitLoad: Act;
  /** takes the "not a listed fund" mark off */
  lookAgain: Act;
}

const rupee = (n: number) => formatInr(Math.round(n));

/* ------------------------------------------------------------------------------------------ match */

function ExitLoadForm({ r, action }: { r: MatchRow; action: Act }) {
  return (
    <ActionForm action={action} submit="Save" className="exitform" keepAfterSave busy="…">
      <input type="hidden" name="asset" value={r.assetId} />
      <input
        className="mini"
        name="pct"
        inputMode="decimal"
        placeholder="default"
        defaultValue={exitLoadPercentText(r.exitLoadFraction)}
        aria-label={`Exit load percent for ${r.name}`}
      />
      <span className="muted small">% for</span>
      <input
        className="mini"
        name="days"
        inputMode="numeric"
        placeholder="days"
        defaultValue={r.exitLoadDays === null ? '' : String(r.exitLoadDays)}
        aria-label={`Exit load days for ${r.name}`}
      />
    </ActionForm>
  );
}

function FundCell({ r }: { r: MatchRow }) {
  return (
    <>
      <Link href={`/asset/${r.assetId}`}>
        <strong>{r.name}</strong>
      </Link>
      <div className="muted small">
        {r.ownerName} ·{' '}
        {r.sipStopped
          ? 'SIP stopped'
          : r.sipMonthly
            ? `SIP ${formatInr(r.sipMonthly)}/month`
            : 'no SIP'}
      </div>
    </>
  );
}

function LastValue({ r }: { r: MatchRow }) {
  return (
    <>
      {r.lastValue ? rupee(r.lastValue.amount) : '–'}
      <div className="muted small">{r.lastValue ? niceDate(r.lastValue.asOf) : ''}</div>
    </>
  );
}

/** Tie each fund to the official scheme once, so its price follows the market every day. */
export function MatchTab({
  rows,
  haveList,
  canMark = true,
  hrefOf = (id) => `/asset/${id}`,
  disabled = false,
  actions,
}: {
  rows: MatchRow[];
  haveList: boolean;
  /** the page of a fund; null leaves the name as plain text (a sample fund that has no page) */
  hrefOf?: (assetId: string) => string | null;
  /** whether the database has the "not a listed fund" mark yet */
  canMark?: boolean;
  /** the public samples show everything but cannot save */
  disabled?: boolean;
  actions: MatchActions;
}) {
  const ordered = orderForMatching(rows.filter((r) => !r.closed || r.amfiCode));
  const progress = matchProgress(ordered);
  const todo = ordered.filter((r) => !r.amfiCode && !r.noPriceSource);
  const unlisted = ordered.filter((r) => !r.amfiCode && r.noPriceSource);
  const done = ordered.filter((r) => r.amfiCode);
  return (
    <>
      <p className="lead muted">
        To move each fund with the market, the portal needs to know which official scheme it is. For
        each fund below it says what it found and which scheme it suggests, with the reason. Approve
        the suggestion, pick another scheme or search for it. Until then a fund&apos;s value is only
        what you last recorded.
      </p>
      {!haveList && (
        <p className="notice warn">
          The official scheme list has not been loaded yet. It is fetched by the daily market-data
          job (GitHub, Actions, &ldquo;Refresh market data&rdquo;); this tab fills in after its
          first run.
        </p>
      )}
      {!canMark && (
        <p className="notice warn">
          &ldquo;This is not a listed fund&rdquo; can be saved once the pending database update has
          run.
        </p>
      )}
      {ordered.length > 0 && (
        <section className="card" aria-label="Matching progress">
          <Meter
            total={progress.total}
            format={(n) => `${n} fund${n === 1 ? '' : 's'}`}
            parts={[
              { label: 'Matched', value: progress.matched, colour: 'var(--primary, #4f46e5)' },
              { label: 'No price source', value: unlisted.length, colour: '#9ca3af' },
              { label: 'To match', value: todo.length, colour: '#d1d5db' },
            ]}
          />
        </section>
      )}

      {todo.length > 0 && (
        <FundsWithoutPrice
          rows={todo}
          actions={actions}
          canMark={canMark}
          hrefs={Object.fromEntries(todo.map((r) => [r.assetId, hrefOf(r.assetId)]))}
          disabled={disabled}
        />
      )}

      {unlisted.length > 0 && (
        <section className="card" aria-labelledby="unlisted">
          <div className="cardhead">
            <h2 id="unlisted">No price source ({unlisted.length})</h2>
            <span className="small muted">
              Not listed funds: they keep the last value you recorded
            </span>
          </div>
          <ul className="np-notlisted">
            {unlisted.map((r) => (
              <li key={r.assetId}>
                <div>
                  {hrefOf(r.assetId) ? (
                    <Link href={hrefOf(r.assetId)!}>
                      <strong>{r.name}</strong>
                    </Link>
                  ) : (
                    <strong>{r.name}</strong>
                  )}
                  <FundFacts r={r} />
                </div>
                <ActionForm
                  action={actions.lookAgain}
                  submit="Look for a scheme again"
                  className="taskrow"
                  busy="…"
                  disabled={disabled}
                >
                  <input type="hidden" name="asset" value={r.assetId} />
                </ActionForm>
              </li>
            ))}
          </ul>
        </section>
      )}

      {done.length > 0 && (
        <section className="card" aria-labelledby="done">
          <div className="cardhead">
            <h2 id="done">Matched ({done.length})</h2>
            <span className="small muted">
              Exit load is optional: leave it empty to use the default in Settings.
            </span>
          </div>
          <table className="tbl lines responsive">
            <thead>
              <tr>
                <th>Your fund</th>
                <th className="num">Last value</th>
                <th>Scheme</th>
                <th>Exit load</th>
              </tr>
            </thead>
            <tbody>
              {done.map((r) => (
                <tr key={r.assetId} className={r.sipStopped ? 'dim' : ''}>
                  <td data-label="Your fund">
                    <FundCell r={r} />
                  </td>
                  <td className="num" data-label="Last value">
                    <LastValue r={r} />
                  </td>
                  <td data-label="Scheme">
                    <ActionForm
                      action={actions.clearMatch}
                      submit="Change"
                      className="taskrow"
                      busy="…"
                      disabled={disabled}
                    >
                      <input type="hidden" name="asset" value={r.assetId} />
                      <span>
                        {r.schemeName ?? 'Scheme'}{' '}
                        <span className="muted small">(AMFI code {r.amfiCode})</span>
                      </span>
                    </ActionForm>
                  </td>
                  <td data-label="Exit load">
                    <ExitLoadForm r={r} action={actions.setExitLoad} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {rows.length === 0 && (
        <p className="empty">
          No mutual funds to match yet. Import your workbook or a fund statement on the{' '}
          <Link href="/import">Import page</Link>.
        </p>
      )}
    </>
  );
}
