import {
  buildBankBlocks,
  buildHandbook,
  fundHouseOf,
  profileFromJson,
  receivableStatus,
  withoutHiddenDeposits,
  type Handbook,
  type HandbookInput,
} from '@fwos/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadPortfolioData } from './index';

/**
 * Reads that may run before the database update that adds their column or table (nominee notes, helplines): a missing column, a
 * missing table or any other error gives an empty answer, so the handbook still builds.
 */
async function optional<T>(q: PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  try {
    const r = await q;
    return r.error ? [] : ((r.data ?? []) as T[]);
  } catch {
    return [];
  }
}

/** Who is registered as nominee on each account, deposit and fund, by asset id (assets.nominee_note). */
export async function loadNominees(
  db: SupabaseClient,
  householdId?: string,
): Promise<Record<string, string>> {
  const q = db.from('assets').select('id, nominee_note').not('nominee_note', 'is', null);
  const rows = await optional<{ id: string; nominee_note: string | null }>(
    householdId ? q.eq('household_id', householdId) : q,
  );
  return Object.fromEntries(
    rows.filter((r) => r.nominee_note?.trim()).map((r) => [r.id, r.nominee_note!.trim()]),
  );
}

/** The helpline of each bank or other institution, by id (institutions.helpline). */
export async function loadHelplines(
  db: SupabaseClient,
  householdId?: string,
): Promise<Record<string, string>> {
  const q = db.from('institutions').select('id, helpline').not('helpline', 'is', null);
  const rows = await optional<{ id: string; helpline: string | null }>(
    householdId ? q.eq('household_id', householdId) : q,
  );
  return Object.fromEntries(
    rows.filter((r) => r.helpline?.trim()).map((r) => [r.id, r.helpline!.trim()]),
  );
}

/** Reads everything the handbook describes. Works with a member's client (row-level security) or the service role. */
export async function loadHandbookInput(
  db: SupabaseClient,
  opts: { householdId?: string; today?: Date } = {},
): Promise<HandbookInput> {
  const scoped = (table: string, cols: string) => {
    const q = db.from(table).select(cols);
    return opts.householdId ? q.eq('household_id', opts.householdId) : q;
  };
  const l = await loadPortfolioData(db, {
    ...(opts.householdId ? { householdId: opts.householdId } : {}),
    ...(opts.today ? { today: opts.today } : {}),
  });
  const [people, inst, prof, hh, pos, pol, ins, recv, pays] = await Promise.all([
    scoped(
      'owners',
      'id, display_name, dob, is_minor, guardian_id, pan_last4, tax_residency',
    ).order('created_at'),
    scoped('institutions', 'id, name'),
    scoped('emergency_profile', 'content').maybeSingle(),
    opts.householdId
      ? db.from('households').select('name').eq('id', opts.householdId).maybeSingle()
      : db.from('households').select('name').limit(1).maybeSingle(),
    scoped('mf_positions', 'asset_id, fund_name, invested, sip_monthly, sip_stopped, amfi_code'),
    scoped(
      'policies',
      'id, kind, insurer, coverage_text, paid_by, renewal_on, expires_on, nominee_note, documents_note',
    ),
    scoped('policy_insured', 'policy_id, owner_id'),
    scoped('receivables', 'asset_id, counterparty, lent, expected_on'),
    scoped('receivable_payments', 'asset_id, amount'),
  ]);
  const owners = (people.data ?? []) as unknown as {
    id: string;
    display_name: string;
    dob: string | null;
    is_minor: boolean;
    guardian_id: string | null;
    pan_last4: string | null;
    tax_residency: string | null;
  }[];
  const positions = (pos.data ?? []) as unknown as {
    asset_id: string;
    fund_name: string;
    invested: number | null;
    sip_monthly: number | null;
    sip_stopped: boolean;
    amfi_code: string | null;
  }[];
  const codes = [...new Set(positions.map((p) => p.amfi_code).filter((c): c is string => !!c))];
  const [nominees, helplines, schemes] = await Promise.all([
    loadNominees(db, opts.householdId),
    loadHelplines(db, opts.householdId),
    codes.length
      ? optional<{ code: string; amc: string | null }>(
          db.from('amfi_schemes').select('code, amc').in('code', codes),
        )
      : Promise.resolve([]),
  ]);
  const amcOf = new Map(schemes.map((x) => [x.code, x.amc]));
  const ownerName: Record<string, string> = Object.fromEntries(
    owners.map((o) => [o.id, o.display_name]),
  );
  const names = Object.fromEntries(
    ((inst.data ?? []) as unknown as { id: string; name: string }[]).map((i) => [i.id, i.name]),
  );
  // the printed handbook lists what is held and what needs a decision, not deposits that matured long ago or are confirmed
  const banks = withoutHiddenDeposits(
    buildBankBlocks({
      assets: l.assetRows,
      observations: l.obsRows,
      fds: l.fdRows,
      portfolio: l.portfolio,
      institutionNames: names,
      today: l.today,
      hideMaturedAfterDays: l.hideMaturedAfterDays,
    }),
  ).blocks;
  const value = new Map(
    l.portfolio.valued.map((v) => [v.assetId, v.estimate?.estimatedAmount ?? null]),
  );
  const assetBy = new Map(l.assetRows.map((a) => [a.id, a]));
  const insuredBy = new Map<string, string[]>();
  for (const x of (ins.data ?? []) as unknown as { policy_id: string; owner_id: string }[])
    insuredBy.set(x.policy_id, [
      ...(insuredBy.get(x.policy_id) ?? []),
      ownerName[x.owner_id] ?? '',
    ]);
  const paid = new Map<string, number>();
  for (const p of (pays.data ?? []) as unknown as { asset_id: string; amount: number }[])
    paid.set(p.asset_id, (paid.get(p.asset_id) ?? 0) + Number(p.amount));
  const todayD = l.today;
  const owed = (
    (recv.data ?? []) as unknown as {
      asset_id: string;
      counterparty: string;
      lent: number;
      expected_on: string | null;
    }[]
  )
    .map((r) => ({
      counterparty: r.counterparty,
      expectedOn: r.expected_on,
      outstanding: receivableStatus(
        {
          id: r.asset_id,
          lent: Number(r.lent),
          repayments: paid.has(r.asset_id) ? [{ amount: paid.get(r.asset_id)!, on: todayD }] : [],
          expectedOn: r.expected_on ? new Date(`${r.expected_on}T00:00:00Z`) : null,
        },
        todayD,
      ).outstanding,
    }))
    .filter((r) => r.outstanding > 0);

  const other = (types: string[]) =>
    l.assetRows
      .filter((a) => types.includes(a.type) && !['closed', 'renewed', 'stopped'].includes(a.status))
      .map((a) => ({
        owner: ownerName[a.owner_id] ?? '',
        label: a.label ?? a.nickname,
        value: value.get(a.id) ?? null,
        note: a.notes ?? null,
      }));

  return {
    asOf: l.today.toISOString().slice(0, 10),
    householdName: ((hh.data as { name: string } | null)?.name ?? 'Our household').replace(
      / household$/i,
      '',
    ),
    people: owners.map((o) => ({
      name: o.display_name,
      dob: o.dob,
      isMinor: o.is_minor,
      guardian: o.guardian_id ? (ownerName[o.guardian_id] ?? null) : null,
      panLast4: o.pan_last4,
      residency: o.tax_residency,
    })),
    profile: profileFromJson((prof.data as { content: unknown } | null)?.content),
    banks,
    ownerName,
    funds: positions.map((f) => ({
      owner: ownerName[assetBy.get(f.asset_id)?.owner_id ?? ''] ?? '',
      fund: f.fund_name,
      assetId: f.asset_id,
      house: fundHouseOf(f.fund_name, f.amfi_code ? amcOf.get(f.amfi_code) : null),
      value: value.get(f.asset_id) ?? null,
      invested: f.invested === null ? null : Number(f.invested),
      sipMonthly: f.sip_monthly === null ? null : Number(f.sip_monthly),
      sipStopped: f.sip_stopped,
    })),
    heldByOthers: l.assetRows
      .filter(
        (a) =>
          a.type === 'third_party_held' &&
          !a.institution_id &&
          !['closed', 'renewed'].includes(a.status),
      )
      .map((a) => ({
        owner: ownerName[a.owner_id] ?? '',
        label: `${a.label ?? a.nickname}${a.holder_name ? ` (in ${a.holder_name}'s name)` : ''}`,
        value: value.get(a.id) ?? null,
        note: a.notes ?? null,
      })),
    policies: (
      (pol.data ?? []) as unknown as {
        id: string;
        kind: string;
        insurer: string;
        coverage_text: string | null;
        paid_by: string | null;
        renewal_on: string | null;
        expires_on: string | null;
        nominee_note: string | null;
        documents_note: string | null;
      }[]
    ).map((p) => ({
      id: p.id,
      kind: p.kind,
      insurer: p.insurer,
      coverage: p.coverage_text ?? '',
      insured: (insuredBy.get(p.id) ?? []).filter(Boolean),
      paidBy: p.paid_by,
      renewalOn: p.renewal_on,
      expiresOn: p.expires_on,
      nominee: p.nominee_note,
      documents: p.documents_note,
    })),
    property: other(['property', 'ulip', 'nps', 'other']),
    owedToUs: owed,
    nominees,
    institutions: ((inst.data ?? []) as unknown as { id: string; name: string }[]).map((x) => ({
      id: x.id,
      name: x.name,
      helpline: helplines[x.id] ?? null,
    })),
  };
}

export async function buildHandbookDoc(
  db: SupabaseClient,
  opts: { householdId?: string; today?: Date } = {},
): Promise<Handbook> {
  return buildHandbook(await loadHandbookInput(db, opts));
}

/** One ticked step of the handbook: who ticked it and when. */
export interface HandbookTick {
  key: string;
  doneBy: string | null;
  doneAt: string;
}

/**
 * The steps the family has ticked (emergency_progress), shared by everyone who may open the handbook. Before the database update
 * that adds the table has run, nothing is ticked.
 */
export async function loadHandbookTicks(db: SupabaseClient): Promise<HandbookTick[]> {
  const rows = await optional<{ step_key: string; done_by: string | null; done_at: string }>(
    db.from('emergency_progress').select('step_key, done_by, done_at').limit(2000),
  );
  return rows.map((r) => ({ key: r.step_key, doneBy: r.done_by, doneAt: r.done_at }));
}
