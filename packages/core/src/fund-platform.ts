/**
 * Where a fund is bought and held (an investment app such as Kuvera, or a broker's demat account), decided by the rules in Settings,
 * since a statement does not say. Pure; kept apart so the settings reader can check the rules without loading the funds code.
 */
/** One platform rule from Settings: a fund whose name holds `words` is held on `platform`; words "*" stand for every other fund. */
export interface PlatformRule {
  words: string;
  platform: string;
}

/** Reads "words = Platform" (case and spacing of the words do not matter). */
export function parsePlatformRule(line: string): PlatformRule | { error: string } {
  const m = /^(.+?)\s*=\s*(.+)$/.exec(line.trim());
  if (!m) return { error: `“${line.trim()}” should read: words in the fund's name = platform` };
  const words = m[1]!.trim().toLowerCase().replace(/\s+/g, ' ');
  const platform = m[2]!.trim().replace(/\s+/g, ' ');
  if (words.length > 60) return { error: `“${words}” is longer than 60 characters` };
  if (platform.length < 2 || platform.length > 40)
    return { error: `“${platform}” should be a platform name of 2 to 40 characters` };
  return { words, platform };
}

/**
 * Where a fund is held, by the rules in Settings: the first rule whose words are in the fund's statement name or the name given to it
 * wins; a "*" rule covers every fund no other rule fits. Null when nothing fits (no "*" rule).
 */
export function fundPlatform(names: (string | null | undefined)[], rules: string[]): string | null {
  const text = names
    .filter((x): x is string => !!x)
    .join(' | ')
    .toLowerCase()
    .replace(/\s+/g, ' ');
  let rest: string | null = null;
  for (const line of rules) {
    const r = parsePlatformRule(line);
    if ('error' in r) continue;
    if (r.words === '*') rest ??= r.platform;
    else if (text.includes(r.words)) return r.platform;
  }
  return rest;
}
