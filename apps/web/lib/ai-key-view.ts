import type { AiProvider } from '@fwos/ingest';

/** One saved AI key as Settings shows it. The key itself is never part of this: it cannot be read back. */
export interface AiKeyRow {
  provider: AiProvider;
  /** 1 is tried first */
  priority: number;
  enabled: boolean;
  label: string | null;
  lastOkAt: string | null;
  lastModel: string | null;
  lastErrorAt: string | null;
  lastErrorStatus: number | null;
  lastError: string | null;
  testedAt: string | null;
  testOk: boolean | null;
  testNote: string | null;
}

export type Tone = 'ok' | 'bad' | 'idle';

/** "26 Oct 2026, 09:30" in Singapore time, the same on the server and in the browser. */
export const whenText = (iso: string): string =>
  new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Singapore',
  });

/** The keys in the order they are tried, switched-off keys kept in their place. */
export const inOrder = (keys: readonly AiKeyRow[]): AiKeyRow[] =>
  [...keys].sort((a, b) => a.priority - b.priority);

/**
 * What each key is for: "First choice", "Fallback 2", "Fallback 3" count only the keys that are switched on, since those are the ones
 * that are asked; a key that is switched off says so.
 */
export function roleOf(keys: readonly AiKeyRow[]): Map<AiProvider, string> {
  const roles = new Map<AiProvider, string>();
  let rank = 0;
  for (const k of inOrder(keys)) {
    if (!k.enabled) roles.set(k.provider, 'Switched off');
    else roles.set(k.provider, ++rank === 1 ? 'First choice' : `Fallback ${rank}`);
  }
  return roles;
}

/** The last real use of a key: when it worked, or why and when it failed, whichever is newer. */
export function usageStatus(k: AiKeyRow): { tone: Tone; text: string } {
  const ok = k.lastOkAt ? Date.parse(k.lastOkAt) : null;
  const bad = k.lastErrorAt ? Date.parse(k.lastErrorAt) : null;
  if (bad !== null && (ok === null || bad > ok))
    return {
      tone: 'bad',
      text: `Last failed ${whenText(k.lastErrorAt!)}: ${k.lastError || `status ${k.lastErrorStatus ?? 0}`}`,
    };
  if (ok !== null)
    return {
      tone: 'ok',
      text: `Last used OK ${whenText(k.lastOkAt!)}${k.lastModel ? ` with ${k.lastModel}` : ''}`,
    };
  return { tone: 'idle', text: 'Not used yet' };
}

/** The last test of a key, or null when it was never tested. */
export function testStatus(k: AiKeyRow): { tone: Tone; text: string } | null {
  if (!k.testedAt) return null;
  return {
    tone: k.testOk ? 'ok' : 'bad',
    text: `Last test ${whenText(k.testedAt)}: ${k.testOk ? 'working' : 'not working'}${k.testNote ? ` (${k.testNote})` : ''}`,
  };
}

/** The pill on the card: how many keys will be asked. */
export function summaryPill(keys: readonly AiKeyRow[]): { tone: 'ok' | 'warn'; text: string } {
  const on = keys.filter((k) => k.enabled).length;
  if (on > 0) return { tone: 'ok', text: `${on} AI ${on === 1 ? 'key' : 'keys'} on` };
  return { tone: 'warn', text: keys.length > 0 ? 'All AI keys switched off' : 'No AI key' };
}

/** The list with priorities numbered 1..n in its current order (what the database does after every change). */
export const renumbered = (keys: readonly AiKeyRow[]): AiKeyRow[] =>
  inOrder(keys).map((k, i) => ({ ...k, priority: i + 1 }));

/** Swaps a key with its neighbour: 'up' makes it tried earlier. At either end nothing changes. */
export function moveKey(
  keys: readonly AiKeyRow[],
  provider: AiProvider,
  direction: 'up' | 'down',
): AiKeyRow[] {
  const list = renumbered(keys);
  const i = list.findIndex((k) => k.provider === provider);
  const j = direction === 'up' ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= list.length) return list;
  [list[i], list[j]] = [list[j]!, list[i]!];
  return renumbered(list.map((k, n) => ({ ...k, priority: n + 1 })));
}

/** The services that have no key yet, in the order Settings offers them. */
export const unusedProviders = (
  all: readonly AiProvider[],
  keys: readonly AiKeyRow[],
): AiProvider[] => all.filter((p) => !keys.some((k) => k.provider === p));
