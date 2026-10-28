import Link from 'next/link';
import { TypeLegend } from '@/app/(app)/accounts/TypeLegend';
import type { ReactNode } from 'react';
import {
  formatInr,
  formatInrCompact,
  formatPct,
  type BankOverview as Overview,
  type Explain,
  type ExplainSet,
  type PersonStyle,
} from '@fwos/core';
import './bankoverview.css';
import { Est } from '@/components/Est';
import { ForeignCashLines } from '@/components/ForeignCash';
import { PersonBadge } from '@/components/Person';
import { Why, WhyHead } from '@/components/Why';
import { niceDate } from '@/lib/dates';

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export const whole = (n: number) => formatInr(Math.round(n));

/** A coloured, signed figure: an arrow and a word as well as the colour, so a loss never reads as a gain by colour alone. */
export function Delta({
  label,
  amount,
  pct,
  note,
  extra,
  estimate = false,
  why,
}: {
  label: string;
  amount: number;
  pct: number | null;
  note: string;
  /** a second, quieter line: what the figure rests on */
  extra?: string | undefined;
  estimate?: boolean;
  /** the "?" that says how the figure was worked out */
  why?: Explain | undefined;
}) {
  const rounded = Math.round(amount);
  const dir = rounded > 0 ? 'up' : rounded < 0 ? 'down' : 'flat';
  return (
    <div className={`bv-delta ${dir}`}>
      <div className="bv-delta-label">
        {label}
        {estimate && <Est />}
        {why && <Why explain={why} />}
      </div>
      <div className="bv-delta-value">
        <span aria-hidden="true" className="bv-arrow">
          {dir === 'up' ? '▲' : dir === 'down' ? '▼' : '▬'}
        </span>
        <span className="sr-only">
          {dir === 'up' ? 'Up ' : dir === 'down' ? 'Down ' : 'No change '}
        </span>
        <strong>{formatInrCompact(Math.abs(amount))}</strong>
        {pct !== null && <span className="bv-delta-pct">{formatPct(Math.abs(pct), 2)}</span>}
      </div>
      <div className="bv-delta-note">{note}</div>
      {extra && <div className="bv-delta-note bv-delta-extra">{extra}</div>}
    </div>
  );
}

export function Stat({
  label,
  value,
  sub,
  tone,
  href,
  why,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'warn' | undefined;
  href?: string;
  /** the "?" that says how the figure was worked out */
  why?: Explain | undefined;
}) {
  return (
    <div className={`bv-stat ${href ? 'clickable' : ''}`}>
      <dt>
        {href ? (
          <Link href={href} className="bv-stat-link">
            {label}
          </Link>
        ) : (
          label
        )}
        {why && <Why explain={why} />}
      </dt>
      <dd className={`bv-stat-value ${tone ?? ''}`}>{value}</dd>
      {sub && <dd className="bv-stat-sub">{sub}</dd>}
    </div>
  );
}

/** A bar cut into shares, with a text label on every cut (the pattern and the legend say it too, never colour alone). */
export function SplitBar({
  caption,
  parts,
}: {
  caption: string;
  parts: { key: string; label: string; share: number; className: string; style?: object }[];
}) {
  return (
    <div
      className="bv-seg"
      role="img"
      aria-label={`${caption}: ${parts.map((p) => `${p.label} ${formatPct(p.share, 0)}`).join(', ')}`}
    >
      {parts
        .filter((p) => p.share > 0)
        .map((p) => (
          <span
            key={p.key}
            className={`bv-cut ${p.className}`}
            style={{ flexGrow: p.share, ...p.style }}
            title={`${p.label}: ${formatPct(p.share, 1)}`}
          />
        ))}
    </div>
  );
}

/**
 * The overview of the money in banks: today's value, what was put in, what it pays at maturity, what it has earned and earned today,
 * where it sits, and the few figures that say what to do next. Every figure comes from bankOverview(); this only draws it.
 */
export function BankOverviewPanel({
  o,
  styles,
  month,
  scope = null,
  sample = false,
  ex,
}: {
  /** the "?" explainers of the figures below */
  ex: ExplainSet<'accounts'>;
  o: Overview;
  styles: Record<string, PersonStyle>;
  month: string;
  /** the person chosen in the filter, if any */
  scope?: string | null;
  sample?: boolean;
}) {
  const to = (path: string) => (sample ? `/demo${path}` : path);
  const empty = o.accounts + o.deposits === 0;
  const w = Object.fromEntries(o.where.map((x) => [x.key, x]));
  const pctDone = o.interest.journey === null ? null : o.interest.journey;
  // money held by others is shown only when there is some
  const legend = o.where.filter((x) => x.key !== 'others' || x.amount !== 0);
  const bankWord = o.banks === 1 ? 'bank' : 'banks';
  const people = o.people.map((p) => ({ ...p, style: styles[p.ownerId] }));
  const typeNames = Object.fromEntries(Object.entries(styles).map(([id, st]) => [id, st.name]));

  return (
    <section className="card bv" aria-label="Money in banks">
      <div className="bv-top">
        <div className="bv-hero">
          <WhyHead why={ex['accounts.total']}>
            <h2 className="bv-eyebrow">In banks today{scope ? ` · ${scope}` : ''}</h2>
          </WhyHead>
          <div className="bv-big" data-testid="bv-current">
            {formatInrCompact(o.current)}
          </div>
          <div className="bv-exact">{whole(o.current)}</div>
          <p className="bv-count">
            {empty
              ? 'Nothing is recorded yet.'
              : `${plural(o.accounts, 'account')} and ${plural(o.deposits, 'deposit')}${o.banks > 0 ? ` in ${o.banks} ${bankWord}` : ''}`}
          </p>
          <p className="bv-view small muted" data-testid="bv-view-current">
            <strong>Current holdings:</strong> what today’s deposits and balances cost and are
            worth. Lifetime profit, with reinvested interest counted once, is on{' '}
            <Link href={sample ? '/demo/dashboard' : '/'}>Home</Link>.
          </p>
          <div className="bv-deltas">
            <Delta
              label="Gain on current holdings"
              amount={o.profit}
              pct={o.profitPct}
              note="on what the deposits and balances cost"
              why={ex['accounts.profit']}
            />
            <Delta
              label="Earned today"
              amount={o.today.change}
              pct={o.today.changePct}
              note="since yesterday, at each rate; % of yesterday’s value"
              estimate
              why={ex['accounts.today']}
            />
          </div>
        </div>

        <div className="bv-journey">
          <WhyHead why={ex['accounts.journey']}>
            <h3 className="bv-h">From invested to maturity</h3>
          </WhyHead>
          {pctDone === null ? (
            <p className="muted small">
              No deposit has interest left to earn, so there is no journey to show.
            </p>
          ) : (
            <>
              <div
                className="bv-track"
                role="img"
                aria-label={`${formatPct(pctDone, 0)} of the interest has been earned: ${whole(o.interest.earned)} of ${whole(o.interest.total)}`}
              >
                <span className="bv-fill" style={{ width: `${pctDone * 100}%` }} />
                <span className="bv-dot" style={{ left: `${pctDone * 100}%` }} />
              </div>
              <dl className="bv-ends">
                <div>
                  <dt>Cost of current holdings</dt>
                  <dd>{formatInrCompact(o.invested)}</dd>
                </div>
                <div className="mid">
                  <dt>Current value</dt>
                  <dd>{formatInrCompact(o.current)}</dd>
                </div>
                <div className="end">
                  <dt>Maturity value</dt>
                  <dd>{formatInrCompact(o.maturity)}</dd>
                </div>
              </dl>
              <p className="bv-jnote">
                <strong>{formatPct(pctDone, 0)}</strong> of the interest is earned:{' '}
                {formatInrCompact(o.interest.earned)} so far, {formatInrCompact(o.interest.toEarn)}{' '}
                still to come.
              </p>
            </>
          )}
        </div>
      </div>

      <div className="bv-where">
        <WhyHead why={ex['accounts.where']}>
          <h3 className="bv-h">Where the money sits</h3>
        </WhyHead>
        <SplitBar
          caption="Where the money sits"
          parts={[
            { key: 'cash', label: w.cash!.label, share: w.cash!.share, className: 'cash' },
            { key: 'fd', label: w.fd!.label, share: w.fd!.share, className: 'fd' },
            { key: 'others', label: w.others!.label, share: w.others!.share, className: 'others' },
          ]}
        />
        <ul className="bv-legend" style={{ ['--cols' as string]: legend.length }}>
          {legend.map((x) => (
            <li key={x.key}>
              <span className={`bv-swatch ${x.key}`} aria-hidden="true" />
              <span className="bv-lname">{x.label}</span>
              <strong className="bv-lamt">{formatInrCompact(x.amount)}</strong>
              <span className="bv-lpct">
                {formatPct(x.share, 0)} ·{' '}
                {x.count === 0 ? 'none' : plural(x.count, x.key === 'fd' ? 'deposit' : 'account')}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <dl className="bv-grid" aria-label="More figures">
        <Stat
          label="Fixed deposits today"
          value={formatInrCompact(o.parts.fd.current)}
          sub={
            o.deposits === 0
              ? 'no deposit'
              : `${formatInrCompact(o.parts.fd.invested)} invested · ${formatInrCompact(o.parts.fd.maturity)} at maturity${o.fdRate !== null ? ` · ${formatPct(o.fdRate, 2)} a year on average` : ''}`
          }
          href={to('/deposits')}
          why={ex['accounts.deposits']}
        />
        <Stat
          label="Savings and cash"
          value={formatInrCompact(o.parts.cash.current)}
          sub={
            <>
              {plural(o.parts.cash.count, 'account')} · {formatInrCompact(o.parts.cash.invested)}{' '}
              last recorded
              <ForeignCashLines items={o.foreign} testid="bv-cash-fx" />
            </>
          }
          href={to('/cash')}
          why={ex['accounts.cash']}
        />
        <Stat
          label="Interest still to earn"
          value={formatInrCompact(o.interest.toEarn)}
          sub="until every deposit matures"
          why={ex['accounts.toEarn']}
        />
        <Stat
          label="Next maturity"
          value={o.next ? formatInrCompact(o.next.amount) : '–'}
          sub={
            o.next
              ? `${niceDate(o.next.date)} · ${o.next.days === 0 ? 'today' : `in ${plural(o.next.days, 'day')}`} · ${o.next.bank}${o.next.count > 1 ? ` and ${o.next.count - 1} more` : ''}`
              : 'no deposit is running'
          }
          href={to('/deposits?tab=maturities')}
          why={ex['accounts.next']}
        />
        <Stat
          label={`Maturing in ${plural(o.soon.days, 'day')}`}
          value={o.soon.count === 0 ? 'None' : formatInrCompact(o.soon.amount)}
          sub={o.soon.count === 0 ? 'nothing falls due soon' : plural(o.soon.count, 'deposit')}
          tone={o.soon.count > 0 ? 'warn' : undefined}
          href={to('/deposits?tab=maturities')}
          why={ex['accounts.soon']}
        />
        <Stat
          label="Largest bank"
          value={o.topBank ? formatPct(o.topBank.share, 0) : '–'}
          sub={
            o.topBank
              ? `${o.topBank.name} holds ${formatInrCompact(o.topBank.amount)} of the money in banks`
              : 'no bank yet'
          }
          why={ex['accounts.largestBank']}
        />
        {o.cover && (
          <Stat
            label="Above the insured limit"
            value={o.cover.uninsured > 0 ? formatInrCompact(o.cover.uninsured) : 'None'}
            sub={
              o.cover.uninsured > 0
                ? `in ${plural(o.cover.banksOver, 'bank')} · limit ${formatInrCompact(o.cover.limit)} per bank and name`
                : `all within ${formatInrCompact(o.cover.limit)} per bank and name`
            }
            tone={o.cover.uninsured > 0 ? 'warn' : undefined}
            href={to('/deposits?tab=cover')}
            why={ex['accounts.cover']}
          />
        )}
        <Stat
          label={`Updated in ${month}`}
          value={
            <>
              {o.banksDone}
              <span className="muted"> / {o.banks}</span>
            </>
          }
          sub={
            o.needsYou > 0
              ? `${o.needsYou} need you: old balances or deposits to confirm`
              : o.oldestUpdate
                ? `nothing waiting · oldest balance ${niceDate(o.oldestUpdate)}`
                : 'no balance yet'
          }
          tone={o.needsYou > 0 ? 'warn' : undefined}
          href={to('/monthly')}
          why={ex['accounts.updated']}
        />
      </dl>

      {(people.length > 1 || o.accountTypes.length > 0) && (
        <div className="bv-splits">
          {people.length > 1 && (
            <div className="bv-split">
              <WhyHead why={ex['accounts.people']}>
                <h3 className="bv-h">Whose money</h3>
              </WhyHead>
              <SplitBar
                caption="Whose money"
                parts={people.map((p) => ({
                  key: p.ownerId,
                  label: p.style?.name ?? 'Unknown',
                  share: p.share,
                  className: 'person',
                  style: { background: p.style?.colour ?? 'var(--muted)' },
                }))}
              />
              <ul className="bv-legend plain">
                {people.map((p) => (
                  <li key={p.ownerId}>
                    <PersonBadge p={p.style} size={18} />
                    <span className="bv-lname">{p.style?.name ?? 'Unknown'}</span>
                    <strong className="bv-lamt">{formatInrCompact(p.current)}</strong>
                    <span className="bv-lpct">
                      {formatPct(p.share, 0)} ·{' '}
                      <span className={p.profit < 0 ? 'bv-neg' : 'bv-pos'}>
                        {p.profit < 0 ? '▼ ' : '▲ '}
                        {formatInrCompact(Math.abs(p.profit))}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {o.accountTypes.length > 0 && (
            <div className="bv-split">
              <WhyHead why={ex['accounts.types']}>
                <h3 className="bv-h">NRE and NRO</h3>
              </WhyHead>
              <SplitBar
                caption="NRE and NRO"
                parts={o.accountTypes.map((t) => ({
                  key: t.key,
                  label: t.label,
                  share: t.share,
                  className: `type-${t.key}`,
                }))}
              />
              <TypeLegend types={o.accountTypes} names={typeNames} sample={sample} />
            </div>
          )}
        </div>
      )}

      <details className="bv-how">
        <summary>How these figures are worked out</summary>
        <ul className="list small muted">
          <li>
            Invested is the amount of each deposit plus the last balance recorded for each savings
            account and holding. Maturity value is what each deposit pays on its date, with savings
            and holdings at today’s value.
          </li>
          <li>
            Earned today is an estimate: a deposit earns the difference between its value today and
            yesterday on its own terms, and a savings account earns its balance at its rate for one
            day. Money held by others and foreign-currency balances earn nothing here, and their
            exchange-rate movement is not counted as profit.
          </li>
          <li>
            A deposit past its date is left out until you say where the money went. Figures are in
            rupees.
          </li>
        </ul>
      </details>
    </section>
  );
}
