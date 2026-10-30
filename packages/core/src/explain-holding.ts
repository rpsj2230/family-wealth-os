/**
 * The "?" explainers of the headline on one fixed deposit's page and one savings account's page (money words v6). They take the figures
 * the page draws (holding-headline.ts) and say how each was worked out with the numbers plugged in; they never work a figure out again.
 * Pure.
 */
import { explain, exDate, exInr, exPct, exSigned, ratioHow, type ExplainSet } from './explain';
import type { DepositHeadline, SavingsHeadline } from './holding-headline';
import { TERMS } from './terms';

const COMPOUND: Record<string, string> = {
  monthly: 'monthly',
  quarterly: 'quarterly',
  half_yearly: 'every half year',
  yearly: 'yearly',
  simple: 'never (simple interest)',
};

/** "added quarterly" or "paid out quarterly": how a deposit's interest is dealt with. */
export function depositInterestWords(h: Pick<DepositHeadline, 'payout' | 'compounding'>): string {
  if (h.payout !== 'cumulative')
    return `interest paid out ${COMPOUND[h.payout] ?? h.payout.replace('_', '-')}`;
  return h.compounding === 'simple'
    ? 'simple interest, paid at maturity'
    : `interest added ${COMPOUND[h.compounding] ?? h.compounding}`;
}

/** "NRE: tax-free", "NRO: after 31.2% tax", "account type not set". */
export function afterTaxWords(a: DepositHeadline['afterTax']): string {
  if (a.kind === 'NRE') return 'NRE: tax-free';
  if (a.kind === 'NRO') return `NRO: after ${exPct(a.taxRate ?? 0, 1)} tax (Settings)`;
  return 'account type not set: tax not known';
}

export interface DepositExplainInput {
  h: DepositHeadline;
  /** where the current value comes from, in the valuation engine's words ("at 7.25% (the rate on the deposit)") */
  valueNote: string | null;
  bankMaturityAmount: number | null;
  bank: string | null;
  links: { edit: string | null; settings: string; cover: string };
}

export function buildDepositPageExplain(i: DepositExplainInput): ExplainSet<'fd'> {
  const h = i.h;
  const terms = `${exPct(h.statedRate, 2)} a year, ${depositInterestWords(h)}, booked ${exDate(h.bookedOn)}, maturing ${exDate(h.maturityOn)}`;
  const ownRate = Math.abs(h.rate - h.statedRate) > 1e-6;
  const termsInput = {
    label: 'Terms of the deposit',
    value: terms,
    basis: 'recorded' as const,
    from: h.bookedOn,
    to: h.maturityOn,
  };
  const estLevel = 'estimated' as const;
  const estText =
    'Worked out from the deposit’s terms (an estimate until the bank’s statement or certificate confirms it).';
  const fixTerms = i.links.edit ? { label: 'Check the terms (Edit)', href: i.links.edit } : null;
  const value = explain({
    id: 'fd.value',
    title: TERMS.currentValue.label,
    exact: exInr(h.current),
    what: `What the deposit is worth now: ${TERMS.currentValue.hint.toLowerCase()} The same figure as on Deposits, Accounts and Home.`,
    how: `${exInr(h.invested)} invested, grown at ${exPct(h.rate, 2)} a year with ${depositInterestWords(h)} from ${exDate(h.bookedOn)} to today = ${exInr(h.current)}${h.paidOut > 0 ? `; ${exInr(h.paidOut)} interest has been paid out and is not in it` : ''}.${ownRate ? ` ${exPct(h.rate, 3)} is the rate that reaches the bank’s maturity amount (the stated rate is ${exPct(h.statedRate, 2)}).` : ''}`,
    inputs: [termsInput],
    level: estLevel,
    completeness: estText,
    notes: [i.valueNote ? `The valuation says: ${i.valueNote}.` : null],
    fix: fixTerms,
  });
  const profit = explain({
    id: 'fd.profit',
    title: TERMS.profitInterest.label,
    exact: exSigned(h.profit),
    what: TERMS.profitInterest.hint,
    how: `${exInr(h.current)} current value − ${exInr(h.invested)} invested = ${exSigned(h.profit)}; ${ratioHow({ label: 'profit', amount: h.profit }, { label: 'invested', amount: h.invested })} overall. XIRR: the yearly rate that turns ${exInr(h.invested)} on ${exDate(h.bookedOn)}${h.paidOut > 0 ? ' and each payout on its date' : ''} into ${exInr(h.current)} today${h.xirr === null ? ': not worked out yet (booked today)' : ` = ${exPct(h.xirr, 2)} a year`}.`,
    inputs: [termsInput],
    level: estLevel,
    completeness: estText,
    notes: [
      h.paidOut > 0 ? `${exInr(h.paidOut)} paid out to your account is Booked profit.` : null,
      'XIRR is above the stated rate when interest is added during the year: the interest earns interest.',
    ],
  });
  const invested = explain({
    id: 'fd.invested',
    title: TERMS.investedPrincipal.label,
    exact: exInr(h.invested),
    what: TERMS.investedPrincipal.hint,
    how: `The amount the deposit was booked with on ${exDate(h.bookedOn)}: ${exInr(h.invested)}.`,
    inputs: [{ label: 'Principal', value: exInr(h.invested), basis: 'recorded', to: h.bookedOn }],
    level: 'complete',
    completeness: 'The principal you recorded for the deposit.',
    fix: fixTerms,
  });
  const maturity = explain({
    id: 'fd.maturity',
    title: TERMS.maturityValue.label,
    exact: exInr(h.maturity),
    what: TERMS.maturityValue.hint,
    how: i.bankMaturityAmount
      ? `The bank’s own figure: ${exInr(i.bankMaturityAmount)} on ${exDate(h.maturityOn)}.`
      : `${exInr(h.invested)} at ${exPct(h.rate, 2)} a year with ${depositInterestWords(h)} until ${exDate(h.maturityOn)} = ${exInr(h.maturity)}${h.daysLeft >= 0 ? `, in ${h.daysLeft} days` : ''}.`,
    inputs: [
      i.bankMaturityAmount
        ? {
            label: 'Bank’s maturity amount',
            value: exInr(i.bankMaturityAmount),
            basis: 'statement',
            to: h.maturityOn,
          }
        : termsInput,
    ],
    level: i.bankMaturityAmount ? 'complete' : 'estimated',
    completeness: i.bankMaturityAmount
      ? 'From the bank’s figure.'
      : 'Worked out from the terms: enter the bank’s maturity amount to use its own figure.',
    fix: i.bankMaturityAmount ? null : fixTerms,
  });
  const toCome = explain({
    id: 'fd.toCome',
    title: TERMS.interestToCome.label,
    exact: exInr(h.interestToCome),
    what: `${TERMS.interestToCome.hint} What the deposit will still earn before it matures.`,
    how: `${TERMS.totalInterest.label} ${exInr(h.totalInterest)} − ${exInr(h.totalInterest - h.interestToCome)} earned so far = ${exInr(h.interestToCome)}.${h.earnedShare === null ? '' : ` ${exPct(h.earnedShare, 0)} of the total interest is earned.`}`,
    inputs: [termsInput],
    level: estLevel,
    completeness: estText,
    notes: [`${TERMS.totalInterest.label}: ${TERMS.totalInterest.hint}`],
  });
  const interestFy = explain({
    id: 'fd.interestFy',
    title: `${TERMS.interestEarned.label} this FY`,
    exact: exSigned(h.interestFy),
    what: `${TERMS.interestEarned.hint} Here: since ${exDate(h.fyStart)}.`,
    how: `Interest earned on the deposit’s terms from ${exDate(h.bookedOn > h.fyStart ? h.bookedOn : h.fyStart)} to today = ${exSigned(h.interestFy)}, whether it was added to the deposit or paid out.`,
    inputs: [termsInput],
    level: estLevel,
    completeness: estText,
    notes: ['The interest by financial year table below shows every year of the deposit.'],
  });
  const afterTax = explain({
    id: 'fd.afterTax',
    title: TERMS.rateAfterTax.label,
    exact: `${exPct(h.afterTax.rate, 2)} a year`,
    what: TERMS.rateAfterTax.hint,
    how:
      h.afterTax.kind === 'NRE'
        ? `NRE interest is tax-free in India: ${exPct(h.statedRate, 2)} a year stays ${exPct(h.afterTax.rate, 2)}.`
        : h.afterTax.kind === 'NRO'
          ? `${exPct(h.statedRate, 2)} × (1 − ${exPct(h.afterTax.taxRate ?? 0, 1)} tax on NRO interest) = ${exPct(h.afterTax.rate, 2)} a year.`
          : `The account type (NRE or NRO) is not set, so the tax is not known: ${exPct(h.statedRate, 2)} a year before tax.`,
    inputs: [
      {
        label: 'Account type',
        value: h.afterTax.kind === 'unknown' ? 'not set' : h.afterTax.kind,
        basis: h.afterTax.kind === 'unknown' ? 'missing' : 'recorded',
      },
      ...(h.afterTax.kind === 'NRO'
        ? [
            {
              label: 'Tax on NRO interest',
              value: exPct(h.afterTax.taxRate ?? 0, 1),
              basis: 'recorded' as const,
              note: 'Settings',
            },
          ]
        : []),
    ],
    level: h.afterTax.kind === 'unknown' ? 'missing' : 'complete',
    completeness:
      h.afterTax.kind === 'unknown'
        ? 'Missing: set the account type (NRE or NRO) on the deposit.'
        : 'From the account type and the tax rate in Settings.',
    notes: ['This is not tax advice: the rate is the one in Settings.'],
    fix:
      h.afterTax.kind === 'unknown'
        ? fixTerms
        : h.afterTax.kind === 'NRO'
          ? { label: 'Change the tax rate (Settings)', href: i.links.settings }
          : null,
  });
  const ins = h.insured;
  const insured = explain({
    id: 'fd.insured',
    title: 'Insured',
    exact: ins ? (ins.yes ? 'Yes' : 'No') : 'not counted',
    what: `Whether deposit insurance covers this deposit: ${TERMS.aboveInsured.hint}`,
    how: ins
      ? `Everything in this name at ${i.bank ?? 'this bank'}, deposits and savings with their interest: ${exInr(ins.total)}, ${ins.yes ? 'within' : 'over'} the ${exInr(ins.limit)} limit${ins.yes ? '' : ` by ${exInr(ins.total - ins.limit)}`}.`
      : 'This bank is outside the Indian deposit insurance scheme (a foreign bank), or the deposit is not counted today.',
    inputs: ins
      ? [
          { label: 'In this name at this bank', value: exInr(ins.total), basis: 'calculated' },
          { label: 'Insured limit', value: exInr(ins.limit), basis: 'recorded', note: 'Settings' },
        ]
      : [{ label: 'Bank in the scheme', value: 'no', basis: 'recorded' }],
    level: 'complete',
    completeness: 'From the current values of every deposit and balance at this bank in this name.',
    notes: ['The order of names on a joint account matters: each order is insured on its own.'],
    fix: { label: 'See the insurance cover', href: i.links.cover },
  });
  return {
    'fd.value': value,
    'fd.profit': profit,
    'fd.invested': invested,
    'fd.maturity': maturity,
    'fd.toCome': toCome,
    'fd.interestFy': interestFy,
    'fd.afterTax': afterTax,
    'fd.insured': insured,
  };
}

export interface SavingsExplainInput {
  h: SavingsHeadline;
  /** where the interest rate comes from (the account's own, the bank's list, the rate assumed in Settings) */
  rateNote: string | null;
  rateAssumed: boolean;
  tdsRate: number;
  balances: number;
  links: { update: string; rates: string; settings: string };
}

export function buildSavingsPageExplain(i: SavingsExplainInput): ExplainSet<'savings'> {
  const h = i.h;
  const b = h.balance;
  const balInput = b
    ? {
        label: 'Last balance from the bank',
        value: exInr(b.amount),
        basis: 'statement' as const,
        to: b.date,
      }
    : { label: 'Balance', value: 'none on file', basis: 'missing' as const };
  const rateInput = {
    label: 'Interest rate',
    value: `${exPct(h.rate, 2)} a year`,
    basis: i.rateAssumed ? ('estimated' as const) : ('recorded' as const),
    note: i.rateNote ?? undefined,
  };
  const fixBal = { label: 'Update the balance', href: i.links.update };
  const value = explain({
    id: 'savings.value',
    title: TERMS.currentValue.label,
    exact: exInr(h.current),
    what: 'What the account holds now, with the interest it has earned and the bank has not credited yet. The same figure as on Accounts and Home.',
    how: b
      ? `${exInr(b.amount)} balance on ${exDate(b.date)}${Math.abs(h.moved) >= 1 ? ` ${exSigned(h.moved)} moved since` : ''}${Math.abs(h.credited) >= 1 ? ` + ${exInr(h.credited)} interest credited since` : ''} + ${exInr(h.uncredited)} interest not yet credited = ${exInr(h.current)}.`
      : 'No balance is on file.',
    inputs: [balInput, rateInput],
    level: !b ? 'missing' : h.estimated ? 'partly_estimated' : 'complete',
    completeness: !b
      ? 'Missing: record a balance.'
      : h.estimated
        ? 'The balance is the bank’s; the interest since is worked out at the rate (est.). The next balance replaces it.'
        : 'The bank’s balance, nothing added.',
    fix: fixBal,
  });
  const today = explain({
    id: 'savings.today',
    title: TERMS.todayChange.label,
    exact: exSigned(h.todayChange),
    what: TERMS.todayChange.hint,
    how: `One day’s interest on the balance at ${exPct(h.rate, 2)} a year${i.tdsRate > 0 ? `, after ${exPct(i.tdsRate, 0)} tax at source` : ''} = ${exSigned(h.todayChange)}.`,
    inputs: [balInput, rateInput],
    level: b ? 'estimated' : 'missing',
    completeness: 'An estimate: the bank credits interest in lumps, not each day.',
  });
  const balance = explain({
    id: 'savings.balance',
    title: TERMS.balance.label,
    exact: b ? exInr(b.amount) : undefined,
    what: TERMS.balance.hint,
    how: b
      ? `${exInr(b.amount)}, the balance the bank showed on ${exDate(b.date)}.`
      : 'No balance is on file.',
    inputs: [balInput, { label: 'Balances on file', value: String(i.balances), basis: 'recorded' }],
    level: b ? 'complete' : 'missing',
    completeness: b ? `From the bank, ${exDate(b.date)}.` : 'Missing: record a balance.',
    fix: fixBal,
  });
  const rate = explain({
    id: 'savings.rate',
    title: TERMS.interestRate.label,
    exact: `${exPct(h.rate, 2)} a year`,
    what: `${TERMS.interestRate.hint} ${TERMS.rateAfterTax.label}: ${TERMS.rateAfterTax.hint}`,
    how: `${exPct(h.rate, 2)} a year${i.rateNote ? ` (${i.rateNote})` : ''}. ${afterTaxWords(h.afterTax)}${h.afterTax.kind === 'NRO' ? `: ${exPct(h.afterTax.rate, 2)} a year` : ''}.`,
    inputs: [rateInput],
    level: i.rateAssumed ? 'estimated' : 'complete',
    completeness: i.rateAssumed
      ? 'Assumed: no rate is on file for this account, so the rate in Settings is used.'
      : 'The rate on file for this account.',
    fix: { label: 'See the rates', href: i.links.rates },
  });
  const interestFy = explain({
    id: 'savings.interestFy',
    title: `${TERMS.interestEarned.label} this FY`,
    exact: exSigned(h.interestFy),
    what: `${TERMS.interestEarned.hint} Here: since ${exDate(h.fyStart)}.`,
    how: `Each balance on file carried forward to the next one, earning ${exPct(h.rate, 2)} a year${i.tdsRate > 0 ? ` after ${exPct(i.tdsRate, 0)} tax at source` : ''}, from ${exDate(h.fyStart)} to today = ${exSigned(h.interestFy)}.`,
    inputs: [balInput, rateInput],
    level: 'estimated',
    completeness:
      'An estimate from the balances and the rate; the bank statement has the exact interest.',
  });
  const v = h.vsDeposits;
  const vsDeposits = v
    ? explain({
        id: 'savings.vsDeposits',
        title: 'Against your deposits',
        exact: `${exSigned(v.perYear)} a year`,
        what: 'What this balance earns a year more (+) or less (−) than it would at the average interest rate of your running deposits.',
        how: `${exInr(h.current)} × (${exPct(h.rate, 2)} − ${exPct(v.depositRate, 2)}) = ${exSigned(v.perYear)} a year.`,
        inputs: [
          rateInput,
          {
            label: TERMS.averageRate.label,
            value: exPct(v.depositRate, 2),
            basis: 'calculated',
            note: 'running deposits, weighted by principal',
          },
        ],
        level: i.rateAssumed ? 'estimated' : 'complete',
        completeness: 'From the rates on file; tax is left out of both.',
        notes: [
          'Money you need at short notice belongs in savings: this is a yearly difference, not advice.',
        ],
      })
    : explain({
        id: 'savings.vsDeposits',
        title: 'Against your deposits',
        what: 'What this balance earns a year more or less than at the average rate of your running deposits.',
        how: 'Not worked out: there is no running deposit to compare with.',
        inputs: [{ label: 'Running deposits', value: 'none', basis: 'missing' }],
        level: 'missing',
        completeness: 'Missing: no running deposit.',
      });
  return {
    'savings.value': value,
    'savings.today': today,
    'savings.balance': balance,
    'savings.rate': rate,
    'savings.interestFy': interestFy,
    'savings.vsDeposits': vsDeposits,
  };
}
