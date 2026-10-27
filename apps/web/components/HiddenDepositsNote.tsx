import Link from 'next/link';
import type { HiddenDeposits } from '@fwos/core';
import { hiddenSentence } from '@/lib/matured-list';

/**
 * The quiet line under a list that leaves out matured deposits: how many are hidden and a link that brings them back, dimmed
 * (or hides them again). The link is an address (`?matured=all`), so the choice survives a reload and the back button.
 * Renders nothing when there is nothing to hide and nothing is shown.
 */
export function HiddenDepositsNote({
  counts,
  showAll,
  showHref,
  hideHref,
}: {
  counts: HiddenDeposits;
  showAll: boolean;
  showHref: string;
  hideHref: string;
}) {
  if (counts.hidden === 0) return null;
  return (
    <p className="hiddennote small muted" data-testid="hidden-matured">
      {hiddenSentence(counts, showAll)}{' '}
      {showAll ? (
        <Link href={hideHref} scroll={false}>
          Hide matured
        </Link>
      ) : (
        <Link href={showHref} scroll={false}>
          Show matured
        </Link>
      )}
    </p>
  );
}
