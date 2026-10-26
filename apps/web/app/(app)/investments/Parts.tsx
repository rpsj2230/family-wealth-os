import Link from 'next/link';
import { formatInr } from '@fwos/core';
import { ActionForm, type ActionResult } from '@/components/ActionForm';
import { Meter } from '@/components/Meter';
import { niceDate } from '@/lib/dates';
import type { MatchRow } from '@/lib/match-data';
import { exitLoadPercentText, matchProgress, orderForMatching } from '@/lib/match-funds';
import './investments.css';

type Act = (prev: ActionResult | null, f: FormData) => Promise<ActionResult>;

export interface MatchActions {
  confirmMatch: Act;
  clearMatch: Act;
  setExitLoad: Act;
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
        {r.navHint ? ` · sheet note NAV ${r.navHint}` : ''}
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
  actions,
}: {
  rows: MatchRow[];
  haveList: boolean;
  actions: MatchActions;
}) {
  const ordered = orderForMatching(rows);
  const progress = matchProgress(rows);
  const todo = ordered.filter((r) => !r.amfiCode);
  const done = ordered.filter((r) => r.amfiCode);
  return (
    <>
      <p className="lead muted">
        To move each fund with the market, the portal needs to know which official scheme it is.
        Check the suggested scheme (name, Direct or Regular) and confirm it once. Until then a
        fund&apos;s value is only what you last recorded.
      </p>
      {!haveList && (
        <p className="notice warn">
          The official scheme list has not been loaded yet. It is fetched by the daily market-data
          job (GitHub, Actions, &ldquo;Refresh market data&rdquo;); this tab fills in after its
          first run.
        </p>
      )}
      {rows.length > 0 && (
        <section className="card" aria-label="Matching progress">
          <Meter
            total={progress.total}
            format={(n) => `${n} fund${n === 1 ? '' : 's'}`}
            parts={[
              { label: 'Matched', value: progress.matched, colour: 'var(--primary, #4f46e5)' },
              { label: 'To check', value: progress.pending, colour: '#d1d5db' },
            ]}
          />
        </section>
      )}

      {todo.length > 0 && (
        <section className="card" aria-labelledby="todo">
          <div className="cardhead">
            <h2 id="todo">To check ({todo.length})</h2>
            <span className="small muted">Funds that do not yet follow a daily price</span>
          </div>
          <table className="tbl lines responsive">
            <thead>
              <tr>
                <th>Your fund</th>
                <th className="num">Last value</th>
                <th>Suggested scheme</th>
                <th>Exit load</th>
              </tr>
            </thead>
            <tbody>
              {todo.map((r) => (
                <tr key={r.assetId} className={r.sipStopped ? 'dim' : ''}>
                  <td data-label="Your fund">
                    <FundCell r={r} />
                  </td>
                  <td className="num" data-label="Last value">
                    <LastValue r={r} />
                  </td>
                  <td data-label="Suggested scheme">
                    {r.candidates.length > 0 ? (
                      <ul className="list nobullet">
                        {r.candidates.map((c, i) => (
                          <li key={c.code}>
                            <ActionForm
                              action={actions.confirmMatch}
                              submit={r.confident && i === 0 ? 'Confirm' : 'Use this'}
                              className="taskrow"
                              primary={r.confident && i === 0}
                              busy="…"
                            >
                              <input type="hidden" name="asset" value={r.assetId} />
                              <input type="hidden" name="code" value={c.code} />
                              <span>
                                {c.name}{' '}
                                <span className="muted small">
                                  ({c.plan}, {c.amc})
                                </span>
                                {c.navGap !== null ? (
                                  <span className="muted small">
                                    {' '}
                                    · price differs {(c.navGap * 100).toFixed(0)}% from your note
                                  </span>
                                ) : null}
                              </span>
                            </ActionForm>
                          </li>
                        ))}
                      </ul>
                    ) : haveList ? (
                      <span className="muted">
                        No automatic match. This fund&apos;s name may not match the official list;
                        leave it for now. You can still update it by hand under Update funds.
                      </span>
                    ) : (
                      <span className="muted">Waiting for the scheme list</span>
                    )}
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
                    >
                      <input type="hidden" name="asset" value={r.assetId} />
                      <span>Confirmed: scheme {r.amfiCode}</span>
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
