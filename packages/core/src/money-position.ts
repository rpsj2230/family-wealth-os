/**
 * The household's money position, one plain card per kind of money: net worth (the family and each person), cash in rupees, cash
 * in each foreign currency (its own amount, its rupee value and the rate and date behind it), all cash, fixed deposits (principal
 * and interest apart), mutual funds (value, cost of the units held, gain), liquid financial assets by a stated rule, money lent,
 * property, retirement accounts, other holdings, months of spending the cash covers, and the records that are out of date.
 *
 * Each card says what it counts and how sure it is: actual (recorded or confirmed), estimated (worked out from terms, a rate or a
 * plan) or unavailable (and why). Where daily snapshots of net worth go back far enough, a card also shows its change since a month,
 * a quarter and a year before, against the snapshot of that day: a change in balance or value, not a profit (invested or taken
 * out is in it). Mutual funds are never cash; cash, deposits and funds are never added into one figure called cash.
 *
 * Pure: no I/O. Every figure comes from what the page already worked out (classCards, foreignCash, net worth by kind and person,
 * the snapshots), so it always agrees with the cards below it.
 */
import type { ClassCard } from './home';
import type { ForeignCash } from './foreign-cash';

export type PositionStatus = 'actual' | 'estimated' | 'partial' | 'unavailable';

export interface PositionChange {
  /** the snapshot it is measured against */
  since: string;
  amount: number;
  /** of the earlier value; null when that was zero or less (a percentage would mislead) */
  pct: number | null;
}

export interface PositionLine {
  label: string;
  value: number | null;
  note?: string;
  /** the records behind this line (a person's holdings) */
  href?: string;
  /** this line's own change since a month, a quarter and a year before */
  changes?: PositionCard['changes'];
  /** a sentence rather than a figure: drawn across the card, not as label and value */
  wide?: boolean;
}

export interface PositionCard {
  key: string;
  label: string;
  /** the headline figure in rupees; null when it cannot be worked out */
  value: number | null;
  /** a figure in another currency, shown before the rupee one (cash in SGD) */
  native?: { currency: string; amount: number } | null;
  /** what is counted, in one sentence */
  basis: string;
  /** a few more figures: "Principal ₹…", "Interest earned so far ₹…" */
  lines: PositionLine[];
  status: PositionStatus;
  /** the date the figure holds for */
  asOf: string | null;
  /** where the records behind it are */
  href: string;
  /** change since a month, a quarter and a year before; null where no snapshot goes back that far, or none applies */
  changes: {
    month: PositionChange | null;
    quarter: PositionChange | null;
    year: PositionChange | null;
  } | null;
}

export interface PositionSnapshot {
  date: string;
  total: number;
  byType: Record<string, number>;
  byOwner: Record<string, number>;
}

export interface MoneyPositionInput {
  today: string;
  total: number;
  byType: Partial<Record<string, number>>;
  byOwner: Record<string, number>;
  ownerName: Record<string, string>;
  /** the four cards under the headline (deposits, funds, cash, others) */
  classes: ClassCard[];
  /** the foreign-currency part of cash, with the rate and its date */
  foreign: ForeignCash[];
  /** deposits by days to maturity, for the maturity lines */
  maturities: { daysLeft: number; amount: number }[];
  /** the maturity windows in days, from Settings (deposits.maturityAlertDays) */
  maturityWindows: readonly number[];
  /** how many records are out of date or missing, of how many */
  freshness: { stale: number; missing: number; total: number };
  /** monthly spending from the retirement plan (rupees); null or 0 when none is entered */
  monthlySpending: number | null;
  snapshots: PositionSnapshot[];
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const longDate = (iso: string) =>
  `${Number(iso.slice(8, 10))} ${MON[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
const back = (iso: string, months: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
};

/** The change of a figure since the latest snapshot on or before each of a month, a quarter and a year ago. */
export function changesSince(
  today: string,
  now: number,
  snapshots: PositionSnapshot[],
  pick: (s: PositionSnapshot) => number | undefined,
): PositionCard['changes'] {
  const sorted = [...snapshots].sort((a, b) => a.date.localeCompare(b.date));
  const at = (months: number): PositionChange | null => {
    const cut = back(today, months);
    const s = [...sorted].reverse().find((x) => x.date <= cut);
    if (!s) return null;
    const then = pick(s);
    if (then === undefined) return null;
    return { since: s.date, amount: now - then, pct: then > 0 ? (now - then) / then : null };
  };
  return { month: at(1), quarter: at(3), year: at(12) };
}

export function moneyPosition(i: MoneyPositionInput): PositionCard[] {
  const cls = (k: ClassCard['key']) => i.classes.find((c) => c.key === k);
  const fd = cls('fd');
  const funds = cls('funds');
  const cash = cls('cash');
  const t = (k: string) => i.byType[k] ?? 0;
  const ch = (pick: (s: PositionSnapshot) => number | undefined, now: number) =>
    changesSince(i.today, now, i.snapshots, pick);
  const foreignInr = i.foreign.reduce((s, f) => s + f.inr, 0);
  const cashAll = cash?.current ?? 0;
  const cashInr = cashAll - foreignInr;
  const cards: PositionCard[] = [];

  cards.push({
    key: 'networth',
    label: 'Net worth, the family',
    value: i.total,
    basis:
      'Everything counted today: cash, deposits, funds and the rest; insurance cover is never wealth.',
    lines: [],
    status: 'actual',
    asOf: i.today,
    href: '/',
    changes: ch((s) => s.total, i.total),
  });
  const owners = Object.entries(i.byOwner).sort((a, b) => b[1] - a[1]);
  if (owners.length > 0)
    cards.push({
      key: 'people',
      label: 'Net worth by person',
      value: null,
      basis:
        'What is held in each person’s name (a joint holding counts with its first holder). Together they make the family’s net worth.',
      lines: owners.map(([owner, amount]) => ({
        label: i.ownerName[owner] ?? 'One of you',
        value: amount,
        href: `/accounts?p=${owner}`,
        changes: ch((s) => s.byOwner[owner], amount),
      })),
      status: 'actual',
      asOf: i.today,
      href: '/accounts',
      changes: null,
    });

  cards.push({
    key: 'cash-inr',
    label: 'Cash in rupees',
    value: cashInr,
    basis:
      'Savings and current accounts in India, at today’s estimated balance. Deposits and funds are not cash.',
    lines: [],
    status: cash?.estimated ? 'estimated' : 'actual',
    asOf: i.today,
    href: '/cash',
    // snapshots hold all bank balances together: the change of rupee cash alone cannot be told for past days
    changes: null,
  });
  for (const f of i.foreign)
    cards.push({
      key: `cash-${f.currency.toLowerCase()}`,
      label: `Cash in ${f.currency}`,
      value: f.inr,
      native: { currency: f.currency, amount: f.native },
      basis: `Accounts held in ${f.currency}, shown in their own currency first; the rupee value is that amount at the rate shown, as net worth counts it.`,
      lines: [
        {
          label: 'Rate used',
          value: null,
          wide: true,
          note: `₹${Number(f.rate.toFixed(4))} per ${f.currency}, ${f.rateLive ? 'the daily rate on file' : 'the rate recorded with the balance'}${f.rateDate ? ` of ${longDate(f.rateDate)}` : ''}`,
        },
      ],
      status: 'actual',
      asOf: f.asOf,
      href: '/cash',
      changes: null,
    });
  cards.push({
    key: 'cash-all',
    label: 'All cash, in rupees',
    value: cashAll,
    basis:
      i.foreign.length > 0
        ? 'Cash in rupees plus the foreign cash at the rates shown on its cards.'
        : 'Savings and current accounts.',
    lines: [],
    status: cash?.estimated ? 'estimated' : 'actual',
    asOf: i.today,
    href: '/cash',
    changes: ch((s) => s.byType.bank_account, t('bank_account')),
  });

  const soon = (days: number) => {
    const m = i.maturities.filter((x) => x.daysLeft >= 0 && x.daysLeft <= days);
    return { count: m.length, amount: m.reduce((s, x) => s + x.amount, 0) };
  };
  cards.push({
    key: 'fd',
    label: 'Fixed deposits',
    value: fd?.current ?? 0,
    basis:
      'Running deposits: the principal, and the interest earned so far worked out from each deposit’s terms. A deposit past its date is not counted twice: its money is in the account it was paid into.',
    lines: [
      { label: 'Principal', value: fd?.invested ?? 0 },
      { label: 'Interest earned so far (estimated)', value: fd ? fd.current - fd.invested : 0 },
      { label: 'Pays at maturity', value: fd?.maturity ?? 0 },
      ...[...i.maturityWindows]
        .sort((a, b) => a - b)
        .map((d) => {
          const s = soon(d);
          return {
            label: `Maturing in ${d} days`,
            value: s.amount,
            note: `${s.count} deposit${s.count === 1 ? '' : 's'}`,
          };
        }),
    ],
    status: 'estimated',
    asOf: i.today,
    href: '/deposits',
    changes: ch((s) => s.byType.fixed_deposit, t('fixed_deposit')),
  });

  cards.push({
    key: 'funds',
    label: 'Mutual funds',
    value: funds?.current ?? 0,
    basis:
      'Units held × the latest price. The cost is what the units still held cost (first in, first out), not all money ever invested.',
    lines: [
      { label: 'Cost of the units held', value: funds?.invested ?? 0 },
      { label: 'Profit', value: funds ? funds.current - funds.invested : 0 },
    ],
    status: funds?.estimated ? 'estimated' : 'actual',
    asOf: i.today,
    href: '/investments',
    changes: ch((s) => s.byType.mutual_fund, t('mutual_fund')),
  });

  const liquid = cashAll + (fd?.current ?? 0) + (funds?.current ?? 0);
  cards.push({
    key: 'liquid',
    label: 'Liquid financial assets',
    value: liquid,
    basis:
      'All cash, fixed deposits (they can be broken, usually with a small penalty) and mutual funds (paid out in one to three working days). Not counted: property, money lent, retirement accounts and anything held by others.',
    lines: [
      { label: 'Cash', value: cashAll },
      { label: 'Fixed deposits', value: fd?.current ?? 0 },
      { label: 'Mutual funds', value: funds?.current ?? 0 },
    ],
    status: 'actual',
    asOf: i.today,
    href: '/raise',
    changes: ch(
      (s) =>
        (s.byType.bank_account ?? 0) + (s.byType.fixed_deposit ?? 0) + (s.byType.mutual_fund ?? 0),
      t('bank_account') + t('fixed_deposit') + t('mutual_fund'),
    ),
  });

  cards.push({
    key: 'lent',
    label: 'Money lent',
    value: t('receivable'),
    basis: 'What is still owed to the family: lent less what has been paid back.',
    lines: [],
    status: 'actual',
    asOf: i.today,
    href: '/others?tab=lent',
    changes: ch((s) => s.byType.receivable, t('receivable')),
  });
  cards.push({
    key: 'property',
    label: 'Property',
    value: t('property'),
    basis:
      'The last value recorded for each property; it changes only when a new value is entered.',
    lines: [],
    status: 'actual',
    asOf: i.today,
    href: '/others?tab=property',
    changes: ch((s) => s.byType.property, t('property')),
  });
  const retirement = t('nps') + t('ulip');
  cards.push({
    key: 'retirement',
    label: 'Retirement and insurance-linked savings',
    value: retirement,
    basis:
      'Pension accounts (NPS) and unit-linked policies: their recorded value, not the insurance cover.',
    lines: [],
    status: 'actual',
    asOf: i.today,
    href: '/others?tab=property',
    changes: ch((s) => (s.byType.nps ?? 0) + (s.byType.ulip ?? 0), retirement),
  });
  const otherHeld = t('stock') + t('third_party_held') + t('other');
  if (otherHeld !== 0)
    cards.push({
      key: 'other',
      label: 'Other holdings',
      value: otherHeld,
      basis: 'Shares, money held by others for you and anything else counted.',
      lines: [],
      status: 'actual',
      asOf: i.today,
      href: '/others?tab=property',
      changes: ch(
        (s) => (s.byType.stock ?? 0) + (s.byType.third_party_held ?? 0) + (s.byType.other ?? 0),
        otherHeld,
      ),
    });

  cards.push({
    key: 'cover',
    label: 'Months of spending the cash covers',
    value: null,
    basis:
      i.monthlySpending && i.monthlySpending > 0
        ? `All cash divided by the monthly spending in the retirement plan (₹${Math.round(i.monthlySpending).toLocaleString('en-IN')} a month).`
        : 'Needs your monthly spending: enter it once in the retirement plan (Retire). Nothing else is needed.',
    lines:
      i.monthlySpending && i.monthlySpending > 0
        ? [
            {
              label: 'Cash alone',
              value: null,
              note: `${(cashAll / i.monthlySpending).toFixed(1)} months`,
            },
            {
              label: 'With deposits and funds',
              value: null,
              note: `${(liquid / i.monthlySpending).toFixed(1)} months`,
            },
          ]
        : [],
    status: i.monthlySpending && i.monthlySpending > 0 ? 'actual' : 'unavailable',
    asOf: i.today,
    href: '/retire',
    changes: null,
  });

  const behind = i.freshness.stale + i.freshness.missing;
  cards.push({
    key: 'stale',
    label: 'Records out of date',
    value: null,
    basis: `Balances and values not updated within their expected window, or never recorded: ${behind} of ${i.freshness.total}. They are still counted, at their last value.`,
    lines: [
      { label: 'Out of date', value: null, note: String(i.freshness.stale) },
      { label: 'Never recorded', value: null, note: String(i.freshness.missing) },
    ],
    status: behind > 0 ? 'partial' : 'actual',
    asOf: i.today,
    href: '/cash',
    changes: null,
  });
  return cards;
}
