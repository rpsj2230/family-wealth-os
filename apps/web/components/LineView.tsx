import Link from 'next/link';
import { formatInr, ORIGIN_LABEL, type Hop } from '@fwos/core';
import type { LineDetail, MoneyTrailData } from '@fwos/data';
import { AssetFacts, DetailHeader, type Fact } from '@/components/AssetFacts';
import { niceDate } from '@/lib/dates';
import { Makeup } from '@/app/(app)/trail/TrailView';
import '@/app/(app)/trail/trail.css';

const signed = (n: number) => `${n >= 0 ? '+' : '−'}${formatInr(Math.abs(n))}`;

/**
 * One bank statement line: what it is and why the rules say so, then its trail: what the money was made of (back to Singapore,
 * however many accounts it passed through), the line on the other side of a transfer, and, for money out, the money that came in
 * before it. Every step opens its own page, so the chain can be followed back.
 */
export function LineView({
  d,
  data,
  labels,
  names,
  lineHref,
  assetHref = (a) => `/asset/${a}`,
  trailHref = (a) => `/trail?h=${a}`,
  answerHref = '/reconcile?tab=statements',
}: {
  d: LineDetail;
  data: Pick<MoneyTrailData, 'holdings'>;
  labels: Record<string, string>;
  names: Record<string, string>;
  lineHref: (assetId: string, lineId: string) => string;
  assetHref?: (assetId: string) => string;
  trailHref?: (assetId: string) => string;
  answerHref?: string;
}) {
  const id = d.line.assetId;
  const account = labels[id] ?? 'This account';
  const holder = data.holdings.find((h) => h.id === id)?.ownerId;
  const into = d.line.amount >= 0;
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
  const step = (h: Hop) => {
    const top = [...h.parts].sort((a, b) => b.amount - a.amount)[0];
    return top
      ? `${ORIGIN_LABEL[top.kind]} ${Math.round((top.amount / Math.abs(h.amount)) * 100)}%`
      : '';
  };
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
      {d.line.toAnswer && (
        <section className="detailsection" aria-label="To answer">
          <p className="small">
            The rules could not tell what this was. Say what it was in{' '}
            <Link href={answerHref}>Explain movements → Bank statements</Link>; the trail follows
            your answer.
          </p>
        </section>
      )}

      <section className="detailsection" aria-labelledby="ln-trail" data-testid="line-trail">
        <h2 id="ln-trail">The trail</h2>
        {d.hop && d.hop.parts.length > 0 ? (
          <>
            <p className="muted small">
              {into
                ? 'Where the money this line brought came from, back to its start (Singapore, interest, money already there), and whose it was.'
                : 'What the money that left was made of: the account’s mix at that moment, back to where each part started.'}
            </p>
            <Makeup parts={d.hop.parts} labels={labels} names={names} />
          </>
        ) : (
          <p className="small">
            This line has no trail of its own (a charge, or money the statements do not follow).
          </p>
        )}
        {d.pair && (
          <p className="small ln-step" data-testid="line-pair">
            {into ? 'It came from ' : 'It went to '}
            <Link href={lineHref(d.pair.assetId, d.pair.id)}>
              {labels[d.pair.assetId] ?? 'another account'}, {niceDate(d.pair.date)},{' '}
              {signed(d.pair.amount)}
            </Link>
            {into ? ': open it to go one step further back.' : '.'}
          </p>
        )}
        {!d.pair && other && (
          <p className="small ln-step">
            {into ? 'It came from ' : 'It went to '}
            <Link href={assetHref(other)}>{labels[other]}</Link>
            {data.holdings.find((h) => h.id === other)?.statements
              ? '.'
              : ', which has no bank statement on file, so the trail stops there.'}
          </p>
        )}
        {d.before.length > 0 && (
          <>
            <h3 className="tr-h3">Money that came into the account before it</h3>
            <div className="tr-scroll">
              <table className="table small">
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col" className="num">
                      Amount
                    </th>
                    <th scope="col">From</th>
                    <th scope="col">Made of</th>
                  </tr>
                </thead>
                <tbody>
                  {d.before.map((h, i) => (
                    <tr key={h.lineId ?? i}>
                      <td>
                        {h.lineId && !h.lineId.startsWith('remit:') ? (
                          <Link href={lineHref(id, h.lineId)}>{niceDate(h.date)}</Link>
                        ) : (
                          niceDate(h.date)
                        )}
                      </td>
                      <td className="num">{signed(h.amount)}</td>
                      <td>
                        {h.from && labels[h.from] ? (
                          labels[h.from]
                        ) : (
                          <span className="muted">{h.narration.slice(0, 40) || '—'}</span>
                        )}
                      </td>
                      <td>{step(h)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        <p className="small ln-step">
          <Link href={trailHref(id)}>The whole trail of {account}</Link>
        </p>
      </section>
    </>
  );
}
