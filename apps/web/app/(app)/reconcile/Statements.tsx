import Link from 'next/link';
import {
  formatInr,
  formatInrCompact,
  type Classified,
  type LineClass,
  type StatementInterestRow,
  type StmtLine,
} from '@fwos/core';
import { niceDate } from '@/lib/dates';
import type { StoredBankStatement } from '@fwos/data';
import { answerLine, deleteStatement, rebuildStatements, removeCovered } from './statement-actions';

const signed = (n: number) => `${n >= 0 ? '+' : '−'}${formatInr(Math.abs(Math.round(n)))}`;
const fyOf = (date: string) => {
  const y = Number(date.slice(0, 4));
  const s = date.slice(5) >= '04-01' ? y : y - 1;
  return `${s}-${String((s + 1) % 100).padStart(2, '0')}`;
};

/** The columns of the yearly summary: what each kind of line adds up to. */
const COLUMNS: { key: string; label: string; classes: LineClass[] }[] = [
  { key: 'in', label: 'Money from outside', classes: ['outside_in'] },
  { key: 'out', label: 'Spending and money out', classes: ['spent', 'fee', 'tax'] },
  { key: 'rent', label: 'Rent', classes: ['rent', 'income'] },
  { key: 'int', label: 'Interest (after tax)', classes: ['interest', 'interest_tax'] },
  {
    key: 'own',
    label: 'Between your holdings',
    classes: ['own_transfer', 'fd_funding', 'fd_proceeds', 'fund_buy', 'fund_sell', 'fd_interest'],
  },
  { key: 'ask', label: 'To answer', classes: ['ask_in', 'ask_out'] },
];

/** A movement entered before the statements arrived that they now cover. */
export interface CoveredMove {
  id: string;
  on: string;
  amount: number;
  kind: string;
  assetId: string;
  into: boolean;
}

export interface StatementsAct {
  answer: (f: FormData) => Promise<void>;
  remove: (f: FormData) => Promise<void>;
  rebuild: (f: FormData) => Promise<void>;
  covered: (f: FormData) => Promise<void>;
}

/**
 * Explain movements > Bank statements: which days each account's statements cover, what the lines add up to each year, the lines no
 * rule could place (largest first) with a short form for each, the interest compared with the estimate, and any answer given earlier
 * that the statements now cover.
 */
export function Statements({
  statements,
  lines,
  classified,
  interest,
  labels,
  covered,
  act = {
    answer: answerLine,
    remove: deleteStatement,
    rebuild: rebuildStatements,
    covered: removeCovered,
  },
  sample = false,
}: {
  statements: StoredBankStatement[];
  lines: StmtLine[];
  classified: Classified[];
  interest: StatementInterestRow[];
  labels: Record<string, string>;
  covered: CoveredMove[];
  act?: StatementsAct;
  sample?: boolean;
}) {
  const cls = new Map(classified.map((c) => [c.id, c]));
  const label = (id: string) => labels[id] ?? 'An account';
  const importHref = sample ? '/demo/import' : '/import';

  // coverage per account, with the gaps between statements
  const byAccount = new Map<string, StoredBankStatement[]>();
  for (const s of statements) byAccount.set(s.asset_id, [...(byAccount.get(s.asset_id) ?? []), s]);

  // the yearly summary
  const years = new Map<string, Record<string, number>>();
  for (const l of lines) {
    const c = cls.get(l.id)?.cls;
    if (!c) continue;
    const col = COLUMNS.find((x) => x.classes.includes(c));
    if (!col) continue;
    const fy = fyOf(l.date);
    const row = years.get(fy) ?? {};
    row[col.key] = (row[col.key] ?? 0) + l.amount;
    years.set(fy, row);
  }
  const fys = [...years.keys()].sort().reverse();

  const ask = lines
    .filter((l) => {
      const c = cls.get(l.id)?.cls;
      return c === 'ask_in' || c === 'ask_out';
    })
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  const askTotal = ask.reduce((a, l) => a + Math.abs(l.amount), 0);
  const answered = lines.filter((l) => l.answer).sort((a, b) => b.date.localeCompare(a.date));
  const ANSWER_LABEL: Record<string, string> = {
    outside: 'Money from outside',
    own: 'Between your own accounts',
    income: 'Other earnings',
    rent: 'Rent',
    out: 'Spending or money out',
  };

  return (
    <>
      <section className="card rc" aria-labelledby="rc-s">
        <h2 id="rc-s">Bank statements: what every line was</h2>
        <p className="muted small">
          Each imported statement is read line by line. Interest, rent, money from abroad, transfers
          between your accounts, deposits, fund purchases and spending are sorted by the rules (the
          words for rent and remittances are in{' '}
          <Link href={sample ? '/demo/settings#estimates' : '/settings#estimates'}>Settings</Link>
          ). Your own money and lifetime profit then follow from what really happened. Add a
          statement on <Link href={importHref}>Import</Link>: one account and one year at a time is
          easiest.
        </p>
        {statements.length === 0 ? (
          <p className="small" data-testid="rc-s-empty">
            No bank statement has been imported yet.
          </p>
        ) : (
          <ul className="rc-list" data-testid="rc-s-cover">
            {[...byAccount.entries()]
              .sort((a, b) => label(a[0]).localeCompare(label(b[0])))
              .map(([assetId, list]) => {
                const sorted = [...list].sort((a, b) => a.from_on.localeCompare(b.from_on));
                const gaps: string[] = [];
                for (let i = 1; i < sorted.length; i++) {
                  const prev = sorted[i - 1]!.to_on;
                  const next = sorted[i]!.from_on;
                  const days = (Date.parse(next) - Date.parse(prev)) / 86400000;
                  if (days > 35) gaps.push(`${niceDate(prev)} to ${niceDate(next)}`);
                }
                return (
                  <li key={assetId} className="rc-item">
                    <div className="rc-what">
                      <strong>{label(assetId)}</strong>
                      <div className="small">
                        {niceDate(sorted[0]!.from_on)} to{' '}
                        {niceDate(sorted[sorted.length - 1]!.to_on)}
                        {gaps.length > 0 && (
                          <span className="fail">
                            {' '}
                            · gap{gaps.length === 1 ? '' : 's'}: {gaps.join('; ')}
                          </span>
                        )}
                      </div>
                    </div>
                    <ul className="list small">
                      {sorted.map((s) => (
                        <li key={s.id}>
                          {niceDate(s.from_on)} – {niceDate(s.to_on)}: {s.line_count} lines
                          {s.breaks > 0 && (
                            <span className="fail"> · {s.breaks} not following the balance</span>
                          )}{' '}
                          <form action={act.remove} style={{ display: 'inline' }}>
                            <input type="hidden" name="statement" value={s.id} />
                            <button className="btn ghost small">Remove</button>
                          </form>
                        </li>
                      ))}
                    </ul>
                  </li>
                );
              })}
          </ul>
        )}
        {statements.length > 0 && (
          <form action={act.rebuild}>
            <button className="btn ghost">Sort every line again</button>{' '}
            <span className="muted small">
              after changing a rule in Settings, or adding a deposit or a CAS
            </span>
          </form>
        )}
      </section>

      {fys.length > 0 && (
        <section className="card rc" aria-labelledby="rc-sy">
          <h2 id="rc-sy">What the lines add up to, by financial year</h2>
          <div className="rc-scroll">
            <table className="table small" data-testid="rc-s-years">
              <thead>
                <tr>
                  <th scope="col">Year</th>
                  {COLUMNS.map((c) => (
                    <th key={c.key} scope="col" className="num">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {fys.map((fy) => (
                  <tr key={fy}>
                    <th scope="row">{fy}</th>
                    {COLUMNS.map((c) => (
                      <td key={c.key} className="num">
                        {years.get(fy)![c.key] ? formatInrCompact(years.get(fy)![c.key]!) : '–'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">
            Between your holdings adds up to about nothing when both sides are on file: money that
            moved between your accounts, deposits and funds.
          </p>
        </section>
      )}

      {statements.length > 0 && (
        <section className="card rc" aria-labelledby="rc-sa">
          <h2 id="rc-sa">Lines to answer</h2>
          <p className="small" data-testid="rc-s-ask">
            {ask.length === 0
              ? 'None: every line is sorted.'
              : `${ask.length} line${ask.length === 1 ? '' : 's'}, ${formatInrCompact(askTotal)} in all, largest first. Until you answer, each counts as your own money and never as profit.`}
          </p>
          {ask.length > 0 && (
            <ul className="rc-list">
              {ask.slice(0, 40).map((l) => {
                const into = l.amount > 0;
                const c = cls.get(l.id)!;
                return (
                  <li key={l.id} className="rc-item" data-line={l.id}>
                    <div className="rc-what">
                      <strong>{niceDate(l.date)}</strong> · {label(l.assetId)}
                      <div className="rc-amount">{signed(l.amount)}</div>
                      <div className="small">{l.narration || 'No narration'}</div>
                      <div className="muted small">{c.reason}</div>
                    </div>
                    <form action={act.answer} className="rc-form">
                      <input type="hidden" name="line" value={l.id} />
                      <fieldset>
                        <legend className="small">It was</legend>
                        {(into
                          ? [
                              ['outside', 'Money from outside (salary, a remittance, a gift)'],
                              ['own', 'From another of your accounts'],
                              ['rent', 'Rent'],
                              ['income', 'Other earnings (interest, a bonus, a refund of tax)'],
                            ]
                          : [
                              ['out', 'Spending or money out (given, sent abroad, paid)'],
                              ['own', 'To another of your accounts, deposits or funds'],
                            ]
                        ).map(([v, t], i) => (
                          <label key={v} className="rc-choice">
                            <input type="radio" name="answer" value={v} defaultChecked={i === 0} />
                            {t}
                          </label>
                        ))}
                      </fieldset>
                      <button className="btn primary">Save</button>
                    </form>
                  </li>
                );
              })}
            </ul>
          )}
          {ask.length > 40 && (
            <p className="muted small">The next {ask.length - 40} appear as these are answered.</p>
          )}
        </section>
      )}

      {interest.length > 0 && (
        <section className="card rc" aria-labelledby="rc-si">
          <h2 id="rc-si">Interest in the statements against the estimate</h2>
          <p className="muted small">
            For each account and year the statements cover in full. The difference is recorded as
            that year&apos;s earnings, so lifetime profit uses what the bank really paid.
          </p>
          <div className="rc-scroll">
            <table className="table small" data-testid="rc-s-interest">
              <thead>
                <tr>
                  <th scope="col">Account</th>
                  <th scope="col">Year</th>
                  <th scope="col" className="num">
                    In the statements
                  </th>
                  <th scope="col" className="num">
                    Estimated
                  </th>
                  <th scope="col" className="num">
                    Recorded as earnings
                  </th>
                </tr>
              </thead>
              <tbody>
                {interest.map((r) => (
                  <tr key={`${r.assetId}|${r.fy}`}>
                    <td>{label(r.assetId)}</td>
                    <td>{r.fy}</td>
                    <td className="num">{formatInr(Math.round(r.actual))}</td>
                    <td className="num">{formatInr(Math.round(r.estimated))}</td>
                    <td className="num">{signed(r.difference)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {covered.length > 0 && (
        <section className="card rc" aria-labelledby="rc-sc">
          <h2 id="rc-sc">Earlier answers the statements now cover</h2>
          <p className="muted small">
            You recorded these by hand before the statements arrived. The statements now count the
            same money line by line, so keeping both would count it twice. Remove the ones that are
            the same money.
          </p>
          <form action={act.covered}>
            <ul className="rc-list" data-testid="rc-s-covered">
              {covered.map((m) => (
                <li key={m.id} className="rc-item">
                  <label className="rc-choice">
                    <input type="checkbox" name="move" value={m.id} defaultChecked />
                    {niceDate(m.on)} · {label(m.assetId)} · {m.into ? 'in' : 'out'}{' '}
                    {formatInr(Math.round(m.amount))} ({m.kind})
                  </label>
                </li>
              ))}
            </ul>
            <button className="btn">Remove the ticked answers</button>
          </form>
        </section>
      )}

      {answered.length > 0 && (
        <section className="card rc" aria-labelledby="rc-sx">
          <h2 id="rc-sx">Your answers on statement lines</h2>
          <ul className="rc-list">
            {answered.slice(0, 30).map((l) => (
              <li key={l.id} className="rc-item">
                <div className="rc-what small">
                  <strong>{ANSWER_LABEL[l.answer!] ?? l.answer}</strong> · {signed(l.amount)} on{' '}
                  {niceDate(l.date)} · {label(l.assetId)}
                  <div className="muted">{l.narration}</div>
                </div>
                <form action={act.answer}>
                  <input type="hidden" name="line" value={l.id} />
                  <input type="hidden" name="answer" value="" />
                  <button className="btn ghost">Undo</button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
