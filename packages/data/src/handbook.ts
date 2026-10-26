import {
  buildBankBlocks,
  buildHandbook,
  profileFromJson,
  receivableStatus,
  type Handbook,
  type HandbookInput,
} from '@fwos/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadPortfolioData } from './index';

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
    scoped('mf_positions', 'asset_id, fund_name, invested, sip_monthly, sip_stopped'),
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
  const ownerName: Record<string, string> = Object.fromEntries(
    owners.map((o) => [o.id, o.display_name]),
  );
  const names = Object.fromEntries(
    ((inst.data ?? []) as unknown as { id: string; name: string }[]).map((i) => [i.id, i.name]),
  );
  const banks = buildBankBlocks({
    assets: l.assetRows,
    observations: l.obsRows,
    fds: l.fdRows,
    portfolio: l.portfolio,
    institutionNames: names,
    today: l.today,
  });
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
    funds: (
      (pos.data ?? []) as unknown as {
        asset_id: string;
        fund_name: string;
        invested: number | null;
        sip_monthly: number | null;
        sip_stopped: boolean;
      }[]
    ).map((f) => ({
      owner: ownerName[assetBy.get(f.asset_id)?.owner_id ?? ''] ?? '',
      fund: f.fund_name,
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
  };
}

export async function buildHandbookDoc(
  db: SupabaseClient,
  opts: { householdId?: string; today?: Date } = {},
): Promise<Handbook> {
  return buildHandbook(await loadHandbookInput(db, opts));
}
