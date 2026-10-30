/**
 * The "?" explainers of the Accounts, Deposits and Cash overviews. The three panels share one object (bankOverview) and the same
 * kinds of figure, so one builder explains a kind of figure and each page maps its own ids to the kinds it shows. Pure: it only puts
 * the overview's numbers and a few facts (balance dates, where each savings rate came from) into words.
 */
import {
  explain,
  exDate,
  exInr,
  exPct,
  exPlural,
  exRange,
  exSigned,
  exSignedPct,
  levelOfShare,
  ratioHow,
  type Explain,
  type ExplainInput,
  type ExplainLevel,
  type ExplainSet,
} from './explain';
import type { BankGrowth } from './bank-growth';
import { TERMS } from './terms';
import type { BankOverview } from './bank-overview';
import { maturedRuleText } from './deposit-state';
import { foreignExplain } from './foreign-cash';
import { formatInrCompact } from './money';

export interface BankFacts {
  today: string;
  /** the person the page is narrowed to, if any */
  scope: string | null;
  /** the savings balances behind the figures: how many, the dates they were recorded, how many are older than their window */
  balances: { count: number; oldest: string | null; newest: string | null; stale: number };
  /** where each savings rate came from: set on the account, read from the bank's rates, or assumed */
  rates: { own: number; market: number; assumed: number; assumedRate: number; tds: number };
  fd: { count: number; firstBooked: string | null; lastMaturity: string | null };
  /** deposit insurance across every bank and name (the person filter does not narrow it) */
  cover: { limit: number; uninsured: number; banksOver: number } | null;
  toConfirm: number;
  /** deposits only: banks and the maturity years */
  banks: { name: string; amount: number; share: number; count: number }[];
  ladder: { year: string | number; amount: number; count: number }[];
  cash: {
    interestYear: number;
    avgRate: number | null;
    largest: { code: string; bank: string; amount: number } | null;
  } | null;
  /** how the money in banks is growing (bank-growth.ts); null or absent when it could not be worked out */
  growth?: BankGrowth | null;
  links: {
    monthly: string;
    accounts: string;
    deposits: string;
    cash: string;
    maturities: string;
    cover: string;
    rates: string;
    settings: string;
  };
}

export type BankKind =
  | 'total'
  | 'profit'
  | 'today'
  | 'sinceLast'
  | 'journey'
  | 'where'
  | 'fdPart'
  | 'cashPart'
  | 'invested'
  | 'maturity'
  | 'toEarn'
  | 'next'
  | 'soon'
  | 'toConfirm'
  | 'largestBank'
  | 'largestBalance'
  | 'cover'
  | 'updated'
  | 'people'
  | 'types'
  | 'banks'
  | 'ladder'
  | 'interestYear'
  | 'earns'
  | 'stale'
  | 'grand'
  | 'growth'
  | 'fdXirr'
  | 'savingsRate'
  | 'interestFy'
  | 'avgRate';

type Page = 'accounts' | 'deposits' | 'cash';

const WORD: Record<Page, { thing: string; pageName: string; lines: string }> = {
  accounts: { thing: 'money in banks', pageName: 'Accounts', lines: 'accounts and deposits' },
  deposits: { thing: 'fixed deposits', pageName: 'Deposits', lines: 'deposits' },
  cash: { thing: 'savings and cash', pageName: 'Cash', lines: 'savings accounts' },
};

/** How the savings part of a figure is known: the balance as last recorded, moved forward by an estimated rate. */
function savingsBasis(f: BankFacts) {
  const old = f.balances.stale;
  return {
    recorded: `${exPlural(f.balances.count, 'savings balance')} as last recorded${f.balances.oldest ? ` (${exRange(f.balances.oldest, f.balances.newest)})` : ''}`,
    old,
  };
}

function rateInputs(f: BankFacts): ExplainInput[] {
  const n = f.rates.own + f.rates.market + f.rates.assumed;
  if (n === 0) return [];
  return [
    {
      label: 'Savings rate used',
      value: `${f.rates.own} set on the account, ${f.rates.market} from the bank’s rates, ${f.rates.assumed} assumed`,
      basis: f.rates.assumed > 0 ? 'estimated' : 'recorded',
      count: { n: f.rates.assumed, of: n, noun: 'accounts on the assumed rate' },
      note:
        f.rates.assumed > 0
          ? `the assumed savings rate of ${exPct(f.rates.assumedRate, 2)} from Settings is used where no rate is known`
          : undefined,
    },
  ];
}

/** One input per foreign currency: its balance in its own money, what it is worth in rupees, and the rate with its date. */
function foreignInputs(o: BankOverview): ExplainInput[] {
  return (foreignExplain(o.foreign)?.lines ?? []).map((l) => ({
    label: l.label,
    value: l.value,
    basis: 'calculated' as const,
    to: l.to,
    note: `${l.note}${l.live ? '' : ' (no rate on file)'}`,
  }));
}

const levelFor = (o: BankOverview, _f: BankFacts): ExplainLevel => {
  const est = Math.max(0, o.parts.cash.current - o.parts.cash.invested);
  return levelOfShare(est > 0.5 ? est : 0, o.current > 0 ? o.current : 1);
};

export function bankFigure(
  kind: BankKind,
  id: string,
  page: Page,
  o: BankOverview,
  f: BankFacts,
): Explain {
  const w = WORD[page];
  const scope = f.scope ? ` (${f.scope}’s)` : '';
  const sb = savingsBasis(f);
  const cashEst = Math.max(0, o.parts.cash.current - o.parts.cash.invested);
  const fdAccrued = o.parts.fd.current - o.parts.fd.invested;
  const partsInputs = (): ExplainInput[] => {
    const out: ExplainInput[] = [];
    if (page !== 'cash' && o.parts.fd.count > 0)
      out.push(
        {
          label: 'Deposit principal invested',
          value: exInr(o.parts.fd.invested),
          basis: 'recorded',
          from: f.fd.firstBooked,
          to: f.today,
          count: { n: o.parts.fd.count, noun: 'deposits' },
        },
        {
          label: 'Interest added to deposits so far, from their own terms',
          value: exInr(fdAccrued),
          basis: 'calculated',
          to: f.today,
        },
      );
    if (page !== 'deposits' && o.parts.cash.count > 0)
      out.push(
        {
          label: sb.recorded.charAt(0).toUpperCase() + sb.recorded.slice(1),
          value: exInr(o.parts.cash.invested),
          basis: 'recorded',
          from: f.balances.oldest,
          to: f.balances.newest,
          count: { n: o.parts.cash.count, noun: 'accounts' },
        },
        {
          label: 'Interest estimated since those balances',
          value: exInr(cashEst),
          basis: 'estimated',
          to: f.today,
          note: `balance × rate, after ${exPct(f.rates.tds, 0)} tax at source`,
        },
      );
    if (page === 'accounts' && o.parts.others.count > 0)
      out.push({
        label: 'Money held by others, other holdings',
        value: exInr(o.parts.others.current),
        basis: 'recorded',
        count: { n: o.parts.others.count, noun: 'holdings' },
      });
    return out;
  };

  const staleNote =
    f.balances.stale > 0
      ? `${exPlural(f.balances.stale, 'savings balance')} ${f.balances.stale === 1 ? 'is' : 'are'} older than ${f.balances.stale === 1 ? 'its' : 'their'} refresh window, so ${f.balances.stale === 1 ? 'its' : 'their'} interest is estimated over a long stretch.`
      : null;
  const monthlyFix = { label: 'Update balances', href: f.links.monthly };

  switch (kind) {
    case 'total': {
      return explain({
        id,
        title: `${w.thing.charAt(0).toUpperCase()}${w.thing.slice(1)} today${scope}`,
        exact: exInr(o.current),
        shown: formatInrCompact(o.current),
        what: `What the ${w.thing} are worth now.`,
        how: [
          page !== 'cash' && o.parts.fd.count > 0
            ? `each deposit’s current value from its own rate and terms ${exInr(o.parts.fd.current)}`
            : null,
          page !== 'deposits' && o.parts.cash.count > 0
            ? `each savings balance as last recorded ${exInr(o.parts.cash.invested)} plus interest estimated since ${exInr(cashEst)}`
            : null,
          page === 'accounts' && o.parts.others.count > 0
            ? `other holdings at their recorded value ${exInr(o.parts.others.current)}`
            : null,
        ]
          .filter(Boolean)
          .join(' + ')
          .concat(` = ${exInr(o.current)} over ${exPlural(o.accounts + o.deposits, 'line')}.`),
        inputs: [
          ...partsInputs(),
          ...(page !== 'deposits' ? rateInputs(f) : []),
          ...(page !== 'deposits' ? foreignInputs(o) : []),
        ],
        level: page === 'deposits' ? 'complete' : levelFor(o, f),
        completeness:
          page === 'deposits'
            ? `Every deposit is valued from its own terms (rate, dates, how interest is added) on ${exDate(f.today)}.`
            : cashEst > 0.5
              ? `${exInr(cashEst)} of ${exInr(o.current)} is interest estimated since the balances were recorded (${exRange(f.balances.oldest, f.today)}); the rest is recorded or worked out from deposit terms.`
              : 'Every figure is recorded or worked out from deposit terms.',
        notes: [
          staleNote,
          `${maturedRuleText()} Foreign-currency balances are counted at today’s rupee value.`,
          page !== 'deposits' ? (foreignExplain(o.foreign)?.sentence ?? null) : null,
        ],
        fix: f.balances.stale > 0 || cashEst > 0.5 ? monthlyFix : undefined,
      });
    }
    case 'profit':
    case 'sinceLast': {
      const title = kind === 'profit' ? 'Profit' : 'Since the last balances';
      const base = o.invested;
      return explain({
        id,
        title,
        exact: exSigned(o.profit),
        what:
          kind === 'profit'
            ? `What the ${w.thing} have earned on the amount invested.`
            : 'How much today’s estimate is above the balances last recorded.',
        how:
          `${exInr(o.current)} current value − ${exInr(base)} ${kind === 'profit' ? 'invested' : 'last recorded'} = ${exSigned(o.profit)}. ` +
          (o.profitPct === null
            ? 'Nothing is invested, so no percentage.'
            : `As a share of the amount ${kind === 'profit' ? 'invested' : 'last recorded'}: ${ratioHow({ label: 'profit', amount: o.profit }, { label: kind === 'profit' ? 'invested' : 'last recorded', amount: base })}.`),
        inputs: [
          {
            label: 'Current value',
            value: exInr(o.current),
            basis: page === 'deposits' ? 'calculated' : 'estimated',
            to: f.today,
          },
          {
            label:
              kind === 'profit'
                ? 'Invested: deposit amounts and last balances recorded'
                : 'Balances last recorded',
            value: exInr(base),
            basis: 'recorded',
            from: f.balances.oldest ?? f.fd.firstBooked,
            to: f.balances.newest,
          },
        ],
        level: page === 'deposits' ? 'complete' : levelFor(o, f),
        completeness:
          page === 'deposits'
            ? 'Interest on each deposit is worked out from its own terms.'
            : `Savings profit is interest estimated at ${f.rates.assumed > 0 ? 'rates of which some are assumed' : 'the rates in force'}; banks credit interest in lumps, so the real figure moves in steps.`,
        notes: [
          staleNote,
          'Money added or withdrawn is not profit here: only the amount recorded as invested is the base.',
        ],
        fix: page === 'deposits' ? undefined : monthlyFix,
      });
    }
    case 'today': {
      const prior = o.current - o.today.change;
      return explain({
        id,
        title: 'Today’s change',
        exact: exSigned(o.today.change),
        what: 'What the lines earned in the last day.',
        how: `Deposits: current value − value yesterday on each one’s own terms = ${exInr(o.today.fd)}. Savings: balance × rate × (1 − tax at source) ÷ 365 for one day = ${exInr(o.today.savings)}. Together ${exSigned(o.today.change)}${o.today.changePct === null ? '' : `; as a share of yesterday’s value: ${ratioHow({ label: 'earned', amount: o.today.change }, { label: 'yesterday’s value', amount: prior }, 3)}`}.`,
        inputs: [
          ...(page !== 'cash'
            ? [
                {
                  label: 'Deposits, one day on their own terms',
                  value: exInr(o.today.fd),
                  basis: 'calculated' as const,
                  to: f.today,
                },
              ]
            : []),
          ...(page !== 'deposits'
            ? [
                {
                  label: 'Savings, one day at each account’s rate',
                  value: exInr(o.today.savings),
                  basis: 'estimated' as const,
                  to: f.today,
                },
                ...rateInputs(f),
              ]
            : []),
        ],
        level: page === 'deposits' ? 'partly_estimated' : 'estimated',
        completeness:
          page === 'deposits'
            ? 'Worked out from each deposit’s terms; it keeps the “est.” mark because a bank pays on set dates, not a little each day.'
            : 'An estimate: it is not read from a bank, and banks credit savings interest in lumps.',
        notes: ['Money held by others and foreign-currency balances earn nothing in this figure.'],
      });
    }
    case 'journey': {
      const j = o.interest;
      return explain({
        id,
        title: 'From invested to maturity',
        what: 'How much of the interest the deposits will ever pay has already been earned.',
        how:
          j.journey === null
            ? 'No deposit has interest left to earn, so there is no journey to show.'
            : `Earned so far ${exInr(j.earned)} ÷ (maturity ${exInr(o.maturity)} − invested ${exInr(o.invested)} = ${exInr(j.total)} in all) = ${exPct(j.journey, 0)}. ${exInr(j.toEarn)} is still to come.`,
        inputs: [
          {
            label: 'Invested',
            value: exInr(o.invested),
            basis: 'recorded',
            from: f.fd.firstBooked,
            to: f.today,
          },
          {
            label: 'Current value',
            value: exInr(o.current),
            basis: page === 'deposits' ? 'calculated' : 'estimated',
            to: f.today,
          },
          {
            label: 'Maturity value (what each deposit pays on its date)',
            value: exInr(o.maturity),
            basis: 'calculated',
            to: f.fd.lastMaturity,
          },
        ],
        level: page === 'deposits' ? 'complete' : levelFor(o, f),
        completeness:
          page === 'deposits'
            ? 'Every figure comes from the deposits’ own terms.'
            : 'Deposits are calculated; savings and holdings have no maturity and are counted at current value.',
        notes: [],
      });
    }
    case 'where': {
      return explain({
        id,
        title: 'Where the money sits',
        what: 'How the money splits between savings and cash, fixed deposits and other holdings.',
        how: `Each part’s current value ÷ the total ${exInr(o.current)}: ${o.where.map((x) => `${x.label} ${exInr(x.amount)} = ${exPct(x.share, 0)}`).join('; ')}.`,
        inputs: o.where
          .filter((x) => x.amount > 0)
          .map((x) => ({
            label: x.label,
            value: exInr(x.amount),
            basis: x.key === 'fd' ? ('calculated' as const) : ('recorded' as const),
            to: f.today,
            count: { n: x.count, noun: 'lines' },
          })),
        level: levelFor(o, f),
        completeness: 'The same lines as the total above, counted once.',
        notes: [],
      });
    }
    case 'fdPart':
    case 'cashPart': {
      const isFd = kind === 'fdPart';
      const p = isFd ? o.parts.fd : o.parts.cash;
      return explain({
        id,
        title: isFd ? 'Fixed deposits today' : 'Savings and cash',
        exact: exInr(p.current),
        what: isFd
          ? 'What the running fixed deposits are worth now.'
          : 'What the savings accounts are worth now.',
        how: isFd
          ? `Each deposit’s value on its own terms = ${exInr(p.current)}: ${exInr(p.invested)} invested, ${exInr(p.maturity)} at maturity${o.fdRate !== null ? `, ${exPct(o.fdRate, 2)} a year on average (weighted by amount invested)` : ''}.`
          : `Each balance last recorded ${exInr(p.invested)} plus interest estimated since ${exInr(cashEst)} = ${exInr(p.current)}.`,
        inputs: isFd
          ? [
              {
                label: 'Deposits',
                value: exInr(p.current),
                basis: 'calculated',
                from: f.fd.firstBooked,
                to: f.today,
                count: { n: p.count, noun: 'deposits' },
              },
            ]
          : [
              {
                label: 'Balances last recorded',
                value: exInr(p.invested),
                basis: 'recorded',
                from: f.balances.oldest,
                to: f.balances.newest,
                count: { n: p.count, noun: 'accounts' },
              },
              ...rateInputs(f),
              ...foreignInputs(o),
            ],
        level: isFd ? 'complete' : cashEst > 0.5 ? 'partly_estimated' : 'complete',
        completeness: isFd
          ? 'Worked out from each deposit’s contract terms.'
          : `${exInr(cashEst)} of it is interest estimated since the balances were recorded.`,
        notes: [
          isFd ? null : staleNote,
          isFd ? null : (foreignExplain(o.foreign)?.sentence ?? null),
        ],
        fix: isFd ? undefined : monthlyFix,
      });
    }
    case 'invested':
      return explain({
        id,
        title: 'Invested',
        exact: exInr(o.invested),
        what: 'The amount invested: the principal of each running deposit.',
        how: `Principal of ${exPlural(o.deposits, 'running deposit')} added = ${exInr(o.invested)}. Interest is not in it.`,
        inputs: [
          {
            label: 'Deposit principal',
            value: exInr(o.invested),
            basis: 'recorded',
            from: f.fd.firstBooked,
            to: f.today,
            count: { n: o.deposits, noun: 'deposits' },
          },
        ],
        level: 'complete',
        completeness: 'The principal is the amount recorded when each deposit was added.',
        notes: [maturedRuleText()],
      });
    case 'maturity':
      return explain({
        id,
        title: 'Maturity value',
        exact: exInr(o.maturity),
        what: 'What the deposits pay on their dates, including all their interest.',
        how: `Each deposit’s maturity amount added = ${exInr(o.maturity)}, which is ${exInr(o.interest.total)} of interest over the life of the deposits on ${exInr(o.invested)} invested.`,
        inputs: [
          {
            label: 'Maturity amounts',
            value: exInr(o.maturity),
            basis: 'calculated',
            to: f.fd.lastMaturity,
            count: { n: o.deposits, noun: 'deposits' },
          },
        ],
        level: 'complete',
        completeness: 'Worked out from each deposit’s rate, dates and how interest is added.',
        notes: ['Tax on the interest and any early-break penalty are not taken off.'],
      });
    case 'toEarn':
      return explain({
        id,
        title: 'Interest still to earn',
        exact: exInr(o.interest.toEarn),
        what: 'The interest the deposits will still add before they all mature.',
        how: `Maturity value ${exInr(o.maturity)} − current value ${exInr(o.current)} = ${exInr(o.interest.toEarn)}.`,
        inputs: [
          {
            label: 'Maturity value',
            value: exInr(o.maturity),
            basis: 'calculated',
            to: f.fd.lastMaturity,
          },
          {
            label: 'Current value',
            value: exInr(o.current),
            basis: page === 'deposits' ? 'calculated' : 'estimated',
            to: f.today,
          },
        ],
        level: page === 'deposits' ? 'complete' : levelFor(o, f),
        completeness:
          'Deposits are calculated from their terms; savings and holdings have nothing more to earn in this figure.',
        notes: [],
      });
    case 'next':
      return explain({
        id,
        title: 'Next maturity',
        exact: o.next ? exInr(o.next.amount) : undefined,
        what: 'The first deposit date coming up and what is paid on it.',
        how: o.next
          ? `${o.next.count > 1 ? `${o.next.count} deposits` : '1 deposit'} mature on ${exDate(o.next.date)} (${o.next.days === 0 ? 'today' : `in ${exPlural(o.next.days, 'day')}`}), paying ${exInr(o.next.amount)} at ${o.next.bank}.`
          : 'No deposit is running.',
        inputs: [
          {
            label: 'Maturity date and amount',
            value: o.next ? `${exDate(o.next.date)} · ${exInr(o.next.amount)}` : 'none',
            basis: o.next ? 'calculated' : 'missing',
            to: o.next?.date,
          },
        ],
        level: o.next ? 'complete' : 'missing',
        completeness: o.next
          ? 'From the deposit’s recorded dates and terms.'
          : 'No running deposit.',
        notes: [],
        fix: { label: 'See all maturities', href: f.links.maturities },
      });
    case 'soon':
      return explain({
        id,
        title: `Maturing in ${exPlural(o.soon.days, 'day')}`,
        exact: o.soon.count > 0 ? exInr(o.soon.amount) : undefined,
        what: 'Deposits that fall due within the “soon” window.',
        how: `Maturity amounts of the ${exPlural(o.soon.count, 'deposit')} due on or before ${exDate(f.today)} + ${exPlural(o.soon.days, 'day')} = ${exInr(o.soon.amount)}. The window is a Settings value.`,
        inputs: [
          {
            label: 'Deposits due soon',
            value: exInr(o.soon.amount),
            basis: 'calculated',
            from: f.today,
            count: { n: o.soon.count, noun: 'deposits' },
          },
        ],
        level: 'complete',
        completeness: 'From each deposit’s recorded maturity date.',
        notes: [],
        fix: { label: 'See maturities', href: f.links.maturities },
      });
    case 'toConfirm':
      return explain({
        id,
        title: 'To confirm',
        what: 'Deposits past their date that are still listed as running.',
        how: `${exPlural(f.toConfirm, 'deposit')} ${f.toConfirm === 1 ? 'has' : 'have'} passed ${f.toConfirm === 1 ? 'its' : 'their'} date and wait for you to confirm the deposit has matured. ${f.toConfirm === 1 ? 'It is' : 'They are'} left out of these figures: the money counts in the savings account or new deposit it went to.`,
        inputs: [
          {
            label: 'Matured, not confirmed',
            value: String(f.toConfirm),
            basis: f.toConfirm > 0 ? 'missing' : 'recorded',
          },
        ],
        level: f.toConfirm > 0 ? 'partly_estimated' : 'complete',
        completeness:
          f.toConfirm > 0
            ? 'The totals leave these deposits out until confirmed.'
            : 'Nothing waits for confirmation.',
        notes: [maturedRuleText()],
        fix: { label: 'Confirm them', href: f.links.maturities },
      });
    case 'largestBank': {
      const b = o.topBank;
      return explain({
        id,
        title: 'Largest bank',
        exact: b ? exInr(b.amount) : undefined,
        what: 'The share of the money in banks that sits in one bank.',
        how: b
          ? `${b.name} holds ${exInr(b.amount)} ÷ ${exInr(b.amount / (b.share || 1))} in all banks = ${exPct(b.share, 0)}.`
          : 'No bank has money yet.',
        inputs: [
          {
            label: b?.name ?? 'Bank',
            value: b ? exInr(b.amount) : 'none',
            basis: b ? 'recorded' : 'missing',
            to: f.today,
          },
        ],
        level: b ? levelFor(o, f) : 'missing',
        completeness: b
          ? 'Each bank’s total is the same as in its own block.'
          : 'No bank is recorded.',
        notes: ['Holdings with no bank (money held by others) are not a bank and are left out.'],
      });
    }
    case 'largestBalance': {
      const l = f.cash?.largest;
      return explain({
        id,
        title: 'Largest balance',
        exact: l ? exInr(l.amount) : undefined,
        what: 'The biggest single savings account.',
        how: l
          ? `Account ${l.code} at ${l.bank}: ${exInr(l.amount)} (last recorded balance moved forward by the estimated interest).`
          : 'No account is recorded.',
        inputs: [
          {
            label: l ? `${l.code} · ${l.bank}` : 'Account',
            value: l ? exInr(l.amount) : 'none',
            basis: l ? 'estimated' : 'missing',
            from: f.balances.oldest,
            to: f.today,
          },
        ],
        level: l ? levelFor(o, f) : 'missing',
        completeness: l
          ? 'The balance is the last one recorded plus estimated interest since.'
          : 'No account.',
        notes: [],
      });
    }
    case 'cover': {
      const c = f.cover ?? o.cover;
      return explain({
        id,
        title: 'Above the insured limit',
        exact: c ? exInr(c.uninsured) : undefined,
        what: 'Money in one bank, under one name, above the deposit-insurance limit.',
        how: c
          ? `For each bank and each ownership name, deposits and savings together (with interest) minus the limit ${exInr(c.limit)}; what is above it, added = ${exInr(c.uninsured)} in ${exPlural(c.banksOver, 'bank')}.`
          : 'No insurance limit is set.',
        inputs: [
          {
            label: 'Limit per bank and name',
            value: c ? exInr(c.limit) : 'not set',
            basis: c ? 'recorded' : 'missing',
            note: 'a Setting',
          },
        ],
        level: c ? 'complete' : 'missing',
        completeness: c
          ? 'Counted across every deposit and savings account of the household, including balances moved forward by interest; foreign banks are left out.'
          : 'Missing: the limit in Settings.',
        notes: ['Joint accounts are counted per ownership name.'],
        fix: { label: 'Open the cover check', href: f.links.cover },
      });
    }
    case 'updated':
      return explain({
        id,
        title: 'Balances updated this month',
        what: 'How many banks have had their balances recorded this month, and what still needs you.',
        how: `${o.banksDone} of ${exPlural(o.banks, 'bank')} are done. ${exPlural(o.staleBalances, 'balance')} ${o.staleBalances === 1 ? 'is' : 'are'} older than ${o.staleBalances === 1 ? 'its' : 'their'} window and ${exPlural(o.toConfirm, 'deposit')} ${o.toConfirm === 1 ? 'is' : 'are'} to confirm: ${exPlural(o.needsYou, 'item')} need you.`,
        inputs: [
          {
            label: 'Oldest balance recorded',
            value: exDate(o.oldestUpdate),
            basis: o.oldestUpdate ? 'recorded' : 'missing',
            to: o.oldestUpdate,
          },
        ],
        level: o.needsYou > 0 ? 'partly_estimated' : 'complete',
        completeness:
          o.needsYou > 0
            ? `${o.needsYou} lines rest on old or unconfirmed data.`
            : 'Every balance is within its refresh window.',
        notes: [],
        fix: monthlyFix,
      });
    case 'stale':
      return explain({
        id,
        title: 'Balances out of date',
        what: 'Savings balances older than their refresh window.',
        how: `${exPlural(f.balances.stale, 'balance')} ${f.balances.stale === 1 ? 'is' : 'are'} older than the window set in Settings; the oldest is dated ${exDate(f.balances.oldest)}. Their interest is estimated from that date.`,
        inputs: [
          {
            label: 'Oldest balance',
            value: exDate(f.balances.oldest),
            basis: f.balances.oldest ? 'recorded' : 'missing',
            to: f.balances.oldest,
          },
        ],
        level: f.balances.stale > 0 ? 'partly_estimated' : 'complete',
        completeness:
          f.balances.stale > 0 ? 'Update them on the Monthly update.' : 'All balances are recent.',
        notes: [],
        fix: monthlyFix,
      });
    case 'people':
      return explain({
        id,
        title: 'Whose money',
        what: `How the ${w.thing} split between the people.`,
        how: `Each person’s current value ÷ ${exInr(o.current)}: ${o.people.map((p) => `${exInr(p.current)} = ${exPct(p.share, 0)}`).join('; ')}. The ▲/▼ beside a person is their value less their invested amount.`,
        inputs: o.people.map((p, i) => ({
          label: `Person ${i + 1}`,
          value: exInr(p.current),
          basis: 'recorded' as const,
          to: f.today,
        })),
        level: levelFor(o, f),
        completeness: 'The same lines as the total, split by the holder.',
        notes: [],
      });
    case 'types':
      return explain({
        id,
        title: 'NRE and NRO',
        what: 'How the money splits between NRE, NRO and accounts with no type set.',
        how: `Each type’s value ÷ ${exInr(o.current)}: ${o.accountTypes.map((t) => `${t.label} ${exInr(t.amount)} = ${exPct(t.share, 0)}`).join('; ')}.`,
        inputs: o.accountTypes.map((t) => ({
          label: t.label,
          value: exInr(t.amount),
          basis: (t.key === 'unset' ? 'missing' : 'recorded') as 'missing' | 'recorded',
          to: f.today,
        })),
        level: o.accountTypes.some((t) => t.key === 'unset') ? 'partly_estimated' : 'complete',
        completeness: o.accountTypes.some((t) => t.key === 'unset')
          ? 'Some accounts have no NRE or NRO type set.'
          : 'Every account has its type.',
        notes: [],
        fix: o.accountTypes.some((t) => t.key === 'unset')
          ? { label: 'Set the type on the Accounts page', href: f.links.accounts }
          : undefined,
      });
    case 'banks':
      return explain({
        id,
        title: 'Which bank holds how much',
        what: `The ${w.thing} by bank.`,
        how: `Each bank’s current value ÷ ${exInr(o.current)}: ${f.banks
          .slice(0, 4)
          .map((b) => `${b.name} ${exInr(b.amount)} = ${exPct(b.share, 0)}`)
          .join('; ')}${f.banks.length > 4 ? ` and ${f.banks.length - 4} more` : ''}.`,
        inputs: f.banks.slice(0, 6).map((b) => ({
          label: b.name,
          value: exInr(b.amount),
          basis: (page === 'deposits' ? 'calculated' : 'recorded') as 'calculated' | 'recorded',
          to: f.today,
          count: { n: b.count, noun: 'lines' },
        })),
        level: page === 'deposits' ? 'complete' : levelFor(o, f),
        completeness:
          page === 'deposits'
            ? 'Worked out from each deposit’s terms.'
            : `${staleNote ?? 'Balances are within their window.'}`,
        notes: [],
      });
    case 'ladder':
      return explain({
        id,
        title: 'What matures, year by year',
        what: 'What the deposits pay on their dates, grouped by year.',
        how: `Each deposit’s maturity amount in the year it matures: ${f.ladder
          .slice(0, 5)
          .map((s) => `${s.year} ${exInr(s.amount)}`)
          .join('; ')}.`,
        inputs: f.ladder.slice(0, 6).map((s) => ({
          label: String(s.year),
          value: exInr(s.amount),
          basis: 'calculated' as const,
          count: { n: s.count, noun: 'deposits' },
        })),
        level: 'complete',
        completeness: 'From each deposit’s maturity date and amount.',
        notes: ['Interest is included; tax is not taken off.'],
      });
    case 'interestYear': {
      const c = f.cash;
      return explain({
        id,
        title: 'Interest a year',
        exact: c ? exInr(c.interestYear) : undefined,
        what: 'What the savings would earn in a year at today’s rates, after tax at source.',
        how: c
          ? `For each rupee account: balance × rate × (1 − ${exPct(f.rates.tds, 0)} tax at source), added = ${exInr(c.interestYear)}${c.avgRate !== null ? `, ${exPct(c.avgRate, 2)} on average` : ''}. A month is that ÷ 12, a day ÷ 365.`
          : 'No rate is known.',
        inputs: [
          ...rateInputs(f),
          {
            label: 'Balances',
            value: exInr(o.current),
            basis: 'estimated',
            from: f.balances.oldest,
            to: f.today,
          },
        ],
        level: f.rates.assumed > 0 ? 'estimated' : 'partly_estimated',
        completeness:
          f.rates.assumed > 0
            ? `An estimate: ${f.rates.assumed} of ${f.rates.own + f.rates.market + f.rates.assumed} accounts use the assumed rate of ${exPct(f.rates.assumedRate, 2)}.`
            : 'An estimate: rates are from the accounts or the bank’s published rates, but banks change them and credit interest in lumps.',
        notes: ['Money held by others and foreign-currency balances earn nothing here.'],
        fix: { label: 'See the rates list', href: f.links.rates },
      });
    }
    case 'earns':
      return bankFigure('interestYear', id, page, o, f);
    case 'growth':
    case 'fdXirr':
    case 'savingsRate':
    case 'interestFy':
    case 'avgRate':
      return growthFigure(kind, id, o, f);
    case 'grand':
      return explain({
        id,
        title: 'Grand total',
        exact: exInr(o.current),
        what: 'The total of every line shown, for the person chosen (or everyone).',
        how: `Invested ${exInr(o.invested)}, today ${exInr(o.current)}, at maturity ${exInr(o.maturity)}, over ${exPlural(o.accounts + o.deposits, 'line')}. It adds the same lines as the overview above.`,
        inputs: partsInputs(),
        level: page === 'deposits' ? 'complete' : levelFor(o, f),
        completeness:
          levelFor(o, f) === 'complete'
            ? 'Every line is recorded or calculated.'
            : `${exInr(cashEst)} is interest estimated since balances were recorded.`,
        notes: [],
      });
  }
}

/** The growth figures of the bank pages: Earning rate now of bank money, the deposits' XIRR, the savings' rate earned, the interest
 * earned this financial year and the average deposit rate. */
function growthFigure(
  kind: 'growth' | 'fdXirr' | 'savingsRate' | 'interestFy' | 'avgRate',
  id: string,
  o: BankOverview,
  f: BankFacts,
): Explain {
  const g = f.growth ?? null;
  const yr = (r: number | null | undefined) =>
    r === null || r === undefined ? '–' : `${exPct(r, 2)} a year`;
  const none = (title: string, what: string) =>
    explain({
      id,
      title,
      what,
      how: 'Shows once the records reach this financial year.',
      inputs: [],
      level: 'missing',
      completeness: 'Not worked out yet.',
      notes: [],
    });
  switch (kind) {
    case 'growth':
      if (!g?.banks) return none(TERMS.earningRate.label, TERMS.earningRate.hint);
      return explain({
        id,
        title: `${TERMS.earningRate.label}: money in banks`,
        exact: yr(g.banks.rate),
        what: 'What the money in banks earns a year at today’s rates: deposits at their XIRR, savings at the rate earned this year, weighted by how much is in each.',
        how: `Deposits ${exInr(o.parts.fd.current)} × ${yr(g.fd?.rate)} + savings ${exInr(o.parts.cash.current)} × ${yr(g.savings?.rate)} = ${exInr(g.banks.perYear)} a year ÷ ${exInr(o.parts.fd.current + o.parts.cash.current)} = ${yr(g.banks.rate)}.`,
        inputs: [
          {
            label: 'Fixed deposits',
            value: exInr(o.parts.fd.current),
            basis: 'calculated',
            to: f.today,
          },
          {
            label: 'Savings and cash',
            value: exInr(o.parts.cash.current),
            basis: 'estimated',
            to: f.today,
          },
        ],
        level: 'partly_estimated',
        completeness: 'The same rates as Home shows for deposits and savings.',
        notes: [],
      });
    case 'fdXirr':
      if (!g?.fd) return none(`${TERMS.xirr.label}: fixed deposits`, TERMS.xirr.hint);
      return explain({
        id,
        title: `${TERMS.xirr.label}: fixed deposits`,
        exact: yr(g.fd.rate),
        what: `${TERMS.xirr.hint} Each running deposit from its booking date to current value.`,
        how: `Each principal out on its booking day, current value of all of them (${exInr(o.parts.fd.current)}) back: ${yr(g.fd.rate)}. With interest added every quarter this is a little above the rates written on the deposits.`,
        inputs: [
          {
            label: 'Running deposits',
            value: exInr(o.parts.fd.invested),
            basis: 'calculated',
            from: f.fd.firstBooked,
            to: f.today,
            count: { n: o.parts.fd.count, noun: 'deposits' },
          },
        ],
        level: 'complete',
        completeness: 'Worked out from each deposit’s own terms.',
        notes: [],
        fix: { label: 'Open Deposits', href: f.links.deposits },
      });
    case 'savingsRate':
      if (!g?.savings) return none(`${TERMS.rateEarned.label}: savings`, TERMS.rateEarned.hint);
      return explain({
        id,
        title: `${TERMS.rateEarned.label}: savings`,
        exact: yr(g.savings.rate),
        what: TERMS.rateEarned.hint,
        how: `Interest earned since ${exDate(g.fyStart)} ${exInr(g.interestFy?.savings ?? 0)} on today’s balance ${exInr(o.parts.cash.current)}, made yearly: ${yr(g.savings.rate)}.`,
        inputs: [
          {
            label: 'Savings and cash today',
            value: exInr(o.parts.cash.current),
            basis: 'estimated',
            to: f.today,
          },
        ],
        level: 'estimated',
        completeness:
          'Savings are not an XIRR: money moves in and out daily, so the rate earned is the useful figure.',
        notes: [],
        fix: { label: 'See the rates list', href: f.links.rates },
      });
    case 'interestFy':
      if (!g?.interestFy)
        return none(`${TERMS.interestEarned.label} this FY`, TERMS.interestEarned.hint);
      return explain({
        id,
        title: `${TERMS.interestEarned.label} this FY`,
        exact: exInr(g.interestFy.total),
        what: `${TERMS.interestEarned.hint} Since ${exDate(g.fyStart)}.`,
        how: `Deposits ${exInr(g.interestFy.deposits)} + savings ${exInr(g.interestFy.savings)} = ${exInr(g.interestFy.total)}.`,
        inputs: [
          {
            label: 'Deposits',
            value: exInr(g.interestFy.deposits),
            basis: 'calculated',
            from: g.fyStart,
            to: f.today,
          },
          {
            label: 'Savings',
            value: exInr(g.interestFy.savings),
            basis: 'estimated',
            from: g.fyStart,
            to: f.today,
          },
        ],
        level: 'partly_estimated',
        completeness: 'The same figures as Home’s Earned this FY for deposits and savings.',
        notes: ['NRE interest is tax-free; NRO interest is taxed in India.'],
      });
    case 'avgRate': {
      const r = g?.rates;
      if (!r || r.all === null) return none(TERMS.averageRate.label, TERMS.averageRate.hint);
      return explain({
        id,
        title: TERMS.averageRate.label,
        exact: yr(r.all),
        what: TERMS.averageRate.hint,
        how: `Σ(principal × rate) ÷ Σ principal over the running deposits = ${yr(r.all)}.${r.nre ? ` NRE ${yr(r.nre.rate)} on ${exInr(r.nre.principal)} (tax-free).` : ''}${r.nro ? ` NRO ${yr(r.nro.rate)} on ${exInr(r.nro.principal)}, ${yr(r.nro.afterTax)} after tax.` : ''}`,
        inputs: [
          ...(r.nre
            ? [
                {
                  label: 'NRE deposits',
                  value: `${exInr(r.nre.principal)} · ${yr(r.nre.rate)}`,
                  basis: 'recorded' as const,
                  count: { n: r.nre.count, noun: 'deposits' },
                },
              ]
            : []),
          ...(r.nro
            ? [
                {
                  label: 'NRO deposits',
                  value: `${exInr(r.nro.principal)} · ${yr(r.nro.rate)}`,
                  basis: 'recorded' as const,
                  count: { n: r.nro.count, noun: 'deposits' },
                },
              ]
            : []),
        ],
        level: 'complete',
        completeness: 'From the rate written on each deposit.',
        notes: [
          TERMS.rateAfterTax.hint,
          ...(g?.savingsGap
            ? [
                `At this rate the savings would earn ${exInr(g.savingsGap)} more a year than they earn now.`,
              ]
            : []),
        ],
        fix: { label: 'See the rates list', href: f.links.rates },
      });
    }
  }
}

type FigPage = 'accounts' | 'deposits' | 'cash';
const MAPS: { [P in FigPage]: Record<string, BankKind> } = {
  accounts: {
    'accounts.total': 'total',
    'accounts.profit': 'profit',
    'accounts.today': 'today',
    'accounts.journey': 'journey',
    'accounts.where': 'where',
    'accounts.deposits': 'fdPart',
    'accounts.cash': 'cashPart',
    'accounts.toEarn': 'toEarn',
    'accounts.soon': 'soon',
    'accounts.growth': 'growth',
    'accounts.fdXirr': 'fdXirr',
    'accounts.savingsRate': 'savingsRate',
    'accounts.interestFy': 'interestFy',
    'accounts.avgRate': 'avgRate',
    'accounts.largestBank': 'largestBank',
    'accounts.cover': 'cover',
    'accounts.updated': 'updated',
    'accounts.people': 'people',
    'accounts.types': 'types',
    'accounts.grand': 'grand',
  },
  deposits: {
    'deposits.total': 'total',
    'deposits.profit': 'profit',
    'deposits.today': 'today',
    'deposits.journey': 'journey',
    'deposits.banks': 'banks',
    'deposits.ladder': 'ladder',
    'deposits.invested': 'invested',
    'deposits.maturity': 'maturity',
    'deposits.toEarn': 'toEarn',
    'deposits.next': 'next',
    'deposits.soon': 'soon',
    'deposits.toConfirm': 'toConfirm',
    'deposits.xirr': 'fdXirr',
    'deposits.interestFy': 'interestFy',
    'deposits.avgRate': 'avgRate',
    'deposits.largest': 'largestBank',
    'deposits.cover': 'cover',
    'deposits.people': 'people',
    'deposits.types': 'types',
  },
  cash: {
    'cash.total': 'total',
    'cash.sinceLast': 'sinceLast',
    'cash.today': 'today',
    'cash.earns': 'earns',
    'cash.banks': 'banks',
    'cash.interestYear': 'interestYear',
    'cash.largestBalance': 'largestBalance',
    'cash.largestBank': 'largestBank',
    'cash.stale': 'stale',
    'cash.people': 'people',
    'cash.types': 'types',
  },
};

function build<P extends FigPage>(page: P, o: BankOverview, f: BankFacts): ExplainSet<P> {
  return Object.fromEntries(
    Object.entries(MAPS[page]).map(([id, kind]) => [id, bankFigure(kind, id, page, o, f)]),
  ) as unknown as ExplainSet<P>;
}

export const buildAccountsExplain = (o: BankOverview, f: BankFacts) => build('accounts', o, f);
export const buildDepositsExplain = (o: BankOverview, f: BankFacts) => build('deposits', o, f);
export const buildCashExplain = (o: BankOverview, f: BankFacts) => build('cash', o, f);
void exSignedPct;
