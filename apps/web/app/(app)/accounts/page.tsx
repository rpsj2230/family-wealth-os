import { ListingTools } from '@/components/ListingTools';
import Link from 'next/link';
import {
  buildBankBlocks,
  filterBlocksByOwner,
  formatInr,
  formatInrCompact,
  personStyles,
} from '@fwos/core';
import { BankTable } from '@/components/BankTable';
import { PersonFilter } from '@/components/Person';
import { loadSettings } from '@fwos/data';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadContext } from '@/lib/data';
import { loadPortfolio } from '@/lib/portfolio-data';
import { cashRatesFor, loadOffers } from '@/lib/rates-view';

import { saveBankNote } from './actions';

export const dynamic = 'force-dynamic';

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string }>;
}) {
  const { p } = await searchParams;
  const { supabase, householdId } = await loadContext();
  if (!householdId) return <p>Create your household on the dashboard first.</p>;
  const [{ today, assetRows, obsRows, fdRows, ownerName, portfolio }, inst, settings, offers] =
    await Promise.all([
      loadPortfolio(supabase),
      supabase.from('institutions').select('id, name, notes'),
      loadSettings(supabase as unknown as SupabaseClient),
      loadOffers(supabase),
    ]);
  const styles = personStyles([...ownerName.entries()].map(([id, name]) => ({ id, name })));
  const who = p && styles[p] ? p : null;
  const names = Object.fromEntries(
    (inst.data ?? []).map((i) => [i.id as string, i.name as string]),
  );
  const notes = Object.fromEntries(
    (inst.data ?? []).filter((i) => i.notes).map((i) => [i.id as string, i.notes as string]),
  );
  const all = buildBankBlocks({
    assets: assetRows,
    observations: obsRows,
    fds: fdRows,
    portfolio,
    institutionNames: names,
    today,
  });
  const blocks = who ? filterBlocksByOwner(all, who) : all;
  const cashRates = cashRatesFor(
    blocks.flatMap((b) =>
      b.sections.flatMap((sct) => sct.rows.map((r) => ({ ...r, bank: b.name }))),
    ),
    new Map(assetRows.map((a) => [a.id, a.interest_rate ?? null])),
    offers,
    settings.config.estimates.savingsRate,
  );
  const total = blocks.reduce((s, b) => s + b.totals.current, 0);
  const fd = blocks.reduce(
    (s, b) => ({
      inv: s.inv + b.totals.fdInvested,
      mat: s.mat + b.totals.fdMaturity,
      cur: s.cur + b.totals.fdCurrent,
    }),
    { inv: 0, mat: 0, cur: 0 },
  );
  const totals = Object.fromEntries(
    Object.entries(portfolio.netWorth.byOwner).map(([id, v]) => [id, formatInrCompact(v)]),
  );

  return (
    <>
      <h1>Accounts</h1>
      <ListingTools name="accounts">
        <p className="muted small">
          Banks in your sheet&apos;s order. Current value of a deposit is worked out from its rate
          and start date, and equals the full amount on the maturity date. Today&apos;s wealth uses
          these current values. <Link href="/accounts/reorder">Change the order</Link> ·{' '}
          <Link href="/accounts/edit">Correct tags and details</Link>
        </p>
        <PersonFilter
          people={Object.values(styles)}
          basePath="/accounts"
          current={who}
          totals={totals}
        />
        <div className="card summary">
          <span>
            Banks total <b className="num">{formatInr(Math.round(total))}</b>
          </span>
          <span>
            FDs invested <b className="num">{formatInr(Math.round(fd.inv))}</b>
          </span>
          <span>
            FDs at maturity <b className="num">{formatInr(Math.round(fd.mat))}</b>
          </span>
          <span>
            FDs today <b className="num">{formatInr(Math.round(fd.cur))}</b>
          </span>
        </div>
        <BankTable
          blocks={blocks}
          styles={styles}
          soonDays={settings.config.reminders.maturitySoonDays}
          notes={notes}
          saveNote={saveBankNote}
          cashRates={cashRates}
        />
      </ListingTools>
    </>
  );
}
