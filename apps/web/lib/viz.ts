/** Colours for the fund graphs: the first eight things get the eight palette colours in a fixed order, the rest share one neutral. */
export const VIZ_SLOTS = 8;
export const VIZ_OTHER = 'var(--viz-other)';

/** Assigns a palette colour to each key, in the order given. The same list always gives the same colours. */
export function slotColours(keys: string[]): Map<string, string> {
  const m = new Map<string, string>();
  keys.forEach((k, i) => {
    if (!m.has(k)) m.set(k, i < VIZ_SLOTS ? `var(--viz-${i + 1})` : VIZ_OTHER);
  });
  return m;
}

/** A colour for a key, or the neutral one when it is not in the plan (for example the folded "Other"). */
export const colourOf = (plan: Map<string, string>, key: string) => plan.get(key) ?? VIZ_OTHER;
