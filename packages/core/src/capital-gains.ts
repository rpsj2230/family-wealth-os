/**
 * Capital gains on mutual funds for one financial year, from the sales on the fund statements (oldest units sold first).
 * Equity funds are summed into short- and long-term gains and taxed with the year's rules; funds that look like debt funds
 * are listed apart, because their gains are taxed at the person's slab and this app does not compute that.
 * The schedule 112A file lists every long-term sale of an equity fund. Units bought before 1 February 2018 need the
 * 31 January 2018 value per unit (grandfathering); it is not guessed, the row is left blank and counted in `needsFmv`.
 */
import { computePosition, type Position, type TaxRuleSet } from './tax';
import { fundTaxClass } from './fund-class';

export interface RealisedRow {
  ownerId: string;
  fund: string;
  isin: string | null;
  soldOn: string;
  acquiredOn: string;
  units: number;
  proceeds: number;
  /** null when the purchase is not on the statement */
  cost: number | null;
}

export type GainTerm = 'short' | 'long';

export interface GainLine extends RealisedRow {
  term: GainTerm;
  gain: number | null;
  equity: boolean;
  beforeFeb2018: boolean;
}

/** A fund that does not get the equity treatment: debt funds (slab rate) and international, gold or fund-of-funds units (24 months, no allowance). Hybrids and unknown names stay with equity and are marked as such in the notes. */
export const looksLikeDebtFund = (name: string) => {
  const c = fundTaxClass(name).class;
  return c === 'debt_slab' || c === 'other_long';
};

const addMonths = (iso: string, m: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + m);
  return d.toISOString().slice(0, 10);
};

export function classifyGains(rows: RealisedRow[], holdingMonthsLong: number): GainLine[] {
  return rows.map((r) => ({
    ...r,
    term: r.soldOn > addMonths(r.acquiredOn, holdingMonthsLong) ? 'long' : 'short',
    gain: r.cost === null ? null : r.proceeds - r.cost,
    equity: !looksLikeDebtFund(r.fund),
    beforeFeb2018: r.acquiredOn < '2018-02-01',
  }));
}

export interface OwnerGains {
  ownerId: string;
  stcg: number;
  ltcg: number;
  debtGains: number;
  /** sales whose cost is not on the statement, so they are left out of the totals */
  unknownCost: number;
  /** long-term sales of units bought before 1 Feb 2018: the 31 Jan 2018 value is needed */
  needsFmv: number;
  position: Position | null;
  lines: GainLine[];
}

export function summariseGains(
  lines: GainLine[],
  rule: TaxRuleSet | null,
  carry: { stcl: number; ltcl: number } = { stcl: 0, ltcl: 0 },
): OwnerGains[] {
  const owners = [...new Set(lines.map((l) => l.ownerId))];
  return owners.map((ownerId) => {
    const mine = lines.filter((l) => l.ownerId === ownerId);
    const known = mine.filter((l) => l.gain !== null);
    const stcg = known
      .filter((l) => l.equity && l.term === 'short')
      .reduce((a, l) => a + l.gain!, 0);
    const ltcg = known
      .filter((l) => l.equity && l.term === 'long')
      .reduce((a, l) => a + l.gain!, 0);
    return {
      ownerId,
      stcg: Math.round(stcg),
      ltcg: Math.round(ltcg),
      debtGains: Math.round(known.filter((l) => !l.equity).reduce((a, l) => a + l.gain!, 0)),
      unknownCost: mine.filter((l) => l.gain === null).length,
      needsFmv: mine.filter((l) => l.equity && l.term === 'long' && l.beforeFeb2018).length,
      position: rule ? computePosition(stcg, ltcg, carry, rule.equity, rule.cess) : null,
      lines: mine,
    };
  });
}

const q = (v: string | number) => {
  const s = String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** Long-term equity sales as rows for the schedule 112A upload (check the column order against the portal's own template). */
export function schedule112aCsv(lines: GainLine[]): string {
  const head = [
    'Share/Unit acquired(1a)',
    'ISIN Code',
    'Name of the Share/Unit',
    'No. of Shares/Units',
    'Sale-price per Share/Unit',
    'Full Value Consideration',
    'Cost of acquisition without indexation',
    'Cost of acquisition',
    'If the long term capital asset was acquired before 01.02.2018, Fair Market Value per share/unit as on 31st January 2018',
    'Total Fair Market Value of capital asset as per section 55(2)(ac)',
    'Expenditure wholly and exclusively in connection with transfer',
    'Total deductions',
    'Balance',
  ];
  const rows = lines
    .filter((l) => l.equity && l.term === 'long' && l.cost !== null)
    .map((l) => {
      const per = l.units > 0 ? l.proceeds / l.units : 0;
      return [
        l.beforeFeb2018 ? 'BE' : 'AE',
        l.isin ?? '',
        l.fund,
        l.units.toFixed(3),
        per.toFixed(4),
        l.proceeds.toFixed(2),
        l.cost!.toFixed(2),
        l.cost!.toFixed(2),
        '',
        '',
        '0.00',
        l.cost!.toFixed(2),
        (l.proceeds - l.cost!).toFixed(2),
      ];
    });
  return [head, ...rows].map((r) => r.map(q).join(',')).join('\r\n') + '\r\n';
}
