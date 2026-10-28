/**
 * Words and addresses for the "older or confirmed matured deposits are hidden" line under the Accounts, Monthly update and Deposits
 * lists. Pure: the pages draw what this returns. The address parameter is `?matured=all`.
 */
import type { HiddenDeposits } from '@fwos/core';

/** The sentence shown after "Confirm matured": what happened, and how to get the deposit back. */
export const CONFIRMED_NOTICE =
  'Marked as matured. It is hidden from the list; Show matured brings it back.';

/** The short line in the row of a deposit past its date whose proceeds nobody placed yet: they are counted once, in this row. */
export const AWAITING_NOTE = 'Counted once in net worth until you say where the money went';

/** The short line in the row of a deposit past its date whose proceeds a new deposit or a later balance probably holds. */
export const NOT_COUNTED_NOTE =
  'Probably already in a savings account or a new deposit, so not counted here again';

/** The note for a matured deposit's row: counted (its proceeds still wait to be placed) or not (they are probably held elsewhere). */
export const maturedNote = (counted: boolean): string =>
  counted ? AWAITING_NOTE : NOT_COUNTED_NOTE;

/** Whether the address asks for the hidden deposits to be listed too. */
export const showsMatured = (v: string | string[] | undefined): boolean =>
  (Array.isArray(v) ? v[0] : v) === 'all';

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** "3 older or confirmed matured deposits are hidden." / "Showing 3 older or confirmed matured deposits, dimmed." */
export function hiddenSentence(c: HiddenDeposits, showAll: boolean): string {
  const n = c.hidden;
  if (showAll)
    return `Showing ${n} older or confirmed matured ${plural(n, 'deposit', 'deposits')}, dimmed.`;
  return `${n} older or confirmed matured ${plural(n, 'deposit is', 'deposits are')} hidden.`;
}

/** The address of this page with the matured deposits shown (`all`) or hidden again, keeping every other choice. */
export function maturedHref(
  base: string,
  keep: Record<string, string | null | undefined>,
  showAll: boolean,
): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(keep)) if (v && k !== 'matured') q.set(k, v);
  if (showAll) q.set('matured', 'all');
  const s = q.toString();
  return s ? `${base}?${s}` : base;
}
