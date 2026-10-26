import {
  interestRefunds,
  type AppConfig,
  type FdForFiling,
  type InterestRefund,
  type TaxRuleSet,
  effectiveRules,
  currentFy,
} from '@fwos/core';
import type { SupabaseClient } from '@supabase/supabase-js';

/** Deposits of the household in the shape the filing working papers need. Works with a user client or the service role. */
export async function loadFdsForFiling(
  db: SupabaseClient,
  householdId?: string,
): Promise<{ fds: FdForFiling[]; ownerNames: Record<string, string> }> {
  const sel = (table: string, cols: string) => {
    const q = db.from(table).select(cols);
    return householdId ? q.eq('household_id', householdId) : q;
  };
  const [assets, fds, inst, owners] = await Promise.all([
    sel('assets', 'id, owner_id, institution_id, nickname, account_kind, type'),
    sel('fixed_deposits', 'asset_id, principal, rate, booked_on, maturity_on, compounding'),
    sel('institutions', 'id, name'),
    sel('owners', 'id, display_name'),
  ]);
  const bank = new Map(
    ((inst.data ?? []) as unknown as { id: string; name: string }[]).map((i) => [i.id, i.name]),
  );
  const asset = new Map(
    ((assets.data ?? []) as unknown as Record<string, unknown>[]).map((a) => [a.id as string, a]),
  );
  const out: FdForFiling[] = [];
  for (const f of (fds.data ?? []) as unknown as Record<string, unknown>[]) {
    const a = asset.get(f.asset_id as string);
    if (!a) continue;
    const k = a.account_kind as string | null;
    out.push({
      id: f.asset_id as string,
      ownerId: a.owner_id as string,
      bank: a.institution_id
        ? (bank.get(a.institution_id as string) ?? 'Unknown bank')
        : 'Unknown bank',
      nickname: a.nickname as string,
      kind: k === 'NRE' || k === 'NRO' ? k : k === 'joint' ? 'joint' : 'unknown',
      principal: Number(f.principal),
      rate: Number(f.rate),
      bookedOn: f.booked_on as string,
      maturityOn: f.maturity_on as string,
      compounding: f.compounding as FdForFiling['compounding'],
    });
  }
  return {
    fds: out,
    ownerNames: Object.fromEntries(
      ((owners.data ?? []) as unknown as { id: string; display_name: string }[]).map((o) => [
        o.id,
        o.display_name,
      ]),
    ),
  };
}

/** Expected refunds of tax withheld on NRO deposit interest, for the financial year that contains `today`. */
export async function planInterestRefunds(
  db: SupabaseClient,
  config: AppConfig,
  rules: TaxRuleSet[],
  today: string,
  householdId?: string,
): Promise<InterestRefund[]> {
  const { fds } = await loadFdsForFiling(db, householdId);
  const cess = effectiveRules(today, rules)?.rules.cess ?? 0.04;
  return interestRefunds(fds, currentFy(today), {
    tdsRate: config.rates.nroTaxRate,
    cess,
    incomeLimit: config.refunds.incomeLimit,
    otherIncome: config.refunds.otherIncome,
  });
}

/**
 * Keeps one "interest" refund record per person per year in step with the deposits. A record already moved on
 * (tax withheld, claimed, received) is never overwritten. Returns how many were added or refreshed.
 */
export async function ensureInterestRefundRecords(
  db: SupabaseClient,
  householdId: string,
  refunds: InterestRefund[],
): Promise<number> {
  let n = 0;
  for (const r of refunds) {
    const existing = (
      await db
        .from('tds_refunds')
        .select('id, status')
        .eq('household_id', householdId)
        .eq('owner_id', r.ownerId)
        .eq('fy', r.fy)
        .eq('kind', 'interest')
        .maybeSingle()
    ).data as { id: string; status: string } | null;
    const row = {
      expected_gain: r.interest,
      expected_tds: r.tds,
      expected_refund: r.refund,
      description: r.description,
      updated_at: new Date().toISOString(),
    };
    if (!existing) {
      const { error } = await db.from('tds_refunds').insert({
        household_id: householdId,
        owner_id: r.ownerId,
        fy: r.fy,
        kind: 'interest',
        ...row,
      });
      if (error) throw new Error(`interest refund records: ${error.message}`);
      n += 1;
    } else if (existing.status === 'planned') {
      await db.from('tds_refunds').update(row).eq('id', existing.id);
      n += 1;
    }
  }
  return n;
}
