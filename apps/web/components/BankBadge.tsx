import { bankStyle } from '@fwos/core';

/** A small coloured badge with the bank's letters, so a bank is recognised at a glance everywhere it appears. */
export function BankBadge({ name, size = 28 }: { name: string; size?: number }) {
  const b = bankStyle(name);
  return (
    <span
      className="bankbadge"
      aria-hidden="true"
      style={{ background: b.colour, width: size, height: size, fontSize: Math.round(size * 0.4) }}
    >
      {b.abbr}
    </span>
  );
}
