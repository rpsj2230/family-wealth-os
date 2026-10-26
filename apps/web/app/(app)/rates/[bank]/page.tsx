import { notFound } from 'next/navigation';
import { canonicalBanks, sameBank, sourceStatus, withRunAge } from '@fwos/core';
import { loadRatesContext } from '@fwos/data';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadContext } from '@/lib/data';
import { loadBoardOffers, loadRateEvents, loadRateHints, loadRateSources } from '@/lib/rates-view';
import { slugify } from '@/lib/slug';
import { acceptPageRate, deleteRateOffer, saveRate, toggleHint } from '../actions';
import { BankView, parseBankTab } from '../BankView';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ bank: string }> }) {
  const { bank } = await params;
  return { title: `Rates: ${bank.replace(/-/g, ' ')}` };
}

export default async function BankRatesPage({
  params,
  searchParams,
}: {
  params: Promise<{ bank: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { bank: slug } = await params;
  const sp = await searchParams;
  const { supabase, householdId } = await loadContext();
  if (!householdId) return <p>Create your household on the dashboard first.</p>;
  const db = supabase as unknown as SupabaseClient;
  const [rc, offers, events, hints, sources] = await Promise.all([
    loadRatesContext(db),
    loadBoardOffers(supabase),
    loadRateEvents(supabase),
    loadRateHints(supabase),
    loadRateSources(supabase),
  ]);
  const names = canonicalBanks([...rc.holdings.map((h) => h.bank), ...offers.map((o) => o.bank)]);
  const bank = names.find((n) => slugify(n) === slug);
  if (!bank) notFound();
  const today = rc.today.toISOString().slice(0, 10);
  const mine = offers.filter((o) => sameBank(o.bank, bank));
  const src = sources.find((s) => sameBank(s.bank, bank)) ?? null;
  const held = rc.holdings
    .filter((h) => !h.needsConfirmation && sameBank(h.bank, bank))
    .reduce((t, h) => t + h.current, 0);
  return (
    <BankView
      bank={bank}
      offers={mine}
      events={events.filter((e) => sameBank(e.bank, bank))}
      hints={hints.filter((h) => sameBank(h.bank, bank))}
      source={withRunAge(sourceStatus(src, today), today)}
      today={today}
      staleDays={rc.config.rates.staleDays}
      tab={parseBankTab(sp.tab)}
      base={`/rates/${slugify(bank)}`}
      backHref="/rates"
      newMoneyHref="/new-money"
      held={held}
      actions={{ save: saveRate, accept: acceptPageRate, remove: deleteRateOffer }}
      toggleHint={toggleHint}
    />
  );
}
