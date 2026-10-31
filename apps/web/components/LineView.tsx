import Link from 'next/link';
import { formatInr } from '@fwos/core';
import type { LineDetail, MoneyTrailData } from '@fwos/data';
import { AssetFacts, DetailHeader, type Fact } from '@/components/AssetFacts';
import { LineChain, type ChainContext } from '@/components/MoneyChainView';
import { CategoryOptions } from '@/components/CategoryOptions';
import { tagLine } from '@/app/(app)/reconcile/statement-actions';
import { niceDate } from '@/lib/dates';
import { lineNameGuess } from '@/lib/line-name';
import '@/components/account-check.css';
import '@/app/(app)/trail/trail.css';

const signed = (n: number) => `${n >= 0 ? '+' : '−'}${formatInr(Math.abs(n))}`;

/**
 * One bank statement line: what it is and why the rules say so, then its trail, step by step: the line on the other side of a
 * transfer, where its money started (back to Singapore, however many accounts it passed through) with every step on the way, and
 * where it went from here and where it is now. Every step opens its own page, so the chain can be followed as far as it goes.
 */
export function LineView({
  d,
  data,
  chain,
  labels,
  names,
  lineHref,
  assetHref = (a) => `/asset/${a}`,
  trailHref = (a) => `/trail?h=${a}`,
  diagramHref,
  answerHref = '/transactions?tab=statements',
}: {
  d: LineDetail;
  data: Pick<MoneyTrailData, 'holdings'>;
  chain: ChainContext;
  labels: Record<string, string>;
  names: Record<string, string>;
  lineHref: (assetId: string, lineId: string) => string;
  assetHref?: (assetId: string) => string;
  trailHref?: (assetId: string) => string;
  /** the line's journey as a flow diagram */
  diagramHref?: (lineId: string) => string;
  answerHref?: string;
}) {
  const id = d.line.assetId;
  const account = labels[id] ?? 'This account';
  const holder = data.holdings.find((h) => h.id === id)?.ownerId;
  const into = d.line.amount >= 0;
  const guess = lineNameGuess(d.line.narration, Object.values(names));
  const other = d.counterpart && labels[d.counterpart] ? d.counterpart : null;
  const facts: Fact[] = [
    { label: 'Date', value: niceDate(d.line.date) },
    { label: 'Account', value: account, href: assetHref(id) },
    { label: into ? 'Money in' : 'Money out', value: formatInr(Math.abs(d.line.amount)) },
    {
      label: 'Balance after it',
      value: d.line.balance === null ? 'Not on the statement' : formatInr(d.line.balance),
    },
    { label: 'What the bank wrote', value: d.line.narration || '—' },
    { label: 'What it is', value: d.line.kind, note: d.reason || undefined },
    ...(d.line.tag
      ? [
          {
            label: 'Tag',
            value: `${d.line.tag}${d.line.bestGuess ? ' (best guess)' : ''}`,
            note: 'Given by itself from the merchant, the words, what it was matched with, or a rule',
          },
        ]
      : []),
    ...(other
      ? [{ label: into ? 'From' : 'To', value: labels[other]!, href: assetHref(other) }]
      : []),
    ...(d.person && d.person !== holder
      ? [{ label: 'Names', value: `${names[d.person] ?? 'One of you'} (the other side)` }]
      : []),
    ...(d.remittance
      ? [
          {
            label: 'Transfer from Singapore',
            value: `${formatInr(d.remittance.amount)} received ${niceDate(d.remittance.receivedOn)}`,
            note: 'The transfer on file (Wise) that this credit is',
          },
        ]
      : []),
    ...(d.statement
      ? [
          {
            label: 'From the statement',
            value: `${niceDate(d.statement.from)} to ${niceDate(d.statement.to)}`,
            note: d.statement.label ?? undefined,
          },
        ]
      : []),
  ];
  // the line on the other side of a transfer, as the step-by-step trail links them
  const node = chain.chain.nodes.get(d.line.id);
  const pairLink = node
    ? (into ? node.from : node.to).find((l) => !l.via && l.basis !== 'same_account')
    : undefined;
  const pair = pairLink ? chain.chain.nodes.get(pairLink.node) : undefined;
  const pairGuessed = pairLink?.basis === 'guess';
  return (
    <>
      <DetailHeader
        crumbs={[
          { label: 'Accounts', href: '/accounts' },
          { label: account, href: assetHref(id) },
          { label: niceDate(d.line.date) },
        ]}
        title={`${into ? 'Money in' : 'Money out'} on ${niceDate(d.line.date)}`}
        subtitle={`A bank statement line of ${account}`}
        headline={signed(d.line.amount)}
        actions={
          <Link className="btn compact" href={assetHref(id)}>
            Back to the account
          </Link>
        }
      />
      <AssetFacts facts={facts} />
      <details className="detailsection" data-testid="line-tag">
        <summary className="small">Change the tag (only if it is wrong)</summary>
        <form action={tagLine} className="acheck-form">
          <input type="hidden" name="line" value={d.line.id} />
          <input type="hidden" name="return" value={lineHref(id, d.line.id)} />
          <select name="category" defaultValue={d.line.category ?? ''} aria-label="Tag">
            <CategoryOptions side={into ? 'in' : 'out'} />
          </select>
          {guess && (
            <label className="rc-choice small">
              <input type="checkbox" name="remember" />
              Same for every line naming <strong>{guess}</strong>
              <input type="hidden" name="name" value={guess} />
            </label>
          )}
          <button className="btn small primary">Save the tag</button>
        </form>
        <p className="muted small">
          A tag says what the money was; it never turns a payment into a loan. Choosing “Between
          your own accounts”, “Deposit”, “Money lent” or “Funds” counts the line as money that stays
          with you.
        </p>
      </details>
      {d.line.toAnswer && (
        <section className="detailsection" aria-label="To answer">
          <p className="small">
            The rules could not tell what this was. Say what it was in{' '}
            <Link href={answerHref}>Transactions → Bank statements</Link>; the trail follows your
            answer.
          </p>
        </section>
      )}

      <section className="detailsection" aria-labelledby="ln-trail" data-testid="line-trail">
        <h2 id="ln-trail">The trail</h2>
        {pair && (
          <p className="small ln-step" data-testid="line-pair">
            {into ? 'It came from ' : 'It went to '}
            <Link href={lineHref(pair.assetId, pair.id)}>
              {labels[pair.assetId] ?? 'another account'}, {niceDate(pair.date)},{' '}
              {signed(pair.amount)}
            </Link>
            {pairGuessed ? ' (matched by amount and date)' : ''}
            {into ? ': open it to go one step further back.' : '.'}
          </p>
        )}
        {!pair && other && (
          <p className="small ln-step">
            {into ? 'It came from ' : 'It went to '}
            <Link href={assetHref(other)}>{labels[other]}</Link>
            {data.holdings.find((h) => h.id === other)?.statements
              ? '.'
              : ', which has no bank statement on file, so the trail stops there.'}
          </p>
        )}
        <LineChain c={chain} lineId={d.line.id} />
        <p className="small ln-step">
          <Link href={trailHref(id)}>The whole trail of {account}</Link>
          {diagramHref && (
            <>
              {' · '}
              <Link href={diagramHref(d.line.id)}>See it as a diagram</Link>
            </>
          )}
        </p>
      </section>
    </>
  );
}
