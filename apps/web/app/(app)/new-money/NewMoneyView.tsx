import Link from 'next/link';
import {
  compareHoldings,
  formatInr,
  offerAge,
  planOptions,
  type PersonStyle,
  type RateHolding,
  type RateOffer,
  type RatePrefs,
} from '@fwos/core';
import { readAmount } from '@/lib/read-amount';
import { PageHead } from '@/components/PageHead';
import { WhyHead } from '@/components/Why';
import { newMoneyExplain } from '@/lib/explain-rates';
import { ParamTabs } from '@/components/ParamTabs';
import { AmountForm, OptionsView } from './Options';
import { InsuranceRoom, Suggestions } from './Parts';
import '../rates/rates.css';

export const NM_TABS = ['place', 'better', 'room'] as const;
export type NmTab = (typeof NM_TABS)[number];
export const parseNmTab = (s: string | undefined): NmTab =>
  (NM_TABS as readonly string[]).includes(s ?? '') ? (s as NmTab) : 'place';

/**
 * New money: where a sum should go, which of today's holdings could earn more, and how much deposit-insurance room is left at each
 * bank. Used by the signed-in page and the public sample.
 */
export function NewMoneyView({
  sp,
  tab,
  people,
  styles,
  offers,
  holdings,
  prefs,
  limit,
  today,
  baselineRate,
  base,
  formAction,
  ratesHref,
  banksBase,
}: {
  sp: Record<string, string | undefined>;
  tab: NmTab;
  people: { id: string; name: string }[];
  styles: Record<string, PersonStyle>;
  offers: RateOffer[];
  holdings: RateHolding[];
  prefs: RatePrefs;
  limit: number;
  today: string;
  baselineRate: number;
  base: string;
  formAction: string;
  ratesHref: string;
  banksBase: string;
}) {
  const amount = readAmount(sp.amount);
  const kind: 'NRE' | 'NRO' = sp.kind === 'NRO' ? 'NRO' : 'NRE';
  const who = sp.who && styles[sp.who] ? sp.who : (people[0]?.id ?? '');
  const result =
    amount > 0 && who
      ? planOptions({
          amount,
          kind,
          ownerId: who,
          holdings,
          offers,
          prefs,
          limit,
          today,
          baselineRate,
        })
      : null;
  const suggestions = compareHoldings(holdings, offers, prefs, today, limit);
  const totalGain = suggestions.reduce((s, x) => s + x.annualGain, 0);
  const stale = offers.filter((o) => offerAge(o, today) > prefs.staleDays).length;
  const ex = newMoneyExplain({
    offers,
    holdings,
    today,
    staleDays: prefs.staleDays,
    limit,
    baselineRate,
    amount,
    kind,
    result,
    suggestions: { count: suggestions.length, totalGain },
    ratesHref,
    depositsHref: ratesHref.startsWith('/demo')
      ? '/demo/deposits?tab=cover'
      : '/deposits?tab=cover',
  });

  return (
    <>
      <PageHead
        title="New money"
        subtitle="Type an amount. You get five ways to place it with the reasons, and a recommendation that balances the rate, the deposit-insurance limit and how the money is spread."
        pills={[
          { label: `${offers.length} rates on file`, tone: 'info', why: ex['newmoney.options'] },
          { label: `insurance limit ${formatInr(limit)} per person per bank` },
          ...(stale > 0
            ? [
                {
                  label: `${stale} rates older than ${prefs.staleDays} days`,
                  tone: 'warn' as const,
                },
              ]
            : []),
        ]}
        actions={
          <Link className="btn" href={ratesHref}>
            See the rates
          </Link>
        }
      />
      <ParamTabs
        base={base}
        current={tab}
        keep={sp}
        tabs={[
          { key: 'place', label: 'Where to put it' },
          { key: 'better', label: 'Earning more elsewhere', badge: suggestions.length || null },
          { key: 'room', label: 'Insurance room' },
        ]}
      />

      {tab === 'place' && (
        <>
          <section className="card" aria-labelledby="nm-h">
            <h2 id="nm-h">I have new money</h2>
            <AmountForm
              action={formAction}
              amount={sp.amount ?? ''}
              kind={kind}
              who={who}
              people={people}
              styles={styles}
              base={base}
            />
          </section>
          {result ? (
            <OptionsView
              result={result}
              amount={amount}
              banksBase={banksBase}
              ratesHref={ratesHref}
              why={ex['newmoney.options']}
            />
          ) : (
            <p className="empty">
              Type an amount. You get five ways to place it, each with its reasons, and one
              recommendation: savings and fixed deposits of different terms, the bank rates after
              tax, the insurance limit at each bank and how the money is spread. Rates are as on the{' '}
              <Link href={ratesHref}>Rates page</Link>.
            </p>
          )}
        </>
      )}

      {tab === 'better' && (
        <section className="card" aria-labelledby="sug-h">
          <WhyHead why={ex['newmoney.better']}>
            <h2 id="sug-h">Your money against the market</h2>
          </WhyHead>
          <p className="muted small">
            Compared after tax (NRE interest is not taxed in India; NRO interest is, at the rate in
            Settings). A running deposit is never suggested to be broken early.
          </p>
          <Suggestions
            suggestions={suggestions}
            totalGain={totalGain}
            prefs={prefs}
            offersCount={offers.length}
            banksBase={banksBase}
          />
        </section>
      )}

      {tab === 'room' && (
        <section className="card" aria-labelledby="room-h">
          <WhyHead why={ex['newmoney.room']}>
            <h2 id="room-h">Who holds what today</h2>
          </WhyHead>
          <p className="muted small">
            Each ownership name at each bank, with interest. Deposit insurance covers up to{' '}
            {formatInr(limit)} per bank for each name, savings, fixed and other deposits added
            together; a joint account counts under its names in the order written, so A &amp; B and
            B &amp; A are separate. The limit is a setting.
          </p>
          <InsuranceRoom holdings={holdings} limit={limit} styles={styles} />
        </section>
      )}
    </>
  );
}
