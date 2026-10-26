'use server';

import { revalidatePath } from 'next/cache';
import { loadContext } from '@/lib/data';
import { saveMonthly } from '../monthly/actions';
import { POLICY_KIND, parseAmount } from '@/lib/others-summary';

export interface Result {
  ok: boolean;
  message: string;
}

const uuid = /^[0-9a-f-]{36}$/;
const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const todayIso = () => new Date().toISOString().slice(0, 10);
const text = (f: FormData, k: string, max = 500) =>
  String(f.get(k) ?? '')
    .trim()
    .slice(0, max);
const date = (f: FormData, k: string) => (isoDate.test(text(f, k, 10)) ? text(f, k, 10) : null);

const refresh = () => {
  revalidatePath('/others');
  revalidatePath('/');
};

export async function recordRepayment(_prev: Result | null, f: FormData): Promise<Result> {
  const asset = text(f, 'asset', 40);
  const amount = parseAmount(text(f, 'amount', 30));
  const on = text(f, 'on', 10);
  if (!uuid.test(asset)) return { ok: false, message: 'Choose the loan.' };
  if (amount === null)
    return { ok: false, message: 'Enter the amount received, for example 50,000.' };
  if (!isoDate.test(on) || on > todayIso())
    return { ok: false, message: 'Choose the date it was received (today or earlier).' };
  const { supabase, householdId } = await loadContext();
  if (!householdId) return { ok: false, message: 'Create your household first.' };
  const { error } = await supabase
    .from('receivable_payments')
    .insert({ household_id: householdId, asset_id: asset, amount, paid_on: on });
  if (error) return { ok: false, message: 'That could not be saved. Nothing was recorded.' };
  refresh();
  return { ok: true, message: 'Repayment recorded. The amount owed is updated.' };
}

export async function setExpectedDate(_prev: Result | null, f: FormData): Promise<Result> {
  const asset = text(f, 'asset', 40);
  const on = text(f, 'on', 10);
  if (!uuid.test(asset)) return { ok: false, message: 'Choose the loan.' };
  const { supabase, householdId } = await loadContext();
  if (!householdId) return { ok: false, message: 'Create your household first.' };
  const { error } = await supabase
    .from('receivables')
    .update({ expected_on: isoDate.test(on) ? on : null })
    .eq('asset_id', asset)
    .eq('household_id', householdId);
  if (error) return { ok: false, message: 'That could not be saved.' };
  refresh();
  return { ok: true, message: on ? 'Expected date saved.' : 'Expected date removed.' };
}

export async function addLoan(_prev: Result | null, f: FormData): Promise<Result> {
  const owner = text(f, 'owner', 40);
  const who = text(f, 'who', 120);
  const lent = parseAmount(text(f, 'lent', 30));
  const lentOn = text(f, 'lent_on', 10);
  const expected = text(f, 'expected', 10);
  const gift = text(f, 'kind', 10) === 'gift';
  if (!uuid.test(owner)) return { ok: false, message: 'Choose who lent the money.' };
  if (!who) return { ok: false, message: 'Enter the name of the person or firm it was lent to.' };
  if (lent === null) return { ok: false, message: 'Enter the amount lent, for example 2,00,000.' };
  if (lentOn && (!isoDate.test(lentOn) || lentOn > todayIso()))
    return { ok: false, message: 'The date it was lent cannot be in the future.' };
  if (expected && !isoDate.test(expected))
    return { ok: false, message: 'The expected date is not a valid date.' };
  const { supabase, householdId } = await loadContext();
  if (!householdId) return { ok: false, message: 'Create your household first.' };
  const { data: asset, error } = await supabase
    .from('assets')
    .insert({
      household_id: householdId,
      type: 'receivable',
      owner_id: owner,
      nickname: `${gift ? 'Gift to' : 'Loan to'} ${who}`,
      // a gift is kept for the record but is not wealth: the status keeps it out of every total
      status: gift ? 'gifted' : 'active',
    })
    .select('id')
    .single();
  if (error || !asset)
    return {
      ok: false,
      message: 'That could not be added. A loan to the same name may already be listed.',
    };
  const { error: e2 } = await supabase.from('receivables').insert({
    asset_id: asset.id,
    household_id: householdId,
    counterparty: who,
    lent,
    lent_on: lentOn || null,
    expected_on: gift ? null : expected || null,
  });
  // do not leave an orphan asset behind if the second insert is refused
  if (e2) {
    await supabase.from('assets').delete().eq('id', asset.id);
    return { ok: false, message: 'That could not be added; nothing was saved.' };
  }
  refresh();
  return {
    ok: true,
    message: gift
      ? `Gift to ${who} recorded. It is not counted anywhere.`
      : `Loan to ${who} added.`,
  };
}

/** Turns a recorded loan into a gift (not counted, never chased) or back into a loan that counts again. */
export async function setLoanKind(_prev: Result | null, f: FormData): Promise<Result> {
  const asset = text(f, 'asset', 40);
  const gift = text(f, 'kind', 10) === 'gift';
  if (!uuid.test(asset)) return { ok: false, message: 'Choose the loan.' };
  const { supabase, householdId } = await loadContext();
  if (!householdId) return { ok: false, message: 'Create your household first.' };
  const { data, error } = await supabase
    .from('assets')
    .update({ status: gift ? 'gifted' : 'active' })
    .eq('id', asset)
    .eq('household_id', householdId)
    .eq('type', 'receivable')
    .select('id');
  if (error || !data?.length) return { ok: false, message: 'That could not be saved.' };
  refresh();
  return {
    ok: true,
    message: gift
      ? 'Marked as a gift: it is no longer counted or chased.'
      : 'Counted as a loan again.',
  };
}

/** Quick update of the dates, nominee and documents of a policy. */
export async function updatePolicy(_prev: Result | null, f: FormData): Promise<Result> {
  const id = text(f, 'id', 40);
  if (!uuid.test(id)) return { ok: false, message: 'Choose the policy.' };
  const { supabase, householdId } = await loadContext();
  if (!householdId) return { ok: false, message: 'Create your household first.' };
  const { error } = await supabase
    .from('policies')
    .update({
      renewal_on: date(f, 'renewal'),
      expires_on: date(f, 'expires'),
      nominee_note: text(f, 'nominee') || null,
      documents_note: text(f, 'documents') || null,
    })
    .eq('id', id)
    .eq('household_id', householdId);
  if (error) return { ok: false, message: 'That could not be saved.' };
  revalidatePath('/others');
  revalidatePath(`/policy/${id}`);
  revalidatePath('/emergency');
  return { ok: true, message: 'Saved. Reminders follow the new dates.' };
}

function readPolicy(
  f: FormData,
): { error: string } | { row: Record<string, unknown>; insured: string[] } {
  const kind = text(f, 'kind', 20);
  const insurer = text(f, 'insurer', 120);
  const last4 = text(f, 'ref', 4);
  if (!(kind in POLICY_KIND)) return { error: 'Choose the kind of policy.' };
  if (!insurer) return { error: 'Enter the name of the insurer.' };
  if (last4 && !/^[A-Za-z0-9]{1,4}$/.test(last4))
    return { error: 'The policy number: only the last four letters or digits.' };
  const insured = f
    .getAll('insured')
    .map(String)
    .filter((x) => uuid.test(x));
  return {
    row: {
      kind,
      insurer,
      coverage_text: text(f, 'coverage', 300) || null,
      policy_ref_last4: last4 || null,
      paid_by: text(f, 'paid_by', 120) || null,
      renewal_on: date(f, 'renewal'),
      expires_on: date(f, 'expires'),
      nominee_note: text(f, 'nominee') || null,
      documents_note: text(f, 'documents') || null,
    },
    insured,
  };
}

export async function addPolicy(_prev: Result | null, f: FormData): Promise<Result> {
  const read = readPolicy(f);
  if ('error' in read) return { ok: false, message: read.error };
  const { supabase, householdId } = await loadContext();
  if (!householdId) return { ok: false, message: 'Create your household first.' };
  const { data, error } = await supabase
    .from('policies')
    .insert({ household_id: householdId, ...read.row })
    .select('id')
    .single();
  if (error || !data) return { ok: false, message: 'That could not be added; nothing was saved.' };
  if (read.insured.length > 0) {
    const { error: e2 } = await supabase
      .from('policy_insured')
      .insert(
        read.insured.map((o) => ({ policy_id: data.id, owner_id: o, household_id: householdId })),
      );
    if (e2) {
      await supabase.from('policies').delete().eq('id', data.id);
      return { ok: false, message: 'That could not be added; nothing was saved.' };
    }
  }
  revalidatePath('/others');
  revalidatePath('/emergency');
  return { ok: true, message: 'Policy added. Its renewal and end dates feed the reminders.' };
}

/** The whole policy, from its own page: every field and who is insured. */
export async function savePolicy(_prev: Result | null, f: FormData): Promise<Result> {
  const id = text(f, 'id', 40);
  if (!uuid.test(id)) return { ok: false, message: 'Choose the policy.' };
  const read = readPolicy(f);
  if ('error' in read) return { ok: false, message: read.error };
  const { supabase, householdId } = await loadContext();
  if (!householdId) return { ok: false, message: 'Create your household first.' };
  const { error } = await supabase
    .from('policies')
    .update({ ...read.row, notes: text(f, 'notes') || null })
    .eq('id', id)
    .eq('household_id', householdId);
  if (error) return { ok: false, message: 'That could not be saved.' };
  const del = await supabase
    .from('policy_insured')
    .delete()
    .eq('policy_id', id)
    .eq('household_id', householdId);
  if (del.error) return { ok: false, message: 'The policy was saved but who is insured was not.' };
  if (read.insured.length > 0) {
    const ins = await supabase
      .from('policy_insured')
      .insert(read.insured.map((o) => ({ policy_id: id, owner_id: o, household_id: householdId })));
    if (ins.error)
      return { ok: false, message: 'The policy was saved but who is insured was not.' };
  }
  revalidatePath('/others');
  revalidatePath(`/policy/${id}`);
  revalidatePath('/emergency');
  return { ok: true, message: 'Saved.' };
}

const HOLDING_TYPES = new Set(['property', 'nps', 'ulip', 'other']);

/** A property, NPS, ULIP or other holding with its first value. */
export async function addHolding(_prev: Result | null, f: FormData): Promise<Result> {
  const owner = text(f, 'owner', 40);
  const type = text(f, 'type', 20);
  const name = text(f, 'name', 120);
  const amount = parseAmount(text(f, 'amount', 30));
  const asOf = text(f, 'as_of', 10);
  if (!uuid.test(owner)) return { ok: false, message: 'Choose whose it is.' };
  if (!HOLDING_TYPES.has(type)) return { ok: false, message: 'Choose what kind of holding it is.' };
  if (!name) return { ok: false, message: 'Give it a name, for example "Flat in Kochi".' };
  if (amount === null)
    return { ok: false, message: 'Enter its value in rupees, for example 85,00,000.' };
  if (!isoDate.test(asOf) || asOf > todayIso())
    return { ok: false, message: 'Choose the date of this value (today or earlier).' };
  const { supabase, householdId } = await loadContext();
  if (!householdId) return { ok: false, message: 'Create your household first.' };
  const { data: asset, error } = await supabase
    .from('assets')
    .insert({ household_id: householdId, type, owner_id: owner, nickname: name })
    .select('id')
    .single();
  if (error || !asset)
    return { ok: false, message: 'That could not be added. The same name may already be listed.' };
  const saved = await saveMonthly([{ assetId: asset.id as string, amount, asOf }]);
  if (!saved.ok) {
    await supabase.from('assets').delete().eq('id', asset.id);
    return { ok: false, message: 'The value could not be saved, so nothing was added.' };
  }
  refresh();
  return { ok: true, message: `${name} added with its value.` };
}

/** A new dated value for a property or other holding. Earlier values stay as history. */
export async function recordHoldingValue(_prev: Result | null, f: FormData): Promise<Result> {
  const asset = text(f, 'asset', 40);
  const amount = parseAmount(text(f, 'amount', 30));
  const asOf = text(f, 'as_of', 10);
  if (!uuid.test(asset)) return { ok: false, message: 'Choose the holding.' };
  if (amount === null) return { ok: false, message: 'Enter the new value in rupees.' };
  if (!isoDate.test(asOf) || asOf > todayIso())
    return { ok: false, message: 'Choose the date of this value (today or earlier).' };
  const saved = await saveMonthly([{ assetId: asset, amount, asOf }]);
  if (!saved.ok) return { ok: false, message: saved.message };
  refresh();
  return { ok: true, message: 'New value recorded. The earlier value stays in the history.' };
}
