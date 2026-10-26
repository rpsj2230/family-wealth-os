import Link from 'next/link';
import {
  compareHoldings,
  formatInr,
  offerAge,
  placeNewMoney,
  type PersonStyle,
  type RateHolding,
  type RateOffer,
  type RatePrefs,
} from '@fwos/core';
import { readAmount } from '@/lib/read-amount';
import { PageHead } from '@/components/PageHead';
import { ParamTabs } from '@/components/ParamTabs';
import { InsuranceRoom, PlanResult, PlannerForm, Suggestions } from './Parts';
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
  const who = sp.who && styles[sp.who] ? sp.who : people[0]?.id;
  const joint = sp.joint === 'on';
  const tenure = Number(sp.tenure) > 0 ? Number(sp.tenure) : prefs.defaultTenureMonths;
  const plan =
    amount > 0 && who
      ? placeNewMoney({
          amount,
          kind,
          ownerId: who,
          joint,
          jointHolderId: joint && sp.with && styles[sp.with] && sp.with !== who ? sp.with : null,
          tenureMonths: tenure,
          keepLiquid: readAmount(sp.liquid),
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

  return (
    <>
      <PageHead
        title="New money"
        subtitle="Type an amount. The app spreads it over the banks that pay most after tax, never more than the deposit-insurance limit at one bank for one person, counting what is already there."
        pills={[
          { label: `${offers.length} rates on file`, tone: 'info' },
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
            <PlannerForm
              action={formAction}
              people={people}
              defaultTenure={prefs.defaultTenureMonths}
              values={{
                amount: sp.amount ?? '',
                kind,
                who: who ?? '',
                tenure: String(tenure),
                liquid: sp.liquid ?? '',
                joint,
                with: sp.with ?? '',
              }}
            />
          </section>
          {plan ? (
            <PlanResult plan={plan} amount={amount} prefs={prefs} banksBase={banksBase} />
          ) : (
            <p className="empty">
              Enter an amount to see how to place it. Rates are as on the{' '}
              <Link href={ratesHref}>Rates page</Link>; change a figure there and this page follows.
            </p>
          )}
        </>
      )}

      {tab === 'better' && (
        <section className="card" aria-labelledby="sug-h">
          <h2 id="sug-h">Your money against the market</h2>
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
          <h2 id="room-h">Who holds what today</h2>
          <p className="muted small">
            Each person&apos;s balances and deposits at each bank, including interest. Deposit
            insurance covers up to {formatInr(limit)} per person per bank; the limit is a setting.
          </p>
          <InsuranceRoom holdings={holdings} limit={limit} styles={styles} />
        </section>
      )}
    </>
  );
}
