import { EST_MARK, EST_TITLE } from '@fwos/core';

/**
 * The mark on a figure that rests on an estimate (a rate, a price move, a plan), the same word and the same explanation on every page.
 * The word is the meaning; the outline only helps the eye. A figure can say why it is an estimate with `title`.
 */
export function Est({ className = '', title }: { className?: string; title?: string }) {
  return (
    <abbr className={`bv-est ${className}`.trim()} title={title ?? EST_TITLE}>
      {EST_MARK}
    </abbr>
  );
}

/** Why a fund's figures carry the mark when its transaction history does not add up. */
export const LEDGER_EST_TITLE =
  'Estimate: this fund’s transaction history does not add up to the units it holds, so what is worked out from it is partly estimated. See the data check.';
