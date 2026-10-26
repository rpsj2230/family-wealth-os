/** Which of the household's funds are tied to an official scheme (so the daily price can be used) and which are not yet. */
export interface MatchableFund {
  assetId: string;
  name: string;
  amfiCode: string | null;
  sipStopped: boolean;
}

export function matchProgress(funds: { amfiCode: string | null }[]) {
  const matched = funds.filter((f) => !!f.amfiCode).length;
  return { matched, total: funds.length, pending: funds.length - matched };
}

/** Funds that still need a decision come first (funds with a running SIP before stopped ones), then matched funds by name. */
export function orderForMatching<T extends MatchableFund>(funds: T[]): T[] {
  return [...funds].sort(
    (a, b) =>
      Number(!!a.amfiCode) - Number(!!b.amfiCode) ||
      Number(a.sipStopped) - Number(b.sipStopped) ||
      a.name.localeCompare(b.name),
  );
}

/** An exit load is stored as a fraction (0.01 is 1%); the form shows percent without floating-point noise (0.07 -> "7"). */
export function exitLoadPercentText(fraction: number | null | undefined): string {
  if (fraction === null || fraction === undefined) return '';
  return String(Math.round(Number(fraction) * 1e6) / 1e4);
}

export type ExitLoadInput = { clear: true } | { clear: false; fraction: number; days: number };

/** Reads the exit-load form: both fields empty goes back to the household default; otherwise 0 to 10 percent for 0 to 1095 days. */
export function parseExitLoad(pctRaw: string, daysRaw: string): ExitLoadInput | null {
  const p = pctRaw.replace(/[%\s]/g, '');
  const d = daysRaw.trim();
  if (p === '' && d === '') return { clear: true };
  const pct = Number(p);
  const days = Number(d);
  if (!(pct >= 0 && pct <= 10) || !Number.isInteger(days) || days < 0 || days > 1095) return null;
  return { clear: false, fraction: Math.round(pct * 1e4) / 1e6, days };
}
