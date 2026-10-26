import {
  buildPortfolio,
  latestObservations,
  sourceTag,
  type AssetRow,
  type FdRow,
  type ObservationRow,
} from '@fwos/core';
import type { Ctx } from '@/lib/data';
import type { GridRow } from '@/lib/monthly';

const GROUPS: Record<string, [number, string]> = {
  mutual_fund: [3, 'Mutual funds (normally updated by their price)'],
  ulip: [4, 'ULIP / pension'],
  nps: [4, 'ULIP / pension'],
  stock: [5, 'Stocks'],
  receivable: [6, 'Money lent'],
  property: [8, 'Property'],
  other: [9, 'Other'],
};

/** Bank balances, deposits and money held by others are updated in the bank sheet; everything else is updated here. */
const IN_BANK_SHEET = new Set(['bank_account', 'fixed_deposit', 'third_party_held']);

/** The lines that are not on the bank sheet: property, ULIP, pension, shares, money lent, funds and anything else. */
export async function loadOtherRows(
  supabase: Ctx['supabase'],
): Promise<{ rows: GridRow[]; today: string }> {
  const [owners, assets, observations, fds] = await Promise.all([
    supabase.from('owners').select('id, display_name'),
    supabase
      .from('assets')
      .select(
        'id, owner_id, type, status, nickname, currency, account_kind, expected_freshness_days, interest_rate, tds_rate',
      )
      .not('type', 'in', '(bank_account,fixed_deposit,third_party_held)'),
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
  const assetRows = ((assets.data ?? []) as AssetRow[]).filter((a) => !IN_BANK_SHEET.has(a.type));
  const obsRows = (observations.data ?? []) as ObservationRow[];
  const fdRows = (fds.data ?? []) as FdRow[];
  const p = buildPortfolio(assetRows, obsRows, fdRows, today);
  const latest = latestObservations(obsRows);
  const valued = new Map(p.valued.map((v) => [v.assetId, v]));
  const ownerName = new Map(
    (owners.data ?? []).map((o) => [o.id as string, o.display_name as string]),
  );
  const rows: GridRow[] = assetRows
    .map((a): GridRow => {
      const obs = latest.get(a.id);
      const line = p.lines[a.id]!;
      return {
        id: a.id,
        name: a.nickname,
        owner: ownerName.get(a.owner_id) ?? '—',
        type: a.type,
        group: GROUPS[a.type]?.[1] ?? 'Other',
        currency: a.currency,
        mode: 'value',
        latestAmount: obs ? Number(obs.amount) : null,
        latestAsOf: obs?.as_of ?? null,
        freshness: line.freshness,
        estimatedToday: valued.get(a.id)?.estimate?.estimatedAmount ?? null,
        fxRate: obs?.fx_rate ? Number(obs.fx_rate) : null,
        interestRate: a.interest_rate ?? null,
        tdsRate: a.tds_rate ?? null,
        status: a.status,
        origin: sourceTag(obs?.source ?? null, obs?.as_of ?? null, false),
      };
    })
    .sort(
      (x, y) =>
        (GROUPS[x.type]?.[0] ?? 99) - (GROUPS[y.type]?.[0] ?? 99) ||
        x.owner.localeCompare(y.owner) ||
        x.name.localeCompare(y.name),
    );
  return { rows, today: today.toISOString().slice(0, 10) };
}
