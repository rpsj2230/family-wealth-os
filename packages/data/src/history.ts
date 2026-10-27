import { buildCoverage, type Coverage, type CoverageAccount } from '@fwos/core';
import {
  type ExistingAsset,
  type HistoryExisting,
  type HistoryExistingObs,
  type HistoryIo,
  type NewHistoricalAsset,
} from '@fwos/ingest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { pageAll } from './paging';

const must = <T>(r: { data: T | null; error: { message: string } | null }, what: string): T => {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data as T;
};

interface AssetRec {
  id: string;
  type: string;
  status: string;
  nickname: string;
  label: string | null;
  identifier_last4: string | null;
  account_kind: string | null;
  is_joint: boolean | null;
  holder_name: string | null;
  currency: string;
  owner_id: string;
  institution_id: string | null;
}

const ASSET_COLS =
  'id, type, status, nickname, label, identifier_last4, account_kind, is_joint, holder_name, currency, owner_id, institution_id';

/** Everything the history planner needs to know about what is on file: accounts, deposits, funds and every dated value. */
export async function loadHistoryExisting(
  db: SupabaseClient,
  hh: string,
): Promise<{ existing: HistoryExisting; owners: string[] }> {
  const [owners, insts, assets, fds, pos, alloc, goals] = await Promise.all([
    db.from('owners').select('id, display_name').eq('household_id', hh).order('created_at'),
    db.from('institutions').select('id, name').eq('household_id', hh),
    pageAll<AssetRec>((from, to) =>
      db.from('assets').select(ASSET_COLS).eq('household_id', hh).order('id').range(from, to),
    ),
    db
      .from('fixed_deposits')
      .select('asset_id, principal, rate, booked_on, maturity_on, fd_ref, fd_ref_last4')
      .eq('household_id', hh),
    db
      .from('mf_positions')
      .select('asset_id, fund_name, folio_last4, started_on')
      .eq('household_id', hh),
    db.from('goal_allocations').select('asset_id, goal_id').eq('household_id', hh),
    db.from('goals').select('id, name').eq('household_id', hh),
  ]);
  const ownerName = new Map(
    must(owners, 'owners').map((o) => [o.id as string, o.display_name as string]),
  );
  const bank = new Map(must(insts, 'institutions').map((i) => [i.id as string, i.name as string]));
  const fd = new Map(
    (must(fds, 'deposits') as unknown as Record<string, unknown>[]).map((f) => [
      f.asset_id as string,
      {
        principal: Number(f.principal),
        rate: Number(f.rate),
        bookedOn: f.booked_on as string,
        maturityOn: f.maturity_on as string,
        ref: (f.fd_ref as string | null) ?? null,
        refLast4: (f.fd_ref_last4 as string | null) ?? null,
      },
    ]),
  );
  const position = new Map(
    (must(pos, 'funds') as unknown as Record<string, unknown>[]).map((p) => [
      p.asset_id as string,
      p,
    ]),
  );
  const goalName = new Map(must(goals, 'goals').map((g) => [g.id as string, g.name as string]));
  const goalOf = new Map(
    must(alloc, 'goal allocations').map((a) => [
      a.asset_id as string,
      goalName.get(a.goal_id as string) ?? null,
    ]),
  );
  const wanted = new Set([
    'bank_account',
    'third_party_held',
    'fixed_deposit',
    'mutual_fund',
    'ulip',
    'receivable',
  ]);
  const list: ExistingAsset[] = assets
    .filter((a) => wanted.has(a.type))
    .map((a) => {
      const p = position.get(a.id);
      return {
        id: a.id,
        type: a.type,
        status: a.status,
        nickname: a.nickname,
        label: a.label,
        last4: a.identifier_last4,
        accountKind: a.account_kind,
        joint: !!a.is_joint,
        holderName: a.holder_name,
        currency: a.currency,
        ownerName: ownerName.get(a.owner_id) ?? '',
        bank: a.institution_id ? (bank.get(a.institution_id) ?? null) : null,
        fd: fd.get(a.id) ?? null,
        fundName: (p?.fund_name as string | undefined) ?? null,
        folioLast4: (p?.folio_last4 as string | undefined) ?? null,
        startedOn: (p?.started_on as string | undefined) ?? null,
        goal: goalOf.get(a.id) ?? null,
      };
    });
  const ids = new Set(list.map((a) => a.id));
  const obs = await pageAll<Record<string, unknown>>((from, to) =>
    db
      .from('observations')
      .select(
        'id, asset_id, as_of, amount, currency, source, source_ref, confidence, superseded_by',
      )
      .eq('household_id', hh)
      .order('as_of')
      .order('id')
      .range(from, to),
  );
  const observations: HistoryExistingObs[] = obs
    .filter((o) => ids.has(o.asset_id as string))
    .map((o) => ({
      id: o.id as string,
      assetId: o.asset_id as string,
      asOf: o.as_of as string,
      amount: Number(o.amount),
      currency: (o.currency as string).trim(),
      source: o.source as string,
      sourceRef: (o.source_ref as string | null) ?? null,
      confidence: o.confidence as string,
      supersededBy: (o.superseded_by as string | null) ?? null,
    }));
  return { existing: { assets: list, observations }, owners: [...ownerName.values()] };
}

/** Reads and writes for the history importer. Works with a signed-in user's client: row level security applies. */
export function historyIo(db: SupabaseClient, hh: string): HistoryIo {
  const institutionId = async (name: string): Promise<string> => {
    const found = must(
      await db.from('institutions').select('id, name').eq('household_id', hh),
      'banks',
    ).find((i) => (i.name as string).trim().toLowerCase() === name.trim().toLowerCase());
    if (found) return found.id as string;
    const made = await db
      .from('institutions')
      .insert({ household_id: hh, name: name.trim(), kind: 'bank' })
      .select('id')
      .single();
    if (made.error) throw new Error(`new bank: ${made.error.message}`);
    return made.data.id as string;
  };
  return {
    async createAsset(a: NewHistoricalAsset) {
      const owners = must(
        await db.from('owners').select('id, display_name').eq('household_id', hh),
        'people',
      );
      const owner = owners.find(
        (o) => (o.display_name as string).trim().toLowerCase() === a.ownerName.trim().toLowerCase(),
      );
      if (!owner) return { error: `${a.ownerName} is not one of the people in this household.` };
      const inst = a.bank ? await institutionId(a.bank) : null;
      let id: string | null = null;
      let lastError = '';
      for (let n = 1; n <= 4 && !id; n++) {
        const nickname = n === 1 ? a.nickname : `${a.nickname} #${n}`;
        const r = await db
          .from('assets')
          .insert({
            household_id: hh,
            type: a.type,
            owner_id: owner.id,
            institution_id: inst,
            holder_name: a.holderName,
            nickname,
            label: a.label.slice(0, 200),
            identifier_last4: a.last4,
            account_kind: a.accountKind,
            is_joint: a.joint,
            currency: a.currency,
            status: a.status,
            notes: a.notes,
            from_history: true,
          })
          .select('id')
          .single();
        if (!r.error) id = r.data.id as string;
        else lastError = r.error.message;
        if (r.error && !/duplicate|unique/i.test(r.error.message)) break;
      }
      if (!id) return { error: lastError || 'could not be added' };
      if (a.fd) {
        const digits = (a.fd.ref ?? '').split('-')[0]!.replace(/\D/g, '');
        const f = await db.from('fixed_deposits').insert({
          asset_id: id,
          household_id: hh,
          principal: a.fd.principal,
          rate: a.fd.rate,
          booked_on: a.fd.bookedOn,
          maturity_on: a.fd.maturityOn,
          compounding: 'quarterly',
          bank_maturity_amount: a.fd.maturityAmount,
          fd_ref: a.fd.ref,
          fd_ref_last4: digits ? digits.slice(-4) : a.last4,
          ended_on: a.fd.endedOn,
          ended_estimated: true,
          start_estimated: a.fd.startEstimated,
        });
        if (f.error) {
          await db.from('assets').delete().eq('id', id).eq('household_id', hh);
          return { error: f.error.message };
        }
      }
      return { id };
    },
    async insertObservation(o) {
      const r = await db
        .from('observations')
        .insert({
          household_id: hh,
          asset_id: o.assetId,
          kind: o.kind,
          amount: o.amount,
          currency: o.currency,
          fx_rate: o.currency === 'INR' ? null : o.fxRate,
          as_of: o.asOf,
          source: 'workbook',
          source_ref: o.sourceRef,
          confidence: 'imported_unverified',
          note: o.note,
        })
        .select('id')
        .single();
      if (r.error) throw new Error(r.error.message);
      return r.data.id as string;
    },
    async supersede(oldId, newId) {
      const r = await db
        .from('observations')
        .update({ superseded_by: newId })
        .eq('id', oldId)
        .eq('household_id', hh)
        .is('superseded_by', null);
      if (r.error) throw new Error(r.error.message);
    },
    async fillFdNumber(assetId, ref) {
      const r = await db
        .from('fixed_deposits')
        .update({ fd_ref: ref })
        .eq('asset_id', assetId)
        .eq('household_id', hh)
        .is('fd_ref', null)
        .select('asset_id');
      if (r.error) throw new Error(r.error.message);
      return (r.data ?? []).length > 0;
    },
  };
}

/** The coverage grid: every savings or cash account and every deposit, month by month. */
export async function loadCoverage(
  db: SupabaseClient,
  hh: string,
  today: string,
): Promise<Coverage> {
  const [owners, insts, assets, fds] = await Promise.all([
    db.from('owners').select('id, display_name').eq('household_id', hh),
    db.from('institutions').select('id, name').eq('household_id', hh),
    pageAll<AssetRec>((from, to) =>
      db
        .from('assets')
        .select(ASSET_COLS)
        .eq('household_id', hh)
        .in('type', ['bank_account', 'fixed_deposit'])
        .order('id')
        .range(from, to),
    ),
    db
      .from('fixed_deposits')
      .select('asset_id, booked_on, maturity_on, ended_on')
      .eq('household_id', hh),
  ]);
  const ownerName = new Map(
    must(owners, 'owners').map((o) => [o.id as string, o.display_name as string]),
  );
  const bank = new Map(must(insts, 'institutions').map((i) => [i.id as string, i.name as string]));
  const fd = new Map(
    (must(fds, 'deposits') as unknown as Record<string, string | null>[]).map((f) => [
      f.asset_id as string,
      f,
    ]),
  );
  const ids = new Set(assets.filter((a) => a.type === 'bank_account').map((a) => a.id));
  const obs = await pageAll<Record<string, unknown>>((from, to) =>
    db
      .from('observations')
      .select('asset_id, as_of, superseded_by')
      .eq('household_id', hh)
      .order('as_of')
      .order('id')
      .range(from, to),
  );
  const accounts: CoverageAccount[] = assets
    .filter((a) => a.status !== 'gifted')
    .map((a) => {
      const f = fd.get(a.id);
      return {
        id: a.id,
        label: a.label ?? a.nickname,
        owner: ownerName.get(a.owner_id) ?? '',
        bank: a.institution_id ? (bank.get(a.institution_id) ?? null) : null,
        kind: a.type === 'fixed_deposit' ? ('fd' as const) : ('cash' as const),
        status: a.status,
        from: f?.booked_on ?? null,
        to: f ? (f.ended_on ?? f.maturity_on ?? null) : null,
      };
    });
  return buildCoverage(
    accounts,
    obs
      .filter((o) => ids.has(o.asset_id as string))
      .map((o) => ({
        asset_id: o.asset_id as string,
        as_of: o.as_of as string,
        superseded_by: (o.superseded_by as string | null) ?? null,
      })),
    today,
  );
}
