'use server';

import { revalidatePath } from 'next/cache';
import { loadContext } from '@/lib/data';
import type { AddFundPayload, FundSavePayload } from '@/lib/fund-edit';
import { saveAccountDetails } from '../accounts/edit/actions';
import { saveNominee } from '../accounts/actions';
import { tagFundGoal } from './actions';
import { addFundTransaction } from './update/actions';

export interface EditResult {
  ok: boolean;
  message: string;
}

const UUID = /^[0-9a-f-]{36}$/;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clean = (m: string) => m.replace(/^.*ERROR:\s*/, '').slice(0, 300);

const refresh = (assetId?: string) => {
  revalidatePath('/investments');
  if (assetId) revalidatePath(`/asset/${assetId}`);
  revalidatePath('/goals');
  revalidatePath('/', 'layout');
};

/**
 * Saves what was changed in a fund's edit panel. Units, amount invested and the SIP go through the same database function as the
 * monthly update (save_fund_update) when units are given, otherwise straight to the saved position; names and status go through the
 * account-details function; the goal through the goal tag. Every step is checked by the database and by row-level security.
 */
export async function saveFundEdit(p: FundSavePayload): Promise<EditResult> {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return { ok: false, message: 'Create your household first.' };
  if (!p || !UUID.test(String(p.assetId ?? '')))
    return { ok: false, message: 'That fund could not be found.' };
  const bad = (m: string): EditResult => ({ ok: false, message: m });
  if (p.units !== undefined && (!num(p.units) || p.units < 0)) return bad('Units are not valid.');
  if (p.value !== undefined && (!num(p.value) || p.value < 0))
    return bad('The value is not valid.');
  if (p.nav !== undefined && p.nav !== null && (!num(p.nav) || p.nav <= 0))
    return bad('The price is not valid.');
  if (p.invested !== undefined && (!num(p.invested) || p.invested < 0))
    return bad('The amount invested is not valid.');
  if (
    p.sipMonthly !== undefined &&
    p.sipMonthly !== null &&
    (!num(p.sipMonthly) || p.sipMonthly <= 0)
  )
    return bad('The SIP amount is not valid.');
  if (p.startedOn !== undefined && p.startedOn !== null && !ISO.test(p.startedOn))
    return bad('The start date is not valid.');
  if (p.asOf !== undefined && !ISO.test(p.asOf)) return bad('The date is not valid.');
  if (p.goalId !== undefined && p.goalId !== '' && !UUID.test(p.goalId))
    return bad('The goal is not valid.');
  if (p.status !== undefined && p.status !== 'active' && p.status !== 'closed')
    return bad('The status is not valid.');
  if (p.planType !== undefined && !['direct', 'regular', 'regular_or_unknown'].includes(p.planType))
    return bad('The plan is not valid.');

  const done: string[] = [];
  const position: Record<string, unknown> = {};
  if (p.units !== undefined) {
    if (!num(p.value)) return bad('A value is needed with the units.');
    const row: Record<string, unknown> = {
      assetId: p.assetId,
      asOf: p.asOf ?? new Date().toISOString().slice(0, 10),
      units: p.units,
      nav: p.nav ?? null,
      value: p.value,
    };
    if (p.invested !== undefined) row.invested = p.invested;
    if (p.sipMonthly !== undefined) row.sipMonthly = p.sipMonthly;
    if (p.sipStopped !== undefined) row.sipStopped = p.sipStopped;
    const r = await supabase.rpc('save_fund_update', { p_household: householdId, p_rows: [row] });
    if (r.error) return bad(clean(r.error.message));
    done.push('units');
  } else {
    if (p.invested !== undefined) position.invested = p.invested;
    if (p.sipMonthly !== undefined) position.sip_monthly = p.sipMonthly;
    if (p.sipStopped !== undefined) position.sip_stopped = p.sipStopped;
  }
  if (p.startedOn !== undefined) position.started_on = p.startedOn;
  if (p.planType !== undefined) position.plan_type = p.planType;
  if (p.exitLoadPct !== undefined) {
    position.exit_load_pct = p.exitLoadPct;
    position.exit_load_days = p.exitLoadDays ?? null;
  }
  if (Object.keys(position).length > 0) {
    const r = await supabase
      .from('mf_positions')
      .update(position)
      .eq('asset_id', p.assetId)
      .eq('household_id', householdId);
    if (r.error) return bad(`That could not be saved: ${clean(r.error.message)}`);
    done.push('details');
  }
  if (p.label !== undefined || p.status !== undefined) {
    const row: Record<string, unknown> = { id: p.assetId };
    if (p.label !== undefined) row.label = p.label;
    if (p.status !== undefined) row.status = p.status;
    const r = await saveAccountDetails([row]);
    if (!r.ok) return bad(r.message);
    done.push('name');
  }
  if (p.nominee !== undefined) {
    const r = await saveNominee(p.assetId, p.nominee);
    if (!r.ok) return bad(done.length > 0 ? `Saved, but not the nominee: ${r.message}` : r.message);
    done.push('nominee');
  }
  if (p.goalId !== undefined) {
    const r = await tagFundGoal(p.assetId, p.goalId);
    if (!r.ok)
      return bad(done.length > 0 ? `Saved, but the goal was not: ${r.message}` : r.message);
    done.push('goal');
  }
  refresh(p.assetId);
  return { ok: true, message: 'Saved.' };
}

/** Adds a fund by hand (a person, a name, the amount put in and the value now), with an optional goal. */
export async function addFund(p: AddFundPayload): Promise<EditResult & { assetId?: string }> {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return { ok: false, message: 'Create your household first.' };
  if (!p || !UUID.test(String(p.ownerId ?? '')) || typeof p.name !== 'string')
    return { ok: false, message: 'Choose whose fund it is and give it a name.' };
  if (!num(p.invested) || !num(p.value))
    return { ok: false, message: 'The amounts are not valid.' };
  if (p.goalId !== '' && !UUID.test(String(p.goalId ?? '')))
    return { ok: false, message: 'The goal is not valid.' };
  const r = await supabase.rpc('add_mutual_fund', {
    p_household: householdId,
    p: {
      ownerId: p.ownerId,
      name: p.name,
      invested: p.invested,
      value: p.value,
      units: p.units,
      startedOn: p.startedOn,
      sipMonthly: p.sipMonthly,
      planType: p.planType,
    },
  });
  if (r.error) return { ok: false, message: clean(r.error.message) };
  const id = String(r.data);
  if (p.goalId) await tagFundGoal(id, p.goalId);
  refresh(id);
  return {
    ok: true,
    message:
      'Fund added. Match it to its official scheme (Match funds) so its price follows the market.',
    assetId: id,
  };
}

/** One transaction typed by hand: the same database function as the form on the Update funds tab. */
export async function addFundTxn(values: Record<string, string>): Promise<EditResult> {
  const f = new FormData();
  for (const k of ['asset', 'date', 'kind', 'amount', 'units', 'nav', 'all'])
    f.set(k, String(values?.[k] ?? ''));
  const r = await addFundTransaction(null, f);
  if (r.ok) refresh(String(values.asset));
  return r;
}
