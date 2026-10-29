'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { loadContext } from '@/lib/data';
import { buildTxn, type TxnDraft } from '@/lib/fund-edit';

export interface FundActionResult {
  ok: boolean;
  message: string;
}

const UUID = /^[0-9a-f-]{36}$/;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const clean = (m: string) => m.replace(/^.*ERROR:\s*/, '').slice(0, 300);
const fail = (message: string): FundActionResult => ({ ok: false, message });

const refresh = (assetId: string) => {
  revalidatePath('/investments');
  revalidatePath(`/asset/${assetId}`);
  revalidatePath('/', 'layout');
};

/** Corrects a line entered by hand (or from an app export): its date, kind and figures. The fund's units and cost move with it. */
export async function editFundTxn(
  assetId: string,
  txnId: string,
  draft: Omit<TxnDraft, 'asset'>,
): Promise<FundActionResult> {
  if (!UUID.test(assetId) || !UUID.test(txnId)) return fail('Unknown transaction.');
  const today = new Date().toISOString().slice(0, 10);
  const r = buildTxn({ ...draft, asset: assetId, all: false }, today);
  if (!r.values) return fail(`Check ${r.problems.join(', ')}.`);
  const { supabase, householdId } = await loadContext();
  if (!householdId) return fail('Create your household first.');
  const res = await supabase.rpc('edit_fund_transaction', {
    p_household: householdId,
    p_id: txnId,
    p: {
      date: r.values.date,
      kind: r.values.kind,
      amount: Number(r.values.amount),
      units: r.values.units === '' ? null : Number(r.values.units),
      nav: r.values.nav === '' ? null : Number(r.values.nav),
    },
  });
  if (res.error) return fail(clean(res.error.message));
  refresh(assetId);
  revalidatePath(`/asset/${assetId}/txn/${txnId}`);
  return { ok: true, message: 'Corrected; the fund’s units and amount invested follow.' };
}

/** Removes a line. A line from a fund statement comes back with the next statement that covers its date. */
export async function deleteFundTxn(assetId: string, txnId: string): Promise<FundActionResult> {
  if (!UUID.test(assetId) || !UUID.test(txnId)) return fail('Unknown transaction.');
  const { supabase, householdId } = await loadContext();
  if (!householdId) return fail('Create your household first.');
  const res = await supabase.rpc('delete_fund_transaction', {
    p_household: householdId,
    p_id: txnId,
  });
  if (res.error) return fail(clean(res.error.message));
  refresh(assetId);
  redirect(`/asset/${assetId}?tab=transactions`);
}

/**
 * Changes the SIP from a date: a new amount, a stop (0), or a pause (0 with the date it starts again at the amount it had). Dates in
 * the past and up to two years ahead are taken; the fund's "SIP a month" shows the amount in force today.
 */
export async function scheduleSip(input: {
  assetId: string;
  from: string;
  monthly: number;
  resumeOn?: string | null;
}): Promise<FundActionResult> {
  const { assetId, from, monthly } = input;
  const resumeOn = input.resumeOn || null;
  if (!UUID.test(assetId)) return fail('Unknown fund.');
  if (!ISO.test(from)) return fail('Choose the date the change applies from.');
  if (resumeOn && !ISO.test(resumeOn)) return fail('The restart date is not valid.');
  if (!Number.isFinite(monthly) || monthly < 0) return fail('Enter the amount (₹0 stops the SIP).');
  if (resumeOn && monthly !== 0)
    return fail('A pause stops the SIP; it restarts at its earlier amount.');
  const { supabase, householdId } = await loadContext();
  if (!householdId) return fail('Create your household first.');
  const res = await supabase.rpc('schedule_sip', {
    p_household: householdId,
    p_asset: assetId,
    p_from: from,
    p_monthly: monthly,
    p_resume_on: resumeOn,
  });
  if (res.error) return fail(clean(res.error.message));
  refresh(assetId);
  const back = (res.data as { resumeAmount?: number | null } | null)?.resumeAmount ?? null;
  return {
    ok: true,
    message: resumeOn
      ? `Paused from ${from}; it starts again on ${resumeOn}${back ? ` at ₹${Number(back).toLocaleString('en-IN')} a month` : ''}.`
      : monthly === 0
        ? `Stopped from ${from}.`
        : `₹${monthly.toLocaleString('en-IN')} a month from ${from}.`,
  };
}

/** Takes back one dated change of the SIP. */
export async function removeSipChange(assetId: string, on: string): Promise<FundActionResult> {
  if (!UUID.test(assetId) || !ISO.test(on)) return fail('Unknown change.');
  const { supabase, householdId } = await loadContext();
  if (!householdId) return fail('Create your household first.');
  const res = await supabase.rpc('remove_sip_change', {
    p_household: householdId,
    p_asset: assetId,
    p_on: on,
  });
  if (res.error) return fail(clean(res.error.message));
  refresh(assetId);
  return { ok: true, message: `The change of ${on} is taken back.` };
}

/** The savings account the SIP is paid from (or none): its estimated balance goes down on each instalment date. */
export async function setSipAccount(
  assetId: string,
  accountId: string | null,
): Promise<FundActionResult> {
  if (!UUID.test(assetId) || (accountId !== null && !UUID.test(accountId)))
    return fail('Unknown account.');
  const { supabase, householdId } = await loadContext();
  if (!householdId) return fail('Create your household first.');
  const res = await supabase
    .from('mf_positions')
    .update({ sip_from_asset_id: accountId })
    .eq('asset_id', assetId)
    .eq('household_id', householdId)
    .select('asset_id');
  if (res.error) return fail(clean(res.error.message));
  if (!res.data || res.data.length === 0) return fail('Unknown fund.');
  refresh(assetId);
  if (accountId) revalidatePath(`/asset/${accountId}`);
  revalidatePath('/accounts');
  return {
    ok: true,
    message: accountId
      ? 'Saved: each instalment now comes out of that account’s estimated balance.'
      : 'Saved: no account is linked, so instalments are not taken off any balance.',
  };
}
