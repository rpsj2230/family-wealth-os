import Link from 'next/link';
import {
  capacityLabel,
  formatInr,
  insuranceRoom,
  type PersonStyle,
  type RateHolding,
  type RatePrefs,
  type Suggestion,
} from '@fwos/core';
import { PersonBadge } from '@/components/Person';
import { slugify } from '@/lib/slug';
import '../rates/rates.css';

/** Holdings that earn clearly less than an offer elsewhere, with the gain and the safe moment to act. */
export function Suggestions({
  suggestions,
  totalGain,
  prefs,
  offersCount,
  banksBase,
}: {
  suggestions: Suggestion[];
  totalGain: number;
  prefs: RatePrefs;
  offersCount: number;
  banksBase: string;
}) {
  if (suggestions.length === 0)
    return (
      <p className="empty">
        {offersCount === 0
          ? 'Add rates on the Rates page to compare.'
          : 'Nothing worth moving right now: no account earns clearly less than a better offer with insurance room. A running deposit is never suggested to be broken early; moves are for maturity.'}
      </p>
    );
  return (
    <>
      <p>
        If you act on all of these: about <strong>{formatInr(Math.round(totalGain))}</strong> more
        interest a year.
      </p>
      <div role="list">
        {suggestions.map((x) => (
          <div key={x.assetId} className="nm-sug" role="listitem">
            <div>
              <b>
                {x.from} <span aria-hidden="true">→</span>
                <span className="sr-only"> to </span>{' '}
                <Link href={`${banksBase}/${slugify(x.to)}`}>{x.to}</Link>
              </b>
              <div className="small" style={{ marginTop: 4 }}>
                {x.text}
              </div>
              {x.offerAgeDays > prefs.staleDays && (
                <div className="small warnText">
                  This rate was checked {x.offerAgeDays} days ago; confirm it first.
                </div>
              )}
            </div>
            <div className="gain num" style={{ fontWeight: 650, whiteSpace: 'nowrap' }}>
              +{formatInr(Math.round(x.annualGain))} a year
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

/**
 * Per bank and ownership name: how much sits there (savings and deposits of the bank added together, with interest) and how much of
 * the deposit-insurance limit is left. A joint account counts under its names in the order written; a bank outside the scheme is
 * listed apart as not covered.
 */
export function InsuranceRoom({
  holdings,
  limit,
  styles,
}: {
  holdings: RateHolding[];
  limit: number;
  styles: Record<string, PersonStyle>;
}) {
  const { rows, outside } = insuranceRoom(holdings, limit);
  const names = Object.fromEntries(Object.entries(styles).map(([id, s]) => [id, s.name]));
  if (rows.length === 0 && outside.length === 0)
    return <p className="empty">No balances recorded yet.</p>;
  return (
    <>
      <div role="list">
        {rows.slice(0, 60).map((r) => {
          const over = r.total > limit;
          const joint = r.capacityKey.startsWith('joint:');
          const kinds = [
            r.parts.some((p) => p.product === 'savings') ? 'savings' : null,
            r.parts.some((p) => p.product === 'fd') ? 'deposits' : null,
          ]
            .filter(Boolean)
            .join(' + ');
          return (
            <div key={`${r.bank}${r.capacityKey}`} className="nm-room" role="listitem">
              <div>
                <PersonBadge p={styles[r.ownerId]} size={20} />{' '}
                <b>{capacityLabel(r.capacityKey, names)}</b> · {r.bank}
                <div className="nm-sub">
                  {kinds}
                  {joint ? ' · joint account, counted under these names in this order' : ''}
                </div>
                <div className="nm-bar" style={{ marginTop: 6 }} aria-hidden="true">
                  <span
                    style={{
                      width: `${Math.min(100, (r.total / limit) * 100)}%`,
                      background: over ? 'var(--fail)' : undefined,
                    }}
                  />
                </div>
              </div>
              <div className="num" style={{ textAlign: 'right' }}>
                {formatInr(Math.round(r.total))}
                <div className={`small ${over ? 'fail' : 'muted'}`}>
                  {over
                    ? `${formatInr(Math.round(r.uninsured))} above the limit`
                    : `${formatInr(Math.round(r.room))} room`}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {outside.length > 0 && (
        <p className="muted small" style={{ marginTop: 12 }}>
          Not covered by deposit insurance (set on Deposits → Insurance cover):{' '}
          {outside.map((o) => `${o.bank} ${formatInr(Math.round(o.total))}`).join(', ')}.
        </p>
      )}
    </>
  );
}
