import Link from 'next/link';
import {
  formatInr,
  formatInrCompact,
  ratePct,
  type Explain,
  type OptionsResult,
  type PersonStyle,
  type PlacementOption,
} from '@fwos/core';
import { BankBadge } from '@/components/BankBadge';
import { WhyHead } from '@/components/Why';
import { PersonBadge } from '@/components/Person';
import { slugify } from '@/lib/slug';
import './options.css';

const share = (r: number) => `${Math.round(r * 100)}%`;
const whole = (n: number) => formatInr(Math.round(n));

/** The amount, and nothing else to fill in. Whose money and NRE/NRO are two lines of links under it, not dropdowns. */
export function AmountForm({
  action,
  amount,
  kind,
  who,
  people,
  styles,
  base,
}: {
  action: string;
  amount: string;
  kind: 'NRE' | 'NRO';
  who: string;
  people: { id: string; name: string }[];
  styles: Record<string, PersonStyle>;
  base: string;
}) {
  const href = (over: Record<string, string>) => {
    const q = new URLSearchParams({ ...(amount ? { amount } : {}), kind, who, ...over });
    return `${base}?${q.toString()}`;
  };
  return (
    <form method="get" action={action} className="nmo-form">
      <label className="nmo-amount">
        <span>How much do you have to place? (₹)</span>
        <input
          name="amount"
          inputMode="numeric"
          defaultValue={amount}
          placeholder="25 lakh, or 2500000"
          required
          autoComplete="off"
        />
      </label>
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="who" value={who} />
      <button className="btn primary">Show the best ways</button>
      <p className="nmo-assume muted small">
        Planned as <b>{kind}</b> money of{' '}
        <b>
          <PersonBadge p={styles[who]} name size={16} />
        </b>
        , because each person has their own insurance room at each bank.{' '}
        {people.length > 1 && (
          <>
            Whose:{' '}
            {people.map((p, i) => (
              <span key={p.id}>
                {i > 0 && ' · '}
                {p.id === who ? <b>{p.name}</b> : <Link href={href({ who: p.id })}>{p.name}</Link>}
              </span>
            ))}
            .{' '}
          </>
        )}
        Account: {kind === 'NRE' ? <b>NRE</b> : <Link href={href({ kind: 'NRE' })}>NRE</Link>} ·{' '}
        {kind === 'NRO' ? <b>NRO</b> : <Link href={href({ kind: 'NRO' })}>NRO</Link>}.
      </p>
    </form>
  );
}

function Check({ ok, children }: { ok: boolean; children: string }) {
  return (
    <li className={ok ? 'ok' : 'bad'}>
      <span aria-hidden="true">{ok ? '✓' : '!'}</span>
      <span className="sr-only">{ok ? 'Met: ' : 'Not met: '}</span>
      {children}
    </li>
  );
}

function OptionCard({
  o,
  banksBase,
  open,
  amount,
}: {
  o: PlacementOption;
  banksBase: string;
  open: boolean;
  amount: number;
}) {
  return (
    <details className={`nmo-card ${o.recommended ? 'rec' : ''}`} open={open}>
      <summary>
        <span className="nmo-title">
          <b>{o.title}</b>
          {o.recommended && <span className="nmo-badge">Recommended</span>}
          <span className="nmo-tag muted small">{o.tagline}</span>
        </span>
        <span className="nmo-nums">
          <span>
            <b>{whole(o.totalAnnual)}</b>
            <small> a year</small>
          </span>
          <span className="muted small">
            {o.banks} bank{o.banks === 1 ? '' : 's'} · {share(o.within12m / Math.max(1, o.placed))}{' '}
            free in a year
          </span>
        </span>
      </summary>
      <div className="nmo-body">
        <dl className="nmo-facts">
          <div>
            <dt>Interest a year, after tax</dt>
            <dd>{whole(o.totalAnnual)}</dd>
          </div>
          <div>
            <dt>More than plain savings</dt>
            <dd className="gain">+{whole(o.uplift)}</dd>
          </div>
          <div>
            <dt>Average rate</dt>
            <dd>{ratePct(o.blendedNet)}</dd>
          </div>
          <div>
            <dt>Largest bank share</dt>
            <dd>{share(o.topShare)}</dd>
          </div>
          <div>
            <dt>Free any time</dt>
            <dd>{formatInrCompact(o.liquidNow)}</dd>
          </div>
          <div>
            <dt>Longest lock</dt>
            <dd>{o.longestTerm ? `${o.longestTerm} months` : 'none'}</dd>
          </div>
        </dl>

        <div role="list" className="nmo-lines">
          {o.lines.map((l, i) => (
            <div
              key={`${l.bank}${l.product}${l.termMonths}${i}`}
              className="nmo-line"
              role="listitem"
            >
              <BankBadge name={l.bank} size={30} />
              <div className="nmo-what">
                <b>
                  <Link href={`${banksBase}/${slugify(l.bank)}`}>{l.bank}</Link>
                </b>
                <div className="muted small">
                  {l.kind}{' '}
                  {l.product === 'fd'
                    ? `fixed deposit, ${l.termMonths} months`
                    : 'savings, withdraw any time'}
                </div>
              </div>
              <div className="nmo-rate">
                <b>{ratePct(l.rate)}</b>
                {l.kind === 'NRO' && <div className="muted small">{ratePct(l.net)} after tax</div>}
              </div>
              <div className="nmo-amt">
                <b>{whole(l.amount)}</b>
                <div className="muted small">{share(l.amount / Math.max(1, amount))}</div>
              </div>
              <div className="nmo-int">
                <b>{whole(l.annual)}</b>
                <div className="muted small">a year</div>
              </div>
              <div className="nmo-room muted small">room left {formatInrCompact(l.roomLeft)}</div>
            </div>
          ))}
        </div>

        <ul className="nmo-checks">
          <Check ok={o.checks.insured}>Inside the deposit-insurance limit at every bank</Check>
          <Check ok={o.checks.spread}>Spread over banks</Check>
          <Check ok={o.checks.liquid}>Part free to withdraw any time</Check>
          <Check ok={o.checks.allPlaced}>All of the amount placed</Check>
        </ul>
        <ul className="nmo-why small">
          {o.why.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
        {o.cautions.map((c) => (
          <p key={c} className="notice warn small">
            {c}
          </p>
        ))}
      </div>
    </details>
  );
}

/** The recommendation with its reasons, then the five options, the recommended one open. */
export function OptionsView({
  result,
  amount,
  banksBase,
  ratesHref,
  why,
}: {
  /** the "?" that says how the figures of the options are worked out */
  why: Explain;
  result: OptionsResult;
  amount: number;
  banksBase: string;
  ratesHref: string;
}) {
  const pick = result.options.find((o) => o.recommended)!;
  return (
    <>
      <section className="card nmo-pick" aria-labelledby="nmo-pick-h">
        <p className="nmo-eyebrow">Recommended for {whole(amount)}</p>
        <WhyHead why={why}>
          <h2 id="nmo-pick-h">{result.headline}</h2>
        </WhyHead>
        <ul className="nmo-reasons">
          {result.reasoning.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        {result.gaps.map((g) => (
          <p key={g} className="notice warn small">
            {g} <Link href={ratesHref}>See the rates</Link>
          </p>
        ))}
      </section>
      <section aria-labelledby="nmo-all-h">
        <h2 id="nmo-all-h" className="nmo-all">
          Five ways to place it
        </h2>
        <div className="nmo-list">
          {[pick, ...result.options.filter((o) => !o.recommended)].map((o) => (
            <OptionCard
              key={o.key}
              o={o}
              banksBase={banksBase}
              open={o.recommended}
              amount={amount}
            />
          ))}
        </div>
      </section>
    </>
  );
}
