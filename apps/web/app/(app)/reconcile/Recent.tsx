import Link from 'next/link';
import { formatInr, formatInrCompact, type ReconcileQueue } from '@fwos/core';
import { niceDate } from '@/lib/dates';

const signed = (n: number) => `${n >= 0 ? '+' : '−'}${formatInr(Math.abs(Math.round(n)))}`;

type FormAction = (f: FormData) => Promise<void>;

/** A bank statement line between two balances, as the bank wrote it, with what the rules make of it. */
export interface StatementLineView {
  id: string;
  date: string;
  amount: number;
  narration: string;
  /** what the line is (Between your own accounts, Spending, To answer…) */
  what: string;
  /** why the rules say so */
  why: string;
}

/**
 * What the bank's statement shows between the two balances: each line as the bank wrote it, and what it was taken for, with the
 * lines' sum against the difference. Without lines for those dates, says what would show them.
 */
function StatementLines({
  lines,
  assetId,
  difference,
  sample,
}: {
  lines: StatementLineView[] | undefined;
  assetId: string;
  difference: number;
  sample: boolean;
}) {
  if (!lines) return null;
  if (lines.length === 0)
    return (
      <p className="muted small rc-nolines">
        No statement lines on file for these dates. The bank’s statement for them (Import) shows
        what moved; until then, choose what it most likely was.
      </p>
    );
  const sum = lines.reduce((s, l) => s + l.amount, 0);
  return (
    <details className="rc-lines" open={lines.length <= 8}>
      <summary className="small">
        What the statement shows: {lines.length} line{lines.length === 1 ? '' : 's'}, {signed(sum)}{' '}
        in all
      </summary>
      <div className="rc-lines-wrap">
        <table className="tbl small">
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col" className="num">
                Amount
              </th>
              <th scope="col">As the bank wrote it</th>
              <th scope="col">Taken for</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id}>
                <td>
                  {sample ? (
                    niceDate(l.date)
                  ) : (
                    <Link href={`/asset/${assetId}/line/${l.id}`}>{niceDate(l.date)}</Link>
                  )}
                </td>
                <td className="num">{signed(l.amount)}</td>
                <td className="rc-narr">{l.narration}</td>
                <td title={l.why}>{l.what}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        The lines add up to {signed(sum)}; the difference to explain is {signed(difference)}. A line
        still “to answer” is answered on the Bank statements tab, and its money is then placed for
        good.
      </p>
    </details>
  );
}
interface Holding {
  id: string;
  nickname: string;
  owner_id: string;
}

/** A holding's name: a link to its page, or plain text on the public sample (its holdings have no pages). */
function AssetLink({ id, name, sample }: { id: string; name: string; sample: boolean }) {
  return sample ? <strong>{name}</strong> : <Link href={`/asset/${id}`}>{name}</Link>;
}

/**
 * Explain movements > Recent: matured deposits whose money nobody placed, balances that changed more than expected (with a transfer
 * between your own accounts or a deposit's funding offered first when the other side is on file), and new deposits with no recorded
 * source. Each item has the likeliest answer chosen; nothing is saved until you press Save.
 */
export function Recent({
  q,
  accounts,
  deposits,
  ownerName,
  labels,
  today,
  tolerance,
  act,
  sample = false,
  linesFor = {},
}: {
  q: ReconcileQueue;
  accounts: Holding[];
  deposits: Holding[];
  ownerName: Record<string, string>;
  /** what tells holdings apart (bank, name, last digits, a deposit's amount and maturity, the person), by id */
  labels: Record<string, string>;
  today: string;
  tolerance: number;
  act: { confirmProceeds: FormAction; explainBalance: FormAction; recordFunding: FormAction };
  sample?: boolean;
  /** each changed balance's statement lines between its two balances, by its key */
  linesFor?: Record<string, StatementLineView[]>;
}) {
  const owner = (id: string) => ownerName[id] ?? '';
  const named = (id: string | undefined, fallback: string) => (id && labels[id]) || fallback;
  // the suggested answer in words, naming the holding by its label
  const suggestionText = (
    s: ReconcileQueue['balances'][number]['suggestions'][number],
    b: ReconcileQueue['balances'][number],
  ) =>
    s.kind === 'transfer'
      ? `A transfer ${b.difference > 0 ? 'from' : 'to'} ${named(s.assetId, s.assetName ?? '')}${b.pair && b.pair.assetId === s.assetId ? ` (the same sum ${b.difference > 0 ? 'left it' : 'arrived there'} by ${niceDate(b.pair.date)})` : ''}`
      : s.kind === 'fd_funding'
        ? `Opened the deposit ${named(s.assetId, s.assetName ?? '')}`
        : s.kind === 'fd_proceeds'
          ? `Proceeds of ${named(s.assetId, s.assetName ?? '')}`
          : s.label;
  return (
    <>
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
                  <AssetLink
                    id={p.assetId}
                    name={named(p.assetId, `${p.name} · ${owner(p.ownerId)}`)}
                    sample={sample}
                  />
                  <div className="rc-amount">{formatInrCompact(p.amount)}</div>
                  <div className="muted small">
                    out of the deposit on {niceDate(p.outOn)} · {p.note}
                  </div>
                </div>
                <form action={act.confirmProceeds} className="rc-form">
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
                            {named(a.id, `${a.nickname} · ${owner(a.owner_id)}`)}
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label="Deposits">
                        {deposits
                          .filter((d) => d.id !== p.assetId)
                          .map((d) => (
                            <option key={d.id} value={d.id}>
                              {named(d.id, `${d.nickname} · ${owner(d.owner_id)}`)}
                            </option>
                          ))}
                      </optgroup>
                      <option value="out">Withdrawn from the family (spent, given)</option>
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
          confirmed. A difference above {formatInr(tolerance)} (Settings) is shown here. It is kept
          apart, never counted as profit, until you say what it was.
        </p>
        {q.balances.length === 0 ? (
          <p className="muted">Every recent balance matches.</p>
        ) : (
          <ul className="rc-list">
            {q.balances.map((b) => (
              <li key={b.key} className="rc-item">
                <div className="rc-what">
                  <AssetLink
                    id={b.assetId}
                    name={named(b.assetId, `${b.name} · ${owner(b.ownerId)}`)}
                    sample={sample}
                  />
                  <div className="rc-amount">{signed(b.difference)}</div>
                  <div className="muted small">
                    {formatInr(b.to.amount)} on {niceDate(b.to.date)} against{' '}
                    {formatInr(Math.round(b.expected))} expected from {formatInr(b.from.amount)} on{' '}
                    {niceDate(b.from.date)}
                  </div>
                  <StatementLines
                    lines={linesFor[b.key]}
                    assetId={b.assetId}
                    difference={b.difference}
                    sample={sample}
                  />
                </div>
                <form action={act.explainBalance} className="rc-form">
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
                          value={
                            s.kind === 'fd_proceeds'
                              ? `proceeds:${s.assetId}`
                              : s.kind === 'transfer'
                                ? `pair:${s.assetId}`
                                : s.kind === 'fd_funding'
                                  ? `funding:${s.assetId}`
                                  : 'outside'
                          }
                          defaultChecked={k === 0}
                        />
                        {suggestionText(s, b)}
                      </label>
                    ))}
                    <label className="rc-choice">
                      <input type="radio" name="answer" value="transfer" />A transfer{' '}
                      {b.difference > 0 ? 'from' : 'to'} another of our accounts:
                      <select name="other" defaultValue={b.pair?.assetId ?? ''}>
                        <option value="">choose…</option>
                        {accounts
                          .filter((a) => a.id !== b.assetId)
                          .map((a) => (
                            <option key={a.id} value={a.id}>
                              {named(a.id, a.nickname)}
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
                  <AssetLink
                    id={d.assetId}
                    name={named(d.assetId, `${d.name} · ${owner(d.ownerId)}`)}
                    sample={sample}
                  />
                  <div className="rc-amount">{formatInrCompact(d.principal)}</div>
                  <div className="muted small">booked on {niceDate(d.bookedOn)}</div>
                </div>
                <form action={act.recordFunding} className="rc-form">
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
                            {named(a.id, `${a.nickname} · ${owner(a.owner_id)}`)}
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label="Proceeds of a matured deposit">
                        {deposits
                          .filter((x) => x.id !== d.assetId)
                          .map((x) => (
                            <option key={x.id} value={`proceeds:${x.id}`}>
                              {named(x.id, x.nickname)}
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
