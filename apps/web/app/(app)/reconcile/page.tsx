import Link from 'next/link';
import { redirect } from 'next/navigation';
import { formatInr, formatInrCompact, positionInputFrom, reconcileQueue } from '@fwos/core';
import { loadSettings } from '@fwos/data';
import type { SupabaseClient } from '@supabase/supabase-js';
import { PageHead } from '@/components/PageHead';
import { loadAccess, loadContext } from '@/lib/data';
import { niceDate } from '@/lib/dates';
import { loadPortfolio } from '@/lib/portfolio-data';
import { confirmProceeds, explainBalance, recordFunding } from './actions';
import './reconcile.css';

export const dynamic = 'force-dynamic';

const signed = (n: number) => `${n >= 0 ? '+' : '−'}${formatInr(Math.abs(Math.round(n)))}`;

/**
 * Explain movements: the few answers that make own money and profit exact. Each item comes with the likeliest answer chosen and the
 * reason; nothing is assigned until a person saves it, and saving the same answer twice changes nothing.
 */
export default async function Reconcile({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string }>;
}) {
  const { msg } = await searchParams;
  if ((await loadAccess()).role === 'emergency_viewer') redirect('/emergency');
  const { supabase } = await loadContext();
  const loaded = await loadPortfolio(supabase);
  const { config } = await loadSettings(supabase as unknown as SupabaseClient);
  const today = loaded.today.toISOString().slice(0, 10);
  const position = positionInputFrom({
    assets: loaded.assetRows,
    observations: [...loaded.obsRows, ...loaded.sheetObs],
    fds: loaded.fdRows,
    config,
    today,
    ...(loaded.engine.extras.moves ? { moves: loaded.engine.extras.moves } : {}),
    ...(loaded.engine.extras.rates ? { rates: loaded.engine.extras.rates } : {}),
    ...(loaded.engine.extras.placements ? { placements: loaded.engine.extras.placements } : {}),
  });
  const q = reconcileQueue({
    position,
    moves: loaded.engine.moves,
    tolerance: config.estimates.unexplainedTolerance,
    sinceDays: Math.max(config.deposits.hideMaturedAfterDays, 120),
  });
  const owner = (id: string) => loaded.ownerName.get(id) ?? '';
  const accounts = loaded.assetRows.filter(
    (a) => a.type === 'bank_account' && a.status !== 'gifted',
  );
  const deposits = loaded.assetRows.filter(
    (a) => a.type === 'fixed_deposit' && a.status !== 'gifted',
  );

  return (
    <>
      <PageHead
        title="Explain movements"
        subtitle="Where matured money went, what a balance change was, and where a new deposit's money came from. Your answers make own money and profit exact; until then the amounts are kept apart and never counted as profit."
        pills={[
          q.count === 0
            ? { label: 'Nothing to explain', tone: 'ok' }
            : { label: `${q.count} to explain`, tone: 'warn' },
        ]}
      />
      {msg && (
        <p className="notice ok" role="status">
          {msg}
        </p>
      )}

      <section className="card rc" aria-labelledby="rc-p">
        <h2 id="rc-p">Matured deposits: where did the money go?</h2>
        <p className="muted small">
          A matured deposit is never reinvested by the app. Its proceeds are counted once in net
          worth until you say where they went, unless a new deposit or a later balance already holds
          them (then they are not counted twice).
        </p>
        {q.proceeds.length === 0 ? (
          <p className="muted">Nothing to confirm.</p>
        ) : (
          <ul className="rc-list">
            {q.proceeds.map((p) => (
              <li key={p.assetId} className="rc-item">
                <div className="rc-what">
                  <Link href={`/asset/${p.assetId}`}>{p.name}</Link> · {owner(p.ownerId)}
                  <div className="rc-amount">{formatInrCompact(p.amount)}</div>
                  <div className="muted small">
                    out of the deposit on {niceDate(p.outOn)} · {p.note}
                  </div>
                </div>
                <form action={confirmProceeds} className="rc-form">
                  <input type="hidden" name="fd" value={p.assetId} />
                  <label>
                    Went to
                    <select name="dest" defaultValue={p.suggestion?.assetId ?? ''} required>
                      <option value="" disabled>
                        Choose…
                      </option>
                      <optgroup label="Savings accounts">
                        {accounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.nickname} · {owner(a.owner_id)}
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label="Deposits">
                        {deposits
                          .filter((d) => d.id !== p.assetId)
                          .map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.nickname} · {owner(d.owner_id)}
                            </option>
                          ))}
                      </optgroup>
                      <option value="out">Taken out of the family (spent, given)</option>
                    </select>
                  </label>
                  {p.suggestion && (
                    <span className="muted small">Suggested: {p.suggestion.why}.</span>
                  )}
                  <label>
                    On
                    <input type="date" name="on" defaultValue={p.outOn} max={today} required />
                  </label>
                  <label>
                    Amount (₹)
                    <input
                      name="amount"
                      inputMode="decimal"
                      defaultValue={String(Math.round(p.amount))}
                      required
                    />
                  </label>
                  <button className="btn primary">Confirm</button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card rc" aria-labelledby="rc-b">
        <h2 id="rc-b">Balances that changed more than expected</h2>
        <p className="muted small">
          A new balance is compared with the earlier one plus the interest and the movements you
          confirmed. A difference above {formatInr(config.estimates.unexplainedTolerance)}{' '}
          (Settings) is shown here. It is kept apart, never counted as profit, until you say what it
          was.
        </p>
        {q.balances.length === 0 ? (
          <p className="muted">Every recent balance matches.</p>
        ) : (
          <ul className="rc-list">
            {q.balances.map((b) => (
              <li key={b.key} className="rc-item">
                <div className="rc-what">
                  <Link href={`/asset/${b.assetId}`}>{b.name}</Link> · {owner(b.ownerId)}
                  <div className="rc-amount">{signed(b.difference)}</div>
                  <div className="muted small">
                    {formatInr(b.to.amount)} on {niceDate(b.to.date)} against{' '}
                    {formatInr(Math.round(b.expected))} expected from {formatInr(b.from.amount)} on{' '}
                    {niceDate(b.from.date)}
                  </div>
                </div>
                <form action={explainBalance} className="rc-form">
                  <input type="hidden" name="account" value={b.assetId} />
                  <input type="hidden" name="on" value={b.to.date} />
                  <input type="hidden" name="key" value={b.key} />
                  <input type="hidden" name="difference" value={String(b.difference)} />
                  <fieldset>
                    <legend className="small">It was</legend>
                    {b.suggestions.map((s, k) => (
                      <label key={k} className="rc-choice">
                        <input
                          type="radio"
                          name="answer"
                          value={s.kind === 'fd_proceeds' ? `proceeds:${s.assetId}` : 'outside'}
                          defaultChecked={k === 0}
                        />
                        {s.label}
                      </label>
                    ))}
                    <label className="rc-choice">
                      <input type="radio" name="answer" value="transfer" />A transfer{' '}
                      {b.difference > 0 ? 'from' : 'to'} another of our accounts:
                      <select name="other" defaultValue="">
                        <option value="">choose…</option>
                        {accounts
                          .filter((a) => a.id !== b.assetId)
                          .map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.nickname}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label className="rc-choice">
                      <input type="radio" name="answer" value="correction" />A correction (the
                      earlier balance was wrong)
                    </label>
                  </fieldset>
                  <button className="btn primary">Save</button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card rc" aria-labelledby="rc-f">
        <h2 id="rc-f">New deposits: where did the money come from?</h2>
        <p className="muted small">
          So own money is not counted twice: a deposit funded from savings or from a matured deposit
          moves money between your own holdings; only money from outside adds to own money.
        </p>
        {q.funding.length === 0 ? (
          <p className="muted">Every recent deposit has a source.</p>
        ) : (
          <ul className="rc-list">
            {q.funding.map((d) => (
              <li key={d.assetId} className="rc-item">
                <div className="rc-what">
                  <Link href={`/asset/${d.assetId}`}>{d.name}</Link> · {owner(d.ownerId)}
                  <div className="rc-amount">{formatInrCompact(d.principal)}</div>
                  <div className="muted small">booked on {niceDate(d.bookedOn)}</div>
                </div>
                <form action={recordFunding} className="rc-form">
                  <input type="hidden" name="fd" value={d.assetId} />
                  <input type="hidden" name="on" value={d.bookedOn} />
                  <input type="hidden" name="amount" value={String(d.principal)} />
                  <label>
                    Came from
                    <select name="source" defaultValue={d.suggestion?.assetId ?? ''} required>
                      <option value="" disabled>
                        Choose…
                      </option>
                      <optgroup label="Savings accounts">
                        {accounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.nickname} · {owner(a.owner_id)}
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label="Proceeds of a matured deposit">
                        {deposits
                          .filter((x) => x.id !== d.assetId)
                          .map((x) => (
                            <option key={x.id} value={`proceeds:${x.id}`}>
                              {x.nickname}
                            </option>
                          ))}
                      </optgroup>
                      <option value="outside">Money from outside (salary, a gift, a sale)</option>
                    </select>
                  </label>
                  {d.suggestion && (
                    <span className="muted small">Suggested: {d.suggestion.why}.</span>
                  )}
                  <button className="btn primary">Save</button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
