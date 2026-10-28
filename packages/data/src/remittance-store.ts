import { remittanceDestinations, type Classified, type DestinationAccount } from '@fwos/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import { pageAll } from './paging';

interface RemitRow {
  id: string;
  received_on: string;
  amount_inr: number;
  to_asset_id: string | null;
  to_basis: string | null;
  from_asset_id: string | null;
  candidate_asset_ids: string[];
}

const PROVEN = new Set(['statement', 'person']);
const addDays = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/**
 * Where each transfer from Singapore went, from the best evidence there is, in this order:
 *  1. a credit in an account's bank statement that is the transfer (the classifier's remittanceId): proven;
 *  2. otherwise the accounts it is sent to, less those it cannot be: not open yet, or whose statements cover the day without it;
 *     of the rest, the only one, or the one whose recorded balances show it (core remittance.ts).
 * A destination you set, or one a statement proves, is never changed by a weaker answer. Returns how many changed.
 */
export async function placeRemittances(
  db: SupabaseClient,
  householdId: string,
  classified: Classified[] = [],
  lineAsset: Map<string, string> = new Map(),
): Promise<{ proven: number; inferred: number; open: number }> {
  const rows = await pageAll<RemitRow>((a, b) =>
    db
      .from('remittances')
      .select(
        'id, received_on, amount_inr, to_asset_id, to_basis, from_asset_id, candidate_asset_ids',
      )
      .eq('household_id', householdId)
      .range(a, b),
  );
  if (rows.length === 0) return { proven: 0, inferred: 0, open: 0 };
  const update = async (
    id: string,
    to: string | null,
    basis: string | null,
    note: string | null,
  ) => {
    const { error } = await db
      .from('remittances')
      .update({ to_asset_id: to, to_basis: basis, to_note: note })
      .eq('id', id)
      .eq('household_id', householdId);
    if (error) throw new Error(`transfer: ${error.message}`);
  };

  // 1. proven by a statement
  const seen = new Map<string, string>();
  for (const c of classified)
    if (c.remittanceId && lineAsset.has(c.id)) seen.set(c.remittanceId, lineAsset.get(c.id)!);
  let proven = 0;
  for (const r of rows) {
    const at = seen.get(r.id);
    if (!at || r.to_basis === 'person') continue;
    if (r.to_asset_id !== at || r.to_basis !== 'statement') {
      await update(r.id, at, 'statement', 'The credit is in this account’s bank statement');
      proven++;
    }
    r.to_asset_id = at;
    r.to_basis = 'statement';
  }

  // 2. the rest, from what rules accounts out and the balances
  const rest = rows.filter((r) => !PROVEN.has(r.to_basis ?? ''));
  const ids = [...new Set(rows.flatMap((r) => r.candidate_asset_ids))];
  if (rest.length === 0 || ids.length === 0) return { proven, inferred: 0, open: 0 };
  const [assets, obs, fds, fdAssets, statements] = await Promise.all([
    db
      .from('assets')
      .select('id, owner_id, institution_id, opened_after')
      .eq('household_id', householdId)
      .in('id', ids),
    pageAll<{ asset_id: string; as_of: string; amount: number }>((a, b) =>
      db
        .from('observations')
        .select('asset_id, as_of, amount')
        .eq('household_id', householdId)
        .eq('kind', 'balance')
        .is('superseded_by', null)
        .in('asset_id', ids)
        .order('as_of')
        .order('id')
        .range(a, b),
    ),
    pageAll<{ asset_id: string; booked_on: string; principal: number }>((a, b) =>
      db
        .from('fixed_deposits')
        .select('asset_id, booked_on, principal')
        .eq('household_id', householdId)
        .range(a, b),
    ),
    pageAll<{ id: string; owner_id: string; institution_id: string | null }>((a, b) =>
      db
        .from('assets')
        .select('id, owner_id, institution_id')
        .eq('household_id', householdId)
        .eq('type', 'fixed_deposit')
        .range(a, b),
    ),
    pageAll<{
      asset_id: string;
      from_on: string;
      to_on: string;
      opening: number | null;
      closing: number | null;
    }>((a, b) =>
      db
        .from('bank_statements')
        .select('asset_id, from_on, to_on, opening, closing')
        .eq('household_id', householdId)
        .in('asset_id', ids)
        .order('from_on')
        .range(a, b),
    ),
  ]);
  if (assets.error) throw new Error(assets.error.message);
  const accounts: DestinationAccount[] = (
    (assets.data ?? []) as {
      id: string;
      owner_id: string;
      institution_id: string | null;
      opened_after: string | null;
    }[]
  ).map((a) => ({
    assetId: a.id,
    ownerId: a.owner_id,
    institutionId: a.institution_id,
    openedAfter: a.opened_after,
  }));
  // the days each account's statements cover without a break: one statement's opening is the last one's closing
  const runs = new Map<string, { from: string; to: string }[]>();
  for (const s of statements) {
    const list = runs.get(s.asset_id) ?? [];
    const last = list[list.length - 1];
    const prevClosing = (last as { closing?: number | null } | undefined)?.closing;
    if (
      last &&
      s.opening !== null &&
      prevClosing !== undefined &&
      prevClosing !== null &&
      Math.abs(Number(s.opening) - Number(prevClosing)) < 1
    )
      last.to = s.to_on > last.to ? s.to_on : last.to;
    else list.push({ from: s.from_on, to: s.to_on });
    (list[list.length - 1] as { closing?: number | null }).closing = s.closing;
    runs.set(s.asset_id, list);
  }
  const covered = (assetId: string, date: string) =>
    (runs.get(assetId) ?? []).some((r) => date >= r.from && addDays(date, 4) <= r.to);
  const candidates = new Map(rows.map((r) => [r.id, new Set(r.candidate_asset_ids)]));
  const fdOf = new Map(fdAssets.map((a) => [a.id, a]));
  const found = remittanceDestinations({
    transfers: rest.map((r) => ({ id: r.id, date: r.received_on, amount: Number(r.amount_inr) })),
    accounts,
    balances: obs.map((o) => ({ assetId: o.asset_id, date: o.as_of, amount: Number(o.amount) })),
    deposits: fds
      .filter((f) => fdOf.has(f.asset_id))
      .map((f) => ({
        ownerId: fdOf.get(f.asset_id)!.owner_id,
        institutionId: fdOf.get(f.asset_id)!.institution_id,
        bookedOn: f.booked_on,
        principal: Number(f.principal),
      })),
    ruledOut: (t, a) =>
      !candidates.get(t)?.has(a) || covered(a, rest.find((r) => r.id === t)!.received_on),
  });
  let inferred = 0;
  let open = 0;
  for (const d of found) {
    const r = rest.find((x) => x.id === d.id)!;
    if (!d.assetId) open++;
    else inferred++;
    if ((d.assetId ?? null) !== r.to_asset_id || (d.basis ?? null) !== r.to_basis)
      await update(r.id, d.assetId, d.basis, d.assetId ? d.reason.slice(0, 300) : null);
  }
  return { proven, inferred, open };
}

/**
 * The ledger's movements for the transfers: one confirmed transfer from the Singapore account to the Indian account for each transfer
 * whose account is known (idem key wise:<id>), kept exactly in step with the transfers on file.
 */
export async function syncRemittanceMoves(
  db: SupabaseClient,
  householdId: string,
): Promise<{ added: number; removed: number; kept: number }> {
  const [final, existing] = await Promise.all([
    pageAll<RemitRow>((a, b) =>
      db
        .from('remittances')
        .select(
          'id, received_on, amount_inr, to_asset_id, to_basis, from_asset_id, candidate_asset_ids',
        )
        .eq('household_id', householdId)
        .range(a, b),
    ),
    pageAll<{
      id: string;
      idem_key: string;
      to_asset_id: string | null;
      amount: number;
      moved_on: string;
    }>((a, b) =>
      db
        .from('money_moves')
        .select('id, idem_key, to_asset_id, amount, moved_on')
        .eq('household_id', householdId)
        .like('idem_key', 'wise:%')
        .range(a, b),
    ),
  ]);
  const moves = final
    .filter((r) => r.to_asset_id && r.from_asset_id)
    .map((r) => ({
      household_id: householdId,
      moved_on: r.received_on,
      amount: Number(r.amount_inr),
      from_asset_id: r.from_asset_id,
      to_asset_id: r.to_asset_id,
      kind: 'transfer',
      status: 'confirmed',
      source: 'import',
      note: 'Transfer from Singapore (Wise)',
      idem_key: `wise:${r.id}`,
    }));
  const want = new Map(moves.map((m) => [m.idem_key, m]));
  const drop = existing.filter((e) => {
    const w = want.get(e.idem_key);
    return (
      !w ||
      w.to_asset_id !== e.to_asset_id ||
      w.moved_on !== e.moved_on ||
      Math.abs(w.amount - Number(e.amount)) > 0.005
    );
  });
  for (let i = 0; i < drop.length; i += 200) {
    const { error } = await db
      .from('money_moves')
      .delete()
      .in(
        'id',
        drop.slice(i, i + 200).map((d) => d.id),
      );
    if (error) throw new Error(error.message);
  }
  const kept = new Set(existing.filter((e) => !drop.includes(e)).map((e) => e.idem_key));
  const add = moves.filter((m) => !kept.has(m.idem_key));
  if (add.length) {
    const { error } = await db.from('money_moves').insert(add);
    if (error) throw new Error(error.message);
  }
  return { added: add.length, removed: drop.length, kept: kept.size };
}
