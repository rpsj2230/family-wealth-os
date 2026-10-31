import Link from 'next/link';
import { CategoryOptions } from '@/components/CategoryOptions';
import {
  categoryLabel,
  formatInr,
  formatInrCompact,
  type Classified,
  type LineClass,
  type StatementInterestRow,
  type StatementRule,
  type StmtLine,
} from '@fwos/core';
import { niceDate } from '@/lib/dates';
import type { StoredBankStatement } from '@fwos/data';
import { lineNameGuess } from '@/lib/line-name';
import {
  addRule,
  answerLine,
  deleteRule,
  deleteStatement,
  rebuildStatements,
  removeCovered,
} from './statement-actions';

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
  addRule?: (f: FormData) => Promise<void>;
  deleteRule?: (f: FormData) => Promise<void>;
}

/** A holding a rule can send money to: an account, a deposit, a fund, a loan, a property. */
export interface RuleHolding {
  id: string;
  label: string;
  type: string;
}

const RULE_ACTION: Record<StatementRule['action'], string> = {
  own: 'Moved to or from',
  loan: 'Lent to, or paid back by',
  out: 'Spending or money out',
  outside: 'Money from outside',
  income: 'Earnings',
  rent: 'Rent',
};
const DIRECTION: Record<StatementRule['direction'], string> = {
  in: 'money in',
  out: 'money out',
  any: 'money in and out',
};

/** The holdings, grouped for a select: loans first (money lent), then property, accounts, deposits and funds. */
function HoldingOptions({ holdings }: { holdings: RuleHolding[] }) {
  const groups: [string, string[]][] = [
    ['Money lent (a “Loan to …”)', ['receivable']],
    ['Property', ['property']],
    ['Accounts', ['bank_account']],
    ['Deposits', ['fixed_deposit']],
    [
      'Funds and other',
      ['mutual_fund', 'stock', 'policy', 'ulip', 'nps', 'third_party_held', 'other'],
    ],
  ];
  return (
    <>
      <option value="">which one…</option>
      {groups.map(([label, types]) => {
        const hs = holdings.filter((h) => types.includes(h.type));
        return hs.length ? (
          <optgroup key={label} label={label}>
            {hs.map((h) => (
              <option key={h.id} value={h.id}>
                {h.label}
              </option>
            ))}
          </optgroup>
        ) : null;
      })}
    </>
  );
}

/**
 * Transactions > Bank statements: which days each account's statements cover, what the lines add up to each year, the lines no
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
    addRule,
    deleteRule,
  },
  sample = false,
  rules = [],
  holdings = [],
  ownNames = [],
}: {
  statements: StoredBankStatement[];
  lines: StmtLine[];
  classified: Classified[];
  interest: StatementInterestRow[];
  labels: Record<string, string>;
  covered: CoveredMove[];
  act?: StatementsAct;
  sample?: boolean;
  /** your rules for a person or words */
  rules?: StatementRule[];
  /** the holdings a line or a rule can send money to */
  holdings?: RuleHolding[];
  /** the household's names, left out of a line's name guess */
  ownNames?: string[];
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

  // where the money went, by tag, in the latest financial years: out and in kept apart, so spending is not netted against money in
  const tagFys = fys.slice(0, 3);
  const byTag = new Map<string, Record<string, { out: number; in: number; n: number }>>();
  let guessed = 0;
  for (const l of lines) {
    const c = cls.get(l.id);
    if (!c?.category) continue;
    if (c.reason.startsWith('Best guess')) guessed++;
    const fy = fyOf(l.date);
    if (!tagFys.includes(fy)) continue;
    const row = byTag.get(c.category) ?? {};
    const cell = row[fy] ?? { out: 0, in: 0, n: 0 };
    if (l.amount < 0) cell.out -= l.amount;
    else cell.in += l.amount;
    cell.n++;
    row[fy] = cell;
    byTag.set(c.category, row);
  }
  const tagRows = [...byTag.entries()].sort(
    (a, b) =>
      Math.max(...tagFys.map((f) => (b[1][f]?.out ?? 0) + (b[1][f]?.in ?? 0))) -
      Math.max(...tagFys.map((f) => (a[1][f]?.out ?? 0) + (a[1][f]?.in ?? 0))),
  );

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
          <Link href={sample ? '/demo/settings?tab=rules#trail' : '/settings?tab=rules#trail'}>
            Settings
          </Link>
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

      {tagRows.length > 0 && (
        <section className="card rc" aria-labelledby="rc-st" data-testid="rc-s-tags">
          <h2 id="rc-st">Where the money went, by tag</h2>
          <p className="muted small">
            Every line is tagged by itself: from the merchant and words, what it was matched with
            (your own account, a deposit, a fund, a loan), or the person it names.
            {guessed > 0
              ? ` ${guessed} line${guessed === 1 ? ' is' : 's are'} placed by best guess (no rule fitted); ${guessed === 1 ? 'it says' : 'each says'} so on the line, and nothing waits for you.`
              : ''}
          </p>
          <div className="rc-scroll">
            <table className="table small">
              <thead>
                <tr>
                  <th scope="col">Tag</th>
                  {tagFys.map((fy) => (
                    <th key={fy} scope="col" className="num">
                      {fy} out
                    </th>
                  ))}
                  {tagFys.map((fy) => (
                    <th key={`${fy}-in`} scope="col" className="num">
                      {fy} in
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tagRows.map(([tag, row]) => (
                  <tr key={tag}>
                    <th scope="row">
                      <Link href={`/transactions?tab=lines&tag=${tag}`}>{categoryLabel(tag)}</Link>
                    </th>
                    {tagFys.map((fy) => (
                      <td key={fy} className="num">
                        {row[fy]?.out ? formatInrCompact(row[fy]!.out) : '–'}
                      </td>
                    ))}
                    {tagFys.map((fy) => (
                      <td key={`${fy}-in`} className="num">
                        {row[fy]?.in ? formatInrCompact(row[fy]!.in) : '–'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
                      {c.category && (
                        <span className="chip tiny" data-testid="rc-tag">
                          {categoryLabel(c.category)}
                        </span>
                      )}
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
                      {holdings.length > 0 && (
                        <label className="small">
                          {into ? 'From' : 'To'} which holding (a loan, a property, an account)
                          <select name="holding" defaultValue="">
                            <HoldingOptions holdings={holdings} />
                          </select>
                        </label>
                      )}
                      <label className="small">
                        Tag (what it was {into ? 'from' : 'spent on'})
                        <select name="category" defaultValue={c.category ?? ''}>
                          <CategoryOptions side={into ? 'in' : 'out'} />
                        </select>
                      </label>
                      {act.addRule && (
                        <div className="rc-remember small">
                          <label className="rc-choice">
                            <input
                              type="checkbox"
                              name="remember"
                              defaultChecked={lineNameGuess(l.narration, ownNames) !== ''}
                            />
                            Remember for every line naming
                          </label>
                          <input
                            name="name"
                            defaultValue={lineNameGuess(l.narration, ownNames)}
                            aria-label="The name or words to remember"
                            placeholder="name or words on the line"
                          />
                          <span className="muted">
                            Past and future lines with this name are placed the same way.
                          </span>
                        </div>
                      )}
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

      {act.addRule && (
        <section className="card rc" aria-labelledby="rc-sr" data-testid="rc-rules">
          <h2 id="rc-sr">Rules</h2>
          <p className="muted small">
            What you have said about a person or words. Every statement line that names them, from
            the past and from the bank alerts to come, is placed by the rule without asking. A name
            matches the bank’s spellings (Shalender and SHELENDRA); several are joined with “ / ”.
          </p>
          {rules.length === 0 ? (
            <p className="small">No rules yet.</p>
          ) : (
            <ul className="rc-rules">
              {rules.map((r) => (
                <li key={r.id}>
                  <strong>{r.name}</strong>{' '}
                  <span className="muted small">
                    ({r.match === 'words' ? 'words' : 'name'}, {DIRECTION[r.direction]})
                  </span>{' '}
                  → {RULE_ACTION[r.action]}
                  {r.assetId ? ` ${labels[r.assetId] ?? 'a holding'}` : ''}
                  {r.interest ? ', with interest' : ''}
                  {r.category ? `, tagged ${categoryLabel(r.category)}` : ''}
                  {act.deleteRule && (
                    <form action={act.deleteRule} className="rc-inline">
                      <input type="hidden" name="rule" value={r.id} />
                      <button className="btn small">Remove</button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
          <details className="rc-addrule">
            <summary className="small">Add a rule</summary>
            <form action={act.addRule} className="rc-form">
              <label>
                Name or words on the lines
                <input name="name" required minLength={2} placeholder="Arjun / Arjun Kumar" />
              </label>
              <label>
                Match
                <select name="match" defaultValue="name">
                  <option value="name">a person’s name (any spelling)</option>
                  <option value="words">these exact words</option>
                </select>
              </label>
              <label>
                For
                <select name="direction" defaultValue="any">
                  <option value="any">money in and out</option>
                  <option value="out">money out</option>
                  <option value="in">money in</option>
                </select>
              </label>
              <label>
                It is
                <select name="answer" defaultValue="own">
                  <option value="own">
                    to or from one of our holdings (a loan, property, account)
                  </option>
                  <option value="out">spending or money out</option>
                  <option value="outside">money from outside</option>
                  <option value="income">earnings</option>
                  <option value="rent">rent</option>
                </select>
              </label>
              {holdings.length > 0 && (
                <label>
                  Holding
                  <select name="holding" defaultValue="">
                    <HoldingOptions holdings={holdings} />
                  </select>
                </label>
              )}
              <label>
                Tag
                <select name="category" defaultValue="">
                  <CategoryOptions side="any" />
                </select>
              </label>
              <label className="rc-choice">
                <input type="checkbox" name="interest" /> A loan that pays interest (small payments
                from them are earnings)
              </label>
              <button className="btn primary">Save the rule</button>
            </form>
          </details>
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
