import Link from 'next/link';
import {
  type Clubbed,
  formatInr,
  formatInrCompact,
  formatPct,
  ORIGIN_LABEL,
  type OriginKind,
  type Part,
  type Trail,
} from '@fwos/core';
import { niceDate } from '@/lib/dates';
import './trail.css';

export interface TrailViewData {
  trails: Map<string, Trail>;
  holdings: {
    id: string;
    ownerId: string;
    kind: 'account' | 'deposit' | 'fund';
    statements: boolean;
  }[];
  remittances: { count: number; amount: number; proven: number; placed: number };
  ownershipFrom: string;
}

const CLUB_LABEL: Record<Clubbed['kind'], string> = {
  interest: 'Savings interest',
  deposit_interest: 'Deposit interest',
  fund_sale: 'Fund sales made from their money',
};

const signed = (n: number) => `${n >= 0 ? '+' : '−'}${formatInr(Math.abs(Math.round(n)))}`;
const fyOf = (date: string) => {
  const y = Number(date.slice(0, 4));
  const s = date.slice(5) >= '04-01' ? y : y - 1;
  return `${s}-${String((s + 1) % 100).padStart(2, '0')}`;
};

/** A holding's make-up by where the money came from, each with whose money it was. */
export function Makeup({
  parts,
  labels,
  names,
}: {
  parts: Part[];
  labels: Record<string, string>;
  names: Record<string, string>;
}) {
  const total = parts.reduce((s, p) => s + p.amount, 0);
  const byKind = new Map<OriginKind, number>();
  for (const p of parts) byKind.set(p.kind, (byKind.get(p.kind) ?? 0) + p.amount);
  const kinds = [...byKind].sort((a, b) => b[1] - a[1]);
  return (
    <>
      <div className="tr-bar" aria-hidden="true">
        {kinds.map(([k, v]) => (
          <span key={k} className={`tr-cut tr-${k}`} style={{ width: `${(v / total) * 100}%` }} />
        ))}
      </div>
      <ul className="tr-parts plain">
        {parts.slice(0, 12).map((p, i) => (
          <li key={i}>
            <span className={`tr-swatch tr-${p.kind}`} aria-hidden="true" />
            <span className="tr-what">
              {ORIGIN_LABEL[p.kind]}
              {p.assetId && labels[p.assetId] ? ` (${labels[p.assetId]})` : ''}
              <span className="muted small"> · {names[p.person] ?? 'someone'}’s money</span>
            </span>
            <strong>{formatInrCompact(p.amount)}</strong>
            <span className="muted small">{formatPct(total > 0 ? p.amount / total : 0, 0)}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * The money trail: what each account and deposit is made of by where the money came from (back to Singapore, however many hops), the
 * movements into it, and the money that moved from one person's account to another's.
 */
export function TrailView({
  data,
  selected,
  labels,
  names,
  base = '/trail',
  sample = false,
}: {
  data: TrailViewData;
  selected: string | null;
  labels: Record<string, string>;
  names: Record<string, string>;
  base?: string;
  sample?: boolean;
}) {
  const { trails, holdings, remittances } = data;
  const t = selected ? trails.get(selected) : undefined;
  // every crossing once: on the holding it reached
  const crossings = [...trails.values()].flatMap((x) => x.crossings);
  const byYear = new Map<string, Map<string, number>>();
  for (const c of crossings) {
    const fy = fyOf(c.date);
    const dir = `${names[c.fromPerson] ?? 'Someone'} → ${names[c.toPerson] ?? 'someone'}`;
    const m = byYear.get(fy) ?? new Map<string, number>();
    m.set(dir, (m.get(dir) ?? 0) + c.amount);
    byYear.set(fy, m);
  }
  const dirs = [...new Set([...byYear.values()].flatMap((m) => [...m.keys()]))].sort();
  const since = data.ownershipFrom
    ? crossings
        .filter((c) => c.date >= data.ownershipFrom)
        .sort((a, b) => b.date.localeCompare(a.date))
    : [];
  // income earned on the other person's money, by year and by whose income it counts as
  const clubbed = [...trails.values()].flatMap((x) => x.clubbed);
  const clubRows = new Map<string, Record<Clubbed['kind'], number>>();
  for (const c of clubbed) {
    const k = `${fyOf(c.date)}|${c.person}|${c.holder}`;
    const r = clubRows.get(k) ?? { interest: 0, deposit_interest: 0, fund_sale: 0 };
    r[c.kind] += c.amount;
    clubRows.set(k, r);
  }
  const sorted = [...holdings].sort((a, b) =>
    (labels[a.id] ?? '').localeCompare(labels[b.id] ?? ''),
  );

  return (
    <>
      <section className="card" aria-labelledby="tr-s">
        <h2 id="tr-s">Where the money came from</h2>
        <p className="muted small">
          Every bank statement line is followed in date order. Money leaving an account takes the
          account’s mix with it, so a deposit funded through several accounts still shows the money
          from Singapore at the start of the chain. Accounts with statements on file are traced in
          full; others only through the transfers from Singapore.
        </p>
        <p className="small" data-testid="tr-remit">
          Transfers from Singapore on file: <strong>{remittances.count}</strong>,{' '}
          {formatInrCompact(remittances.amount)} · proven by a statement {remittances.proven} ·
          placed in an account {remittances.placed}.
        </p>
      </section>

      <section className="card" aria-labelledby="tr-h">
        <h2 id="tr-h">Choose a holding</h2>
        <ul className="tr-holdings plain" data-testid="tr-holdings">
          {sorted.map((h) => (
            <li key={h.id}>
              <Link
                href={`${base}?h=${h.id}`}
                aria-current={h.id === selected ? 'page' : undefined}
                className={h.id === selected ? 'on' : ''}
              >
                {labels[h.id] ?? 'A holding'}
              </Link>
              <span className="muted small">
                {' '}
                ·{' '}
                {h.kind === 'deposit'
                  ? 'deposit'
                  : h.kind === 'fund'
                    ? 'fund'
                    : h.statements
                      ? 'statements on file'
                      : 'transfers only'}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {t && (
        <section className="card" aria-labelledby="tr-one" data-testid="tr-one">
          <h2 id="tr-one">{labels[t.assetId] ?? 'This holding'}</h2>
          <p className="muted small">
            {
              {
                deposit: 'What the money that booked it was made of.',
                fund: 'What the money that bought it is made of, less what its sales took back.',
                account: 'What its balance is made of today.',
              }[holdings.find((h) => h.id === t.assetId)?.kind ?? 'account']
            }
          </p>
          <Makeup parts={t.parts} labels={labels} names={names} />
          <h3 className="tr-h3">Money in, newest first</h3>
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
                {t.hops
                  .filter((h) => h.amount > 0)
                  .slice(0, 60)
                  .map((h, i) => {
                    const top = [...h.parts].sort((a, b) => b.amount - a.amount)[0];
                    return (
                      <tr key={i}>
                        <td>
                          {!sample && h.lineId && !h.lineId.startsWith('remit:') ? (
                            <Link href={`/asset/${t.assetId}/line/${h.lineId}`}>
                              {niceDate(h.date)}
                            </Link>
                          ) : (
                            niceDate(h.date)
                          )}
                        </td>
                        <td className="num">{signed(h.amount)}</td>
                        <td>
                          {h.from && labels[h.from] ? (
                            sample ? (
                              labels[h.from]
                            ) : (
                              <Link href={`${base}?h=${h.from}`}>{labels[h.from]}</Link>
                            )
                          ) : (
                            <span className="muted">{h.narration.slice(0, 40) || '—'}</span>
                          )}
                        </td>
                        <td className="small">
                          {top
                            ? `${ORIGIN_LABEL[top.kind]} ${formatPct(top.amount / h.amount, 0)}`
                            : '—'}
                          {h.parts.length > 1 ? ' and more' : ''}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="card" aria-labelledby="tr-x">
        <h2 id="tr-x">Money moved between you</h2>
        <p className="muted small">
          Money that left one person’s account and reached another’s, by financial year. What each
          of you held before{' '}
          {data.ownershipFrom ? niceDate(data.ownershipFrom) : 'the day set in Settings'} counts as
          theirs; from then on, money moved between you is listed below for clubbing.
        </p>
        {byYear.size === 0 ? (
          <p className="small">None found in the statements on file.</p>
        ) : (
          <div className="tr-scroll">
            <table className="table small" data-testid="tr-years">
              <thead>
                <tr>
                  <th scope="col">Year</th>
                  {dirs.map((d) => (
                    <th key={d} scope="col" className="num">
                      {d}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...byYear.keys()]
                  .sort()
                  .reverse()
                  .map((fy) => (
                    <tr key={fy}>
                      <th scope="row">{fy}</th>
                      {dirs.map((d) => (
                        <td key={d} className="num">
                          {byYear.get(fy)!.get(d) ? formatInrCompact(byYear.get(fy)!.get(d)!) : '–'}
                        </td>
                      ))}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
        <h3 className="tr-h3">
          Since {data.ownershipFrom ? niceDate(data.ownershipFrom) : 'tracking starts'}: for
          clubbing
        </h3>
        {!data.ownershipFrom ? (
          <p className="small">
            Set the day to start counting in{' '}
            <Link href={sample ? '/demo/settings#estimates' : '/settings#estimates'}>Settings</Link>
            .
          </p>
        ) : since.length === 0 ? (
          <p className="small" data-testid="tr-since">
            Nothing has moved between you since then.
          </p>
        ) : (
          <ul className="plain small" data-testid="tr-since">
            {since.slice(0, 40).map((c, i) => (
              <li key={i}>
                {niceDate(c.date)} · {names[c.fromPerson]} → {names[c.toPerson]} ·{' '}
                {formatInr(Math.round(c.amount))} into {labels[c.assetId] ?? 'a holding'}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card" aria-labelledby="tr-c">
        <h2 id="tr-c">Income to count in the giver’s hands (clubbing)</h2>
        <p className="muted small">
          Interest earned, and fund sales made, on money one of you gave the other since{' '}
          {data.ownershipFrom ? niceDate(data.ownershipFrom) : 'the day set in Settings'}. The
          income is in the receiver’s name but counts in the giver’s income for tax. For a fund sale
          the figure is the share of the sale made from the giver’s money; the gain on that share is
          theirs.
        </p>
        {!data.ownershipFrom ? (
          <p className="small">
            Nothing is counted until the day is set in{' '}
            <Link href={sample ? '/demo/settings#estimates' : '/settings#estimates'}>Settings</Link>
            .
          </p>
        ) : clubRows.size === 0 ? (
          <p className="small" data-testid="tr-club">
            No income has been earned on the other person’s money since then.
          </p>
        ) : (
          <div className="tr-scroll">
            <table className="table small" data-testid="tr-club">
              <thead>
                <tr>
                  <th scope="col">Year</th>
                  <th scope="col">Counts as whose income</th>
                  {(Object.keys(CLUB_LABEL) as Clubbed['kind'][]).map((k) => (
                    <th key={k} scope="col" className="num">
                      {CLUB_LABEL[k]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...clubRows]
                  .sort((a, b) => b[0].localeCompare(a[0]))
                  .map(([k, r]) => {
                    const [fy, person, holder] = k.split('|') as [string, string, string];
                    return (
                      <tr key={k}>
                        <th scope="row">{fy}</th>
                        <td>
                          {names[person] ?? 'Someone'}{' '}
                          <span className="muted">(in {names[holder] ?? 'someone'}’s name)</span>
                        </td>
                        {(Object.keys(CLUB_LABEL) as Clubbed['kind'][]).map((c) => (
                          <td key={c} className="num">
                            {r[c] > 0.5 ? formatInr(Math.round(r[c])) : '–'}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
