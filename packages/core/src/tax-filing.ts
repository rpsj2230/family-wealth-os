/**
 * Working papers for the Indian income-tax return: interest on fixed deposits per financial year, by taxpayer.
 * These are ESTIMATES from the deposit terms (quarterly compounding). Use the bank's interest certificate (Form 16A),
 * Form 26AS and the Annual Information Statement for the figures you actually file.
 */
import { fdValueOn, type Compounding } from './fd';
import { fyOf } from './tax';

export function fyBounds(fy: string): { start: string; end: string } {
  const m = /^(\d{4})-(\d{2})$/.exec(fy);
  if (!m) throw new RangeError(`bad financial year: ${fy}`);
  const y = Number(m[1]);
  if ((y + 1) % 100 !== Number(m[2])) throw new RangeError(`bad financial year: ${fy}`);
  return { start: `${y}-04-01`, end: `${y + 1}-03-31` };
}

export interface FdForFiling {
  id: string;
  ownerId: string;
  bank: string;
  nickname: string;
  kind: 'NRE' | 'NRO' | 'joint' | 'unknown';
  principal: number;
  rate: number;
  bookedOn: string;
  maturityOn: string;
  compounding: Compounding;
}

export interface InterestLine {
  fdId: string;
  ownerId: string;
  bank: string;
  nickname: string;
  kind: FdForFiling['kind'];
  from: string;
  to: string;
  interest: number;
  taxable: 'yes' | 'exempt_nre' | 'check_joint_or_unknown';
}

const utc = (s: string) => new Date(s + 'T00:00:00Z');

/** Interest that accrued on one FD inside a financial year (0 if the FD did not exist in it). */
export function fdInterestForFy(fd: FdForFiling, fy: string): InterestLine | null {
  const { start, end } = fyBounds(fy);
  const from = fd.bookedOn > start ? fd.bookedOn : start;
  const to = fd.maturityOn < end ? fd.maturityOn : end;
  if (from > to) return null;
  const at = (d: string) =>
    fdValueOn({
      principal: fd.principal,
      annualRate: fd.rate,
      bookedOn: utc(fd.bookedOn),
      asOf: utc(d),
      maturityOn: utc(fd.maturityOn),
      compounding: fd.compounding,
    });
  // A year's interest runs through 31 March, so the closing value is taken on 1 April; a deposit that matures earlier closes on its maturity date.
  const closing =
    to === end ? new Date(utc(end).getTime() + 86_400_000).toISOString().slice(0, 10) : to;
  const interest = at(closing) - at(from);
  return {
    fdId: fd.id,
    ownerId: fd.ownerId,
    bank: fd.bank,
    nickname: fd.nickname,
    kind: fd.kind,
    from,
    to,
    interest,
    taxable:
      fd.kind === 'NRO' ? 'yes' : fd.kind === 'NRE' ? 'exempt_nre' : 'check_joint_or_unknown',
  };
}

export interface InterestSchedule {
  fy: string;
  /** true when the FY has not finished: figures run only to today */
  partialYear: boolean;
  byOwner: Record<
    string,
    {
      taxableInterest: number;
      exemptNreInterest: number;
      unclassifiedInterest: number;
      tdsEstimate: number;
      lines: InterestLine[];
    }
  >;
  assumptions: string[];
}

/** `tdsRate` is a rate you provide (statutory or treaty); it is not assumed. null means "do not estimate TDS". */
export function interestSchedule(
  fds: FdForFiling[],
  fy: string,
  today: string,
  tdsRate: number | null,
): InterestSchedule {
  const { end } = fyBounds(fy);
  const cutoff = today < end ? today : end;
  const byOwner: InterestSchedule['byOwner'] = {};
  for (const fd of fds) {
    const line = fdInterestForFy(fd, fy);
    if (!line) continue;
    // for a year in progress, count only up to today
    const clipped =
      line.to > cutoff
        ? fdInterestForFy(
            { ...fd, maturityOn: fd.maturityOn > cutoff ? cutoff : fd.maturityOn },
            fy,
          )
        : line;
    if (!clipped || clipped.interest <= 0) continue;
    const o = (byOwner[fd.ownerId] ??= {
      taxableInterest: 0,
      exemptNreInterest: 0,
      unclassifiedInterest: 0,
      tdsEstimate: 0,
      lines: [],
    });
    o.lines.push(clipped);
    if (clipped.taxable === 'yes') o.taxableInterest += clipped.interest;
    else if (clipped.taxable === 'exempt_nre') o.exemptNreInterest += clipped.interest;
    else o.unclassifiedInterest += clipped.interest;
  }
  for (const o of Object.values(byOwner))
    o.tdsEstimate = tdsRate === null ? 0 : o.taxableInterest * tdsRate;
  return {
    fy,
    partialYear: today < end,
    byOwner,
    assumptions: [
      'Interest is calculated from each deposit’s rate, dates and quarterly compounding. Banks’ own certificates can differ by a small amount.',
      'Interest on NRE deposits is treated as exempt in India; interest on NRO deposits as taxable. Check the account type of every deposit; joint or unlabelled deposits are listed separately.',
      tdsRate === null
        ? 'Tax deducted at source is not estimated (no rate supplied).'
        : `Tax deducted at source is estimated at ${(tdsRate * 100).toFixed(2)}% of taxable interest, the rate you supplied. A tax-treaty rate or lower-deduction certificate changes this.`,
      'Compare with Form 26AS and the Annual Information Statement before filing.',
    ],
  };
}

export function currentFy(today: string): string {
  return fyOf(today);
}

/** CSV with a header row; amounts rounded to whole rupees. Quotes and commas inside text are escaped. */
export function interestCsv(s: InterestSchedule, ownerNames: Record<string, string>): string {
  const q = (v: string | number) => {
    const t = String(v);
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const rows = [
    [
      'Financial year',
      'Taxpayer',
      'Bank',
      'Deposit',
      'Account type',
      'From',
      'To',
      'Interest accrued (INR)',
      'Treatment',
    ].join(','),
  ];
  for (const [owner, o] of Object.entries(s.byOwner)) {
    for (const l of o.lines) {
      rows.push(
        [
          s.fy,
          ownerNames[owner] ?? owner,
          l.bank,
          l.nickname,
          l.kind,
          l.from,
          l.to,
          Math.round(l.interest),
          l.taxable === 'yes'
            ? 'Taxable (NRO)'
            : l.taxable === 'exempt_nre'
              ? 'Exempt (NRE)'
              : 'Check account type',
        ]
          .map(q)
          .join(','),
      );
    }
  }
  return rows.join('\n') + '\n';
}

export interface InterestRefund {
  ownerId: string;
  fy: string;
  /** taxable (NRO) interest for the whole year */
  interest: number;
  /** tax the bank is expected to withhold */
  tds: number;
  /** total taxable Indian income used for the test */
  income: number;
  /** under the limit: all of the withheld tax is refunded; above it the refund depends on the tax actually due */
  withinLimit: boolean;
  refund: number;
  description: string;
}

/**
 * Tax withheld on NRO deposit interest comes back when a person's total taxable Indian income stays under the limit.
 * Uses the whole financial year's interest (a projection while the year runs). Over the limit the refund is not guessed.
 */
export function interestRefunds(
  fds: FdForFiling[],
  fy: string,
  opts: { tdsRate: number; cess: number; incomeLimit: number; otherIncome: number },
): InterestRefund[] {
  const { end } = fyBounds(fy);
  const s = interestSchedule(fds, fy, end, null);
  return Object.entries(s.byOwner)
    .filter(([, o]) => o.taxableInterest > 0)
    .map(([ownerId, o]) => {
      const tds = o.taxableInterest * opts.tdsRate * (1 + opts.cess);
      const income = o.taxableInterest + opts.otherIncome;
      const within = income <= opts.incomeLimit;
      return {
        ownerId,
        fy,
        interest: Math.round(o.taxableInterest),
        tds: Math.round(tds),
        income: Math.round(income),
        withinLimit: within,
        refund: within ? Math.round(tds) : 0,
        description: within
          ? 'Tax withheld on NRO deposit interest; total Indian income is under the limit, so it is refunded when you file'
          : 'Tax withheld on NRO deposit interest; income is over the limit, so the refund depends on the tax actually due (ask your adviser)',
      };
    });
}
