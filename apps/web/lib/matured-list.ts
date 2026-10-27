/**
 * Words and addresses for the "older or confirmed matured deposits are hidden" line under the Accounts, Monthly update and Deposits
 * lists. Pure: the pages draw what this returns. The address parameter is `?matured=all`.
 */
import type { HiddenDeposits } from '@fwos/core';

/** The sentence shown after "Confirm matured": what happened, and how to get the deposit back. */
export const CONFIRMED_NOTICE =
  'Marked as matured. It is hidden from the list; Show matured brings it back.';

/** The short line that stands in the row of a deposit that is past its date and not counted. */
export const NOT_COUNTED_NOTE =
  'Counted in the savings account or a new deposit once you record it';

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
