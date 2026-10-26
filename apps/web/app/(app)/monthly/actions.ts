'use server';

import { revalidatePath } from 'next/cache';
import { loadContext } from '@/lib/data';
import { recordSnapshot } from '@/lib/portfolio-data';
import type { Change } from '@/lib/monthly';

export interface SaveResult {
  ok: boolean;
  message: string;
}

const STATUSES = new Set([
  'active',
  'matured_unconfirmed',
  'renewed',
  'closed',
  'stopped',
  'matured',
]);

export async function saveMonthly(changes: Change[]): Promise<SaveResult> {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return { ok: false, message: 'Create your household first.' };
  if (!Array.isArray(changes) || changes.length === 0)
    return { ok: false, message: 'Nothing to save.' };
  if (changes.length > 500) return { ok: false, message: 'Too many changes in one save.' };

  const rows = changes.map((c) => ({
    assetId: String(c.assetId),
    ...(typeof c.amount === 'number' ? { amount: c.amount } : {}),
    ...(typeof c.asOf === 'string' ? { asOf: c.asOf } : {}),
    ...(typeof c.fxRate === 'number' ? { fxRate: c.fxRate } : {}),
    ...(c.interestRate !== undefined ? { interestRate: c.interestRate } : {}),
    ...(typeof c.notes === 'string' ? { notes: c.notes.slice(0, 500) } : {}),
    ...(typeof c.fdRate === 'number' ? { fdRate: c.fdRate } : {}),
    ...(typeof c.fdMaturityAmount === 'number' ? { fdMaturityAmount: c.fdMaturityAmount } : {}),
    ...(typeof c.status === 'string' && STATUSES.has(c.status) ? { status: c.status } : {}),
  }));
  const { data, error } = await supabase.rpc('save_monthly_update', {
    p_household: householdId,
    p_rows: rows,
  });
  if (error) {
    const m = error.message;
    const friendly = /future/.test(m)
      ? 'A date is in the future.'
      : /exchange rate/.test(m)
        ? 'An exchange rate is missing.'
        : /negative/.test(m)
          ? 'A value is negative.'
          : 'The update was refused and nothing was saved.';
    return { ok: false, message: friendly };
  }
  await recordSnapshot(supabase, householdId, 'monthly_update');
  revalidatePath('/');
  revalidatePath('/monthly');
  const d = data as { observations: number; settings: number };
  return {
    ok: true,
    message: `Saved ${d.observations} new values and ${d.settings} setting changes. Earlier values are kept as history.`,
  };
}

export interface AddItemInput {
  type: 'bank_account' | 'fixed_deposit';
  ownerId: string;
  institutionId: string;
  accountKind: 'NRE' | 'NRO' | '';
  isJoint: boolean;
  last4: string;
  notes: string;
  principal?: string;
  ratePct?: string;
  bookedOn?: string;
  maturityOn?: string;
  maturityAmount?: string;
  refLast4?: string;
}

/** Adds a savings account or a fixed deposit where it belongs in your order. */
export async function addBankItem(i: AddItemInput): Promise<SaveResult> {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return { ok: false, message: 'Create your household first.' };
  const uuid = /^[0-9a-f-]{36}$/;
  const num = (v: string | undefined) =>
    v && /^\d+(\.\d+)?$/.test(v.replace(/[₹,\s]/g, '')) ? Number(v.replace(/[₹,\s]/g, '')) : null;
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (!uuid.test(i.ownerId) || !uuid.test(i.institutionId))
    return { ok: false, message: 'Choose a person and a bank.' };
  if (i.last4 && !/^[A-Za-z0-9-]{1,4}$/.test(i.last4))
    return { ok: false, message: 'Last digits: up to 4 letters or numbers.' };
  const p: Record<string, unknown> = {
    type: i.type,
    ownerId: i.ownerId,
    institutionId: i.institutionId,
    accountKind: i.accountKind || null,
    isJoint: !!i.isJoint,
    last4: i.last4 || null,
    notes: i.notes.slice(0, 500),
  };
  if (i.type === 'fixed_deposit') {
    const principal = num(i.principal);
    const rate = num(i.ratePct);
    if (!principal || principal <= 0) return { ok: false, message: 'Enter the amount invested.' };
    if (rate === null || rate <= 0 || rate >= 30)
      return { ok: false, message: 'Enter the interest rate, for example 7.5.' };
    if (
      !i.bookedOn ||
      !iso.test(i.bookedOn) ||
      !i.maturityOn ||
      !iso.test(i.maturityOn) ||
      i.maturityOn <= i.bookedOn
    )
      return { ok: false, message: 'Enter a start date and a later maturity date.' };
    const mat = num(i.maturityAmount);
    const refFull = (i.refLast4 ?? '').trim();
    if (refFull && !/^[A-Za-z0-9-]{1,40}$/.test(refFull))
      return { ok: false, message: 'The deposit number: letters, digits and dashes only.' };
    const refLast4 =
      refFull.length > 4
        ? refFull.split('-')[0]!.replace(/\D/g, '').slice(-4) || refFull.slice(-4)
        : refFull;
    Object.assign(p, {
      principal,
      rate: Math.round(rate * 1e4) / 1e6,
      bookedOn: i.bookedOn,
      maturityOn: i.maturityOn,
      ...(mat ? { maturityAmount: mat } : {}),
      refLast4: refLast4 || null,
    });
  }
  const { error } = await supabase.rpc('add_bank_item', { p_household: householdId, p });
  if (error) return { ok: false, message: 'That could not be added; nothing was saved.' };
  const whole = (i.refLast4 ?? '').trim();
  if (i.type === 'fixed_deposit' && whole.length >= 4 && p.refLast4)
    await supabase.rpc('set_fd_numbers', {
      p_household: householdId,
      p_rows: [{ institutionId: i.institutionId, last4: p.refLast4, fdRef: whole }],
    });
  revalidatePath('/monthly');
  revalidatePath('/accounts');
  revalidatePath('/');
  return { ok: true, message: i.type === 'fixed_deposit' ? 'Deposit added.' : 'Account added.' };
}
