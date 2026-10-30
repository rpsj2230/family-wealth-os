import {
  TERMS,
  afterTaxWords,
  buildDepositPageExplain,
  buildSavingsPageExplain,
  depositInterestWords,
  formatInr,
  formatInrCompact,
  formatPct,
  type DepositHeadline,
  type SavingsHeadline,
} from '@fwos/core';
import { HeadlinePanel, Pill, Tile, signed } from '@/components/MoneyHeadline';
import { niceDate } from '@/lib/dates';

/** A yearly rate as the headlines write it: "7.25% a year", "7.0% a year". */
export const yearly = (r: number) => `${(r * 100).toFixed(2).replace(/0$/, '')}% a year`;

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/**
 * The dark headline at the top of one fixed deposit's page (money words v6): its current value (the valuation engine's, the figure
 * Deposits and Accounts show), the interest it has earned with its XIRR, and the tiles of what was invested, what it pays at maturity,
 * the interest still to come and this year's, the rate after tax and whether deposit insurance covers it. Every figure comes from
 * depositHeadline() in @fwos/core; this only draws it.
 */
export function DepositHeadlinePanel({
  h,
  bank,
  bankMaturityAmount,
  valueNote = null,
  sample = false,
  editHref = null,
}: {
  h: DepositHeadline;
  bank: string | null;
  bankMaturityAmount: number | null;
  valueNote?: string | null;
  sample?: boolean;
  editHref?: string | null;
}) {
  const to = (path: string) => (sample ? `/demo${path}` : path);
  const ex = buildDepositPageExplain({
    h,
    valueNote,
    bankMaturityAmount,
    bank,
    links: {
      edit: editHref,
      settings: sample ? '' : '/settings',
      cover: to('/deposits?tab=cover'),
    },
  });
  const running = h.state === 'running';
  const kindWords =
    h.afterTax.kind === 'NRE'
      ? 'NRE (tax-free)'
      : h.afterTax.kind === 'NRO'
        ? 'NRO (taxable)'
        : 'account type not set';
  return (
    <HeadlinePanel
      label={TERMS.currentValue.label}
      value={h.current}
      why={ex['fd.value']}
      ariaLabel="This deposit at a glance"
      testId="fd-current"
    >
      <div className="hl-pills">
        <Pill
          amount={h.profit}
          pct={h.profitPct}
          pctNote="overall"
          label={TERMS.profitInterest.label}
          extra={h.xirr === null ? undefined : ` · ${TERMS.xirr.label} ${yearly(h.xirr)}`}
          why={ex['fd.profit']}
          testId="fd-profit"
        />
      </div>
      <p className="hl-asof" data-testid="fd-asof">
        est. · {yearly(h.statedRate)}, {depositInterestWords(h)} · {kindWords}
        {h.paidOut > 0
          ? ` · ${formatInr(Math.round(h.paidOut))} paid out (${TERMS.booked.label.toLowerCase()})`
          : ''}
      </p>
      <ul className="hl-tiles" aria-label="The deposit in figures">
        <Tile
          label={TERMS.investedPrincipal.label}
          value={formatInr(Math.round(h.invested))}
          sub={`opened ${niceDate(h.bookedOn)}`}
          why={ex['fd.invested']}
          testId="fd-tile-invested"
        />
        <Tile
          label={TERMS.maturityValue.label}
          value={formatInr(Math.round(h.maturity))}
          sub={`${niceDate(h.maturityOn)} · ${
            h.daysLeft > 0
              ? `in ${plural(h.daysLeft, 'day')}`
              : h.daysLeft === 0
                ? 'today'
                : `${plural(-h.daysLeft, 'day')} ago`
          }`}
          why={ex['fd.maturity']}
          testId="fd-tile-maturity"
        />
        <Tile
          label={TERMS.interestToCome.label}
          value={formatInr(Math.round(h.interestToCome))}
          sub={`${TERMS.totalInterest.label} ${formatInr(Math.round(h.totalInterest))}${
            h.earnedShare !== null ? ` · ${formatPct(h.earnedShare, 0)} earned so far` : ''
          }`}
          why={ex['fd.toCome']}
          testId="fd-tile-tocome"
        />
        <Tile
          label={`${TERMS.interestEarned.label} this FY`}
          value={signed(h.interestFy)}
          sub={`since ${niceDate(h.fyStart)}`}
          why={ex['fd.interestFy']}
          testId="fd-tile-fy"
        />
        <Tile
          label={TERMS.rateAfterTax.label}
          value={yearly(h.afterTax.rate)}
          sub={afterTaxWords(h.afterTax)}
          why={ex['fd.afterTax']}
          testId="fd-tile-aftertax"
        />
        <Tile
          label="Insured"
          value={h.insured ? (h.insured.yes ? 'Yes' : 'No') : '–'}
          sub={
            !h.insured
              ? running
                ? 'this bank is outside the scheme'
                : 'not counted today'
              : h.insured.yes
                ? `within ${formatInrCompact(h.insured.limit)} at this bank`
                : `${formatInrCompact(h.insured.total - h.insured.limit)} over ${formatInrCompact(h.insured.limit)} at this bank`
          }
          href={to('/deposits?tab=cover')}
          why={ex['fd.insured']}
          testId="fd-tile-insured"
        />
      </ul>
    </HeadlinePanel>
  );
}

/**
 * The dark headline at the top of one savings account's page: its current value (the engine's: the bank's last balance plus the
 * interest since, not yet credited), today's change, and the tiles of the balance, the rate, this year's interest and what the balance
 * earns against the deposits' rate. Every figure comes from savingsHeadline() in @fwos/core; this only draws it.
 */
export function SavingsHeadlinePanel({
  h,
  rateNote,
  rateAssumed,
  tdsRate,
  balances,
  sample = false,
}: {
  h: SavingsHeadline;
  rateNote: string | null;
  rateAssumed: boolean;
  tdsRate: number;
  balances: number;
  sample?: boolean;
}) {
  const to = (path: string) => (sample ? `/demo${path}` : path);
  const ex = buildSavingsPageExplain({
    h,
    rateNote,
    rateAssumed,
    tdsRate,
    balances,
    links: { update: to('/monthly'), rates: to('/rates'), settings: sample ? '' : '/settings' },
  });
  const b = h.balance;
  const parts = b
    ? [
        `${TERMS.balance.label} ${formatInr(Math.round(b.amount))} on ${niceDate(b.date)}`,
        Math.abs(h.moved) >= 1 ? `${signed(h.moved)} moved since` : null,
        Math.abs(h.credited) >= 1
          ? `${formatInr(Math.round(h.credited))} interest credited since`
          : null,
        Math.abs(h.uncredited) >= 1
          ? `${formatInr(Math.round(h.uncredited))} interest not yet credited`
          : null,
      ].filter(Boolean)
    : [];
  const v = h.vsDeposits;
  return (
    <HeadlinePanel
      label={TERMS.currentValue.label}
      value={h.current}
      why={ex['savings.value']}
      ariaLabel="This account at a glance"
      testId="sv-current"
    >
      <div className="hl-pills">
        <Pill
          amount={h.todayChange}
          pct={null}
          label={TERMS.todayChange.label}
          why={ex['savings.today']}
          testId="sv-today"
        />
      </div>
      <p className="hl-asof" data-testid="sv-asof">
        {h.estimated ? 'est. · ' : ''}
        {parts.length > 0 ? parts.join(' + ') : 'No balance is on file yet.'}
      </p>
      <ul className="hl-tiles" aria-label="The account in figures">
        <Tile
          label={TERMS.balance.label}
          value={b ? formatInr(Math.round(b.amount)) : '–'}
          sub={b ? `bank figure, ${niceDate(b.date)}` : 'record a balance'}
          why={ex['savings.balance']}
          testId="sv-tile-balance"
        />
        <Tile
          label={TERMS.interestRate.label}
          value={`${rateAssumed ? '~' : ''}${yearly(h.rate)}`}
          sub={`after tax: ${
            h.afterTax.kind === 'NRE'
              ? 'NRE tax-free'
              : h.afterTax.kind === 'NRO'
                ? `NRO ${yearly(h.afterTax.rate)}`
                : 'account type not set'
          }`}
          href={to('/rates')}
          why={ex['savings.rate']}
          testId="sv-tile-rate"
        />
        <Tile
          label={`${TERMS.interestEarned.label} this FY`}
          value={signed(h.interestFy)}
          sub={`since ${niceDate(h.fyStart)}`}
          why={ex['savings.interestFy']}
          testId="sv-tile-fy"
        />
        <Tile
          label="Against your deposits"
          value={v ? `${signed(v.perYear)} a year` : '–'}
          sub={
            v
              ? `at your ${formatPct(v.depositRate, 2)} average deposit rate`
              : 'no running deposit to compare with'
          }
          why={ex['savings.vsDeposits']}
          testId="sv-tile-deposits"
        />
      </ul>
    </HeadlinePanel>
  );
}
