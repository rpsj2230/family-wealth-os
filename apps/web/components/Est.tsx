import { EST_MARK, EST_TITLE } from '@fwos/core';

/**
 * The mark on a figure that rests on an estimate (a rate, a price move, a plan), the same word and the same explanation on every page.
 * The word is the meaning; the outline only helps the eye.
 */
export function Est({ className = '' }: { className?: string }) {
  return (
    <abbr className={`bv-est ${className}`.trim()} title={EST_TITLE}>
      {EST_MARK}
    </abbr>
  );
}
