/** The new-money planner used to live on /rates. These are its address parameters. */
const PLANNER_KEYS = ['amount', 'who', 'tenure', 'liquid', 'joint', 'with'] as const;

/**
 * Where an old /rates address should go: addresses that carried planner parameters now belong to /new-money, with the same
 * parameters. Returns null for an ordinary /rates address.
 */
export function plannerRedirect(sp: Record<string, string | undefined>): string | null {
  if (!PLANNER_KEYS.some((k) => sp[k] !== undefined)) return null;
  const q = new URLSearchParams();
  for (const k of [...PLANNER_KEYS, 'kind'] as const) if (sp[k]) q.set(k, sp[k]!);
  const s = q.toString();
  return s ? `/new-money?${s}` : '/new-money';
}
