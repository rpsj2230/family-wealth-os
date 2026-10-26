import {
  buildPortfolio,
  latestObservations,
  type AssetRow,
  type FdRow,
  type ObservationRow,
} from '@fwos/core';
import { loadContext } from '@/lib/data';
import type { GridRow } from '@/lib/monthly';
import { MonthlyGrid } from '../MonthlyGrid';

export const dynamic = 'force-dynamic';

const GROUPS: Record<string, [number, string]> = {
  bank_account: [1, 'Bank balances'],
  fixed_deposit: [2, 'Fixed deposits (status only)'],
  mutual_fund: [3, 'Mutual funds'],
  ulip: [4, 'ULIP / pension'],
  nps: [4, 'ULIP / pension'],
  stock: [5, 'Stocks'],
  receivable: [6, 'Money lent'],
  third_party_held: [7, 'Held by others'],
  property: [8, 'Property'],
  other: [9, 'Other'],
};

export default async function MonthlyPage() {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return <p>Create your household on the dashboard first.</p>;
  const [owners, assets, observations, fds] = await Promise.all([
    supabase.from('owners').select('id, display_name'),
    supabase
      .from('assets')
      .select(
        'id, owner_id, type, status, nickname, currency, account_kind, expected_freshness_days, interest_rate, tds_rate',
      ),
    supabase
      .from('observations')
      .select(
        'id, asset_id, kind, amount, currency, fx_rate, as_of, confidence, source, created_at, superseded_by',
      ),
    supabase
      .from('fixed_deposits')
      .select(
        'asset_id, principal, rate, booked_on, maturity_on, compounding, bank_maturity_amount',
      ),
  ]);
  const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
  const assetRows = (assets.data ?? []) as AssetRow[];
  const obsRows = (observations.data ?? []) as ObservationRow[];
  const fdRows = (fds.data ?? []) as FdRow[];
  const p = buildPortfolio(assetRows, obsRows, fdRows, today);
  const latest = latestObservations(obsRows);
  const fdBy = new Map(fdRows.map((f) => [f.asset_id, f]));
  const valued = new Map(p.valued.map((v) => [v.assetId, v]));
  const ownerName = new Map(
    (owners.data ?? []).map((o) => [o.id as string, o.display_name as string]),
  );

  const rows: GridRow[] = assetRows
    .map((a): GridRow => {
      const obs = latest.get(a.id);
      const fd = fdBy.get(a.id);
      const line = p.lines[a.id]!;
      return {
        id: a.id,
        name: a.nickname,
        owner: ownerName.get(a.owner_id) ?? '—',
        type: a.type,
        group: GROUPS[a.type]?.[1] ?? 'Other',
        currency: a.currency,
        mode: fd ? 'fd' : 'value',
        latestAmount: obs ? Number(obs.amount) : null,
        latestAsOf: obs?.as_of ?? null,
        freshness: line.freshness,
        estimatedToday: valued.get(a.id)?.estimate?.estimatedAmount ?? null,
        fxRate: obs?.fx_rate ? Number(obs.fx_rate) : null,
        interestRate: a.interest_rate ?? null,
        tdsRate: a.tds_rate ?? null,
        status: a.status,
        ...(fd
          ? {
              fd: {
                principal: Number(fd.principal),
                rate: Number(fd.rate),
                maturityOn: fd.maturity_on,
              },
            }
          : {}),
      };
    })
    .sort(
      (x, y) =>
        (GROUPS[x.type]?.[0] ?? 99) - (GROUPS[y.type]?.[0] ?? 99) ||
        x.owner.localeCompare(y.owner) ||
        x.name.localeCompare(y.name),
    );

  return (
    <>
      <h1>Monthly update</h1>
      <p className="muted">
        Type the new balance or value next to each line, then press <strong>Save all</strong>. Leave
        a line empty to keep it as is. Old values are never overwritten; they stay as history. You
        can also paste a column from Excel into the first &ldquo;New value&rdquo; box.
      </p>
      <MonthlyGrid rows={rows} today={today.toISOString().slice(0, 10)} />
    </>
  );
}
