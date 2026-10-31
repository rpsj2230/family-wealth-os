import Link from 'next/link';
import { categoryLabel, formatInr } from '@fwos/core';
import type { AccountCheck } from '@fwos/data';
import { BankStatementForm } from '@/app/(app)/import/BankStatementForm';
import { answerLine } from '@/app/(app)/reconcile/statement-actions';
import { niceDate } from '@/lib/dates';
import { lineNameGuess } from '@/lib/line-name';
import { CategoryOptions } from './CategoryOptions';
import './account-check.css';

const signed = (n: number) => `${n >= 0 ? '+' : '−'}${formatInr(Math.abs(Math.round(n)))}`;

/**
 * One bank account's check, where its balance is updated (Monthly update) and on its own page: what its bank lines reach, the lines
 * that still need an answer (answered and tagged right here, and remembered for every line naming the same person if wished), and
 * rows pasted from net banking for a month the bank's e-mails missed. An answer brings you back to the page it was given on.
 */
export function AccountCheckPanel({
  account,
  check,
  returnTo,
  ownNames = [],
  shown = 10,
}: {
  account: { id: string; label: string; last4: string | null };
  check: AccountCheck | undefined;
  /** the page to come back to after an answer */
  returnTo: string;
  ownNames?: string[];
  /** how many lines to answer are listed here (the rest are on Explain movements) */
  shown?: number;
}) {
  const ask = check?.ask ?? [];
  return (
    <div className="acheck" data-testid="account-check">
      <p className="small">
        {check?.reach !== null && check?.reach !== undefined && check.on ? (
          <>
            The bank lines on file reach <strong>{formatInr(Math.round(check.reach))}</strong> on{' '}
            {niceDate(check.on)}.{' '}
          </>
        ) : (
          <>No bank lines on file for this account yet. </>
        )}
        {ask.length === 0
          ? 'No line needs an answer.'
          : `${ask.length} line${ask.length === 1 ? '' : 's'} need${ask.length === 1 ? 's' : ''} an answer:`}
      </p>
      {ask.length > 0 && (
        <ul className="acheck-list">
          {ask.slice(0, shown).map((l) => {
            const into = l.amount > 0;
            const guess = lineNameGuess(l.narration, ownNames);
            return (
              <li key={l.id} className="acheck-item">
                <div className="acheck-what">
                  <strong>{signed(l.amount)}</strong> · {niceDate(l.date)}
                  <div className="small acheck-narr">{l.narration || 'No narration'}</div>
                  {l.category && (
                    <span className="chip tiny">Looks like {categoryLabel(l.category)}</span>
                  )}
                </div>
                <form action={answerLine} className="acheck-form">
                  <input type="hidden" name="line" value={l.id} />
                  <input type="hidden" name="return" value={returnTo} />
                  <select name="answer" defaultValue={into ? 'outside' : 'out'} aria-label="It was">
                    {into ? (
                      <>
                        <option value="outside">Money from outside</option>
                        <option value="own">From another of our accounts</option>
                        <option value="income">Earnings</option>
                        <option value="rent">Rent</option>
                      </>
                    ) : (
                      <>
                        <option value="out">Spending or money out</option>
                        <option value="own">To another of our accounts</option>
                      </>
                    )}
                  </select>
                  <select name="category" defaultValue={l.category ?? ''} aria-label="Tag">
                    <CategoryOptions side={into ? 'in' : 'out'} />
                  </select>
                  {guess && (
                    <label className="rc-choice small">
                      <input type="checkbox" name="remember" />
                      Same for every line naming <strong>{guess}</strong>
                      <input type="hidden" name="name" value={guess} />
                    </label>
                  )}
                  <button className="btn small primary">Save</button>
                </form>
              </li>
            );
          })}
        </ul>
      )}
      {ask.length > shown && (
        <p className="muted small">
          {ask.length - shown} more on{' '}
          <Link href="/transactions?tab=statements">Transactions → Bank statements</Link>.
        </p>
      )}
      <details className="acheck-paste">
        <summary className="small">Paste rows from net banking for this account</summary>
        <BankStatementForm accounts={[account]} file={null} defaultAsset={account.id} />
      </details>
    </div>
  );
}
