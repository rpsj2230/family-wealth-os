/**
 * The interest check ("Explain movements" > Interest): the interest the banks reported to the tax department for each person and
 * financial year (AIS, or Form 26AS when there is no AIS), against the interest the app estimated for the same accounts and the same
 * year, before tax at source. A difference means the app's rates or dates were off: the interest really credited is what the balances
 * hold, so the difference is earnings the app did not estimate (or estimated too much), not money moved in or out.
 *
 * Only taxable interest is reported: NRE interest is tax-free and banks usually leave it out, so the estimate covers the person's
 * other accounts and deposits (NRO, resident, or with no type recorded). Recording a difference is a confirmed movement of kind
 * income on one of the person's accounts, dated the last day of the year: it moves the sum between "not yet explained" and lifetime
 * profit, and changes nothing else.
 *
 * Pure: no I/O.
 */
import { depositPeriod, savingsPeriod, spanBetween } from './period-gains';
import { accountsOf, depositsOf, type PositionInput } from './position';

export interface ReportedInterest {
  ownerId: string;
  /** "2025-26" */
  fy: string;
  kind: 'ais' | '26as';
  /** each payer's interest as the statement gives it: AIS savings and deposit interest, or 26AS interest sections */
  lines: { source: string; amount: number }[];
}

export interface InterestCheckRow {
  ownerId: string;
  fy: string;
  /** what the statement says, and from which statement */
  reported: number;
  kind: 'ais' | '26as';
  bySource: { source: string; amount: number }[];
  /** what the app worked out for the same accounts and the same year, before tax at source */
  estimated: number;
  /** reported − estimated: positive when the banks credited more than the app estimated */
  difference: number;
  /** the year is over (a year still running cannot be compared) */
  complete: boolean;
  /** the app has records for the whole year (it starts on or after the first record), so a difference means something */
  covered: boolean;
  /** the year is over, covered, and the difference is larger than the tolerance */
  flagged: boolean;
}

/** "2025-26" → its first day and the first day of the next year */
export const fyRange = (fy: string): { from: string; to: string } => {
  const y = Number(fy.slice(0, 4));
  return { from: `${y}-04-01`, to: `${y + 1}-04-01` };
};

/** Interest sections of Form 26AS: 194A (interest other than on securities) and 195 (payments to a non-resident, NRO interest). */
export const isInterestSection = (section: string) => /^(194A|195)\b/i.test(section.trim());

/** The interest one person's taxable accounts and deposits earned in one financial year, before tax at source. */
export function estimatedInterest(
  position: PositionInput,
  ownerId: string,
  fy: string,
  taxable: (assetId: string) => boolean,
): number {
  const { from, to } = fyRange(fy);
  const today = position.config.today;
  const end = to <= today ? to : today;
  if (end <= from) return 0;
  const w = spanBetween(from, end);
  // before tax at source: the statements report the interest paid, not what was left after the tax
  const gross: PositionInput = {
    ...position,
    config: { ...position.config, tdsRate: 0 },
    assets: position.assets
      .filter(
        (a) =>
          a.ownerId === ownerId &&
          a.currency === 'INR' &&
          (a.type === 'bank_account' || a.type === 'fixed_deposit') &&
          taxable(a.assetId),
      )
      .map((a) => ({ ...a, rate: { ...a.rate, tds: null } })),
  };
  return (
    savingsPeriod(accountsOf(gross), w).profit + depositPeriod(depositsOf(gross), w, today).profit
  );
}

export function interestCheck(args: {
  position: PositionInput;
  statements: ReportedInterest[];
  taxable: (assetId: string) => boolean;
  /** a difference within this many rupees, or this share of the reported interest, is not flagged */
  tolerance: { rupees: number; share: number };
  /** the first day the app has records from (the opening date); a year starting before it is shown but never flagged */
  coveredFrom?: string | null;
}): InterestCheckRow[] {
  const today = args.position.config.today;
  // one statement per person and year: AIS when there is one (it has savings and deposit interest apart), else Form 26AS
  const chosen = new Map<string, ReportedInterest>();
  for (const s of args.statements) {
    const k = `${s.ownerId}|${s.fy}`;
    const cur = chosen.get(k);
    if (!cur || (cur.kind === '26as' && s.kind === 'ais')) chosen.set(k, s);
  }
  const rows: InterestCheckRow[] = [];
  for (const s of chosen.values()) {
    const bySource = new Map<string, number>();
    for (const l of s.lines) bySource.set(l.source, (bySource.get(l.source) ?? 0) + l.amount);
    const reported = s.lines.reduce((a, l) => a + l.amount, 0);
    const estimated = estimatedInterest(args.position, s.ownerId, s.fy, args.taxable);
    const difference = reported - estimated;
    const complete = fyRange(s.fy).to <= today;
    const covered = !args.coveredFrom || fyRange(s.fy).from >= args.coveredFrom;
    rows.push({
      ownerId: s.ownerId,
      fy: s.fy,
      reported,
      kind: s.kind,
      bySource: [...bySource.entries()]
        .map(([source, amount]) => ({ source, amount }))
        .sort((a, b) => b.amount - a.amount),
      estimated,
      difference,
      complete,
      covered,
      flagged:
        complete &&
        covered &&
        Math.abs(difference) > Math.max(args.tolerance.rupees, args.tolerance.share * reported),
    });
  }
  return rows.sort((a, b) => b.fy.localeCompare(a.fy) || a.ownerId.localeCompare(b.ownerId));
}
