/**
 * Which items of a preview can be ticked, which are ticked, and what is sent back. Plain functions, so the rules (a new or sold fund
 * and its SIP go together; an item that is shown and not ticked is remembered as overruled) are tested without a browser.
 */
import { sipIsChange, sipKey } from '@fwos/core';
import type { ItemView, PersonPreview } from './fund-import';

/** The fund part is something to apply. */
export const fundSelectable = (i: ItemView) => i.changed;
/** The SIP part is something to apply (and can be ticked on its own). */
export const sipSelectable = (i: ItemView) => sipIsChange(i.sip);
/** A new or sold fund brings its SIP with it: the SIP cannot be applied without the fund. */
export const sipDependsOnFund = (i: ItemView) => i.kind === 'new' || i.kind === 'sold';

/** Everything shown to tick, in order. */
export function selectableKeys(people: Pick<PersonPreview, 'diff'>[]): string[] {
  return people.flatMap((p) =>
    p.diff.items.flatMap((i) => [
      ...(fundSelectable(i) ? [i.key] : []),
      ...(sipSelectable(i) ? [sipKey(i.key)] : []),
    ]),
  );
}

/** Whether a key is taken: it is not unticked, and a SIP that depends on its fund is taken only with the fund. */
export function isTaken(
  people: Pick<PersonPreview, 'diff'>[],
  off: ReadonlySet<string>,
  key: string,
): boolean {
  if (off.has(key)) return false;
  if (!key.endsWith('#sip')) return true;
  const itemKey = key.slice(0, -'#sip'.length);
  for (const p of people) {
    const i = p.diff.items.find((x) => x.key === itemKey);
    if (i) return !sipDependsOnFund(i) || !off.has(i.key);
  }
  return true;
}

export interface FundSelection {
  /** what was shown to tick, and which of it is ticked */
  seen: string[];
  take: string[];
  /** funds with something ticked (the fund or its SIP) */
  count: number;
}

export function selectionOf(
  people: Pick<PersonPreview, 'diff'>[],
  off: ReadonlySet<string>,
): FundSelection {
  const seen = selectableKeys(people);
  const take = seen.filter((k) => isTaken(people, off, k));
  const funds = new Set(take.map((k) => k.replace(/#sip$/, '')));
  return { seen, take, count: funds.size };
}

/** Adds the selection to a form, the way the apply step reads it. */
export function appendSelection(fd: FormData, sel: FundSelection): void {
  for (const k of sel.seen) fd.append('seen', k);
  for (const k of sel.take) fd.append('take', k);
}
