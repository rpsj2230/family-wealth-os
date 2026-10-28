import {
  foreignRupeeLine,
  foreignShort,
  foreignTitle,
  formatForeign,
  formatRate,
  type ForeignCash,
  type ForeignCashPart,
} from '@fwos/core';
import './foreign-cash.css';

/**
 * The cash held in another currency, under a Cash figure that already counts it in rupees. One entry per currency: the balance in its
 * own money ("S$ 41,250") and, in small type below, what it is worth in rupees with the rate and the day of that rate. Shows nothing
 * when there is no foreign cash. Every word comes from @fwos/core (foreign-cash.ts); this only draws it.
 */
export function ForeignCashLines({
  items,
  testid = 'fxc',
  className = '',
}: {
  items: ForeignCash[];
  testid?: string;
  className?: string;
}) {
  if (items.length === 0) return null;
  return (
    <ul
      className={`fxc ${className}`.trim()}
      data-testid={testid}
      aria-label="Cash in other currencies"
    >
      {items.map((f) => (
        <li key={f.currency} data-testid={`${testid}-${f.currency}`} title={foreignTitle(f)}>
          <span className="fxc-native">{formatForeign(f.native, f.currency)}</span>
          <span className="fxc-inr">{foreignRupeeLine(f)}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The same, as one short line for a bank or person header: "incl. S$ 41,250 ≈ ₹23.10 L". The header's own figure is the rupee
 * total and already counts this; the line only says how much of it is in each currency.
 */
export function ForeignCashInline({
  parts,
  lead = 'incl.',
  testid = 'fxc-inline',
}: {
  parts: ForeignCashPart[];
  lead?: string;
  testid?: string;
}) {
  if (parts.length === 0) return null;
  return (
    <span className="fxc-inline" data-testid={testid}>
      {parts.map((p) => (
        <span
          key={p.currency}
          className="fxc-inline-item"
          title={`1 ${p.currency} = ₹${formatRate(p.rate)} today (${p.accounts === 1 ? '1 account' : `${p.accounts} accounts`})`}
        >
          {lead} {foreignShort(p)}
        </span>
      ))}
    </span>
  );
}
