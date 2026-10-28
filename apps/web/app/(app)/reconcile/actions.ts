'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { loadContext } from '@/lib/data';
import { saveAccountDetails } from '../accounts/edit/actions';

const UUID = /^[0-9a-f-]{36}$/;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

interface Move {
  moved_on: string;
  amount: number;
  from_asset_id: string | null;
  to_asset_id: string | null;
  kind: string;
  note?: string;
  idem_key: string;
}

/** Back to the page with a message; a movement written twice (a double click) is reported as already recorded. */
function done(message: string): never {
  revalidatePath('/reconcile');
  revalidatePath('/');
  redirect(`/reconcile?msg=${encodeURIComponent(message)}`);
}

async function write(moves: Move[]): Promise<'ok' | 'duplicate' | string> {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return 'Create your household first.';
  const rows = moves.map((m) => ({
    ...m,
    household_id: householdId,
    status: 'confirmed',
    source: 'manual',
  }));
  const r = await supabase.from('money_moves').insert(rows);
  if (!r.error) return 'ok';
  if (r.error.code === '23505') return 'duplicate';
  return `That could not be saved: ${r.error.message}`;
}

/** Marks a deposit as matured (its money has been placed): the same check as "Confirm matured" on Accounts. */
async function markMatured(assetId: string) {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return;
  const { data } = await supabase
    .from('assets')
    .select('status')
    .eq('id', assetId)
    .eq('household_id', householdId)
    .maybeSingle();
  if (data && (data.status === 'active' || data.status === 'matured_unconfirmed'))
    await saveAccountDetails([{ id: assetId, status: 'matured' }]);
}

const money = (v: FormDataEntryValue | null) => {
  const n = Number(String(v ?? '').replace(/[₹,\s]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
};

/** Where a matured deposit's proceeds went: an account, a new deposit, or out of the family. Never assumed: this is the answer. */
export async function confirmProceeds(f: FormData): Promise<void> {
  const fd = String(f.get('fd') ?? '');
  const dest = String(f.get('dest') ?? '');
  const on = String(f.get('on') ?? '');
  const amount = money(f.get('amount'));
  if (!UUID.test(fd) || !ISO.test(on) || amount === null || !(dest === 'out' || UUID.test(dest)))
    done('Choose where the money went, the date and the amount.');
  const r = await write([
    {
      moved_on: on,
      amount,
      from_asset_id: fd,
      to_asset_id: dest === 'out' ? null : dest,
      kind: 'fd_proceeds',
      idem_key: `proceeds:${fd}`,
    },
  ]);
  if (r !== 'ok' && r !== 'duplicate') done(r);
  await markMatured(fd);
  done(r === 'duplicate' ? 'Already recorded.' : 'Recorded where the proceeds went.');
}

/** What a balance difference was: outside money, the proceeds of a deposit, a transfer from another account, or a correction. */
export async function explainBalance(f: FormData): Promise<void> {
  const account = String(f.get('account') ?? '');
  const on = String(f.get('on') ?? '');
  const key = String(f.get('key') ?? '');
  const diff = Number(f.get('difference'));
  const answer = String(f.get('answer') ?? '');
  const other = String(f.get('other') ?? '');
  if (
    !UUID.test(account) ||
    !ISO.test(on) ||
    !/^recon:/.test(key) ||
    !Number.isFinite(diff) ||
    diff === 0
  )
    done('That difference could not be found.');
  const amount = Math.round(Math.abs(diff) * 100) / 100;
  const into = diff > 0;
  let move: Move;
  if (answer === 'outside')
    move = {
      moved_on: on,
      amount,
      from_asset_id: into ? null : account,
      to_asset_id: into ? account : null,
      kind: into ? 'contribution' : 'withdrawal',
      idem_key: key,
    };
  else if (answer === 'correction')
    move = {
      moved_on: on,
      amount,
      from_asset_id: into ? null : account,
      to_asset_id: into ? account : null,
      kind: 'adjustment',
      idem_key: key,
    };
  else if (answer.startsWith('proceeds:') && UUID.test(answer.slice(9)))
    move = {
      moved_on: on,
      amount,
      from_asset_id: answer.slice(9),
      to_asset_id: account,
      kind: 'fd_proceeds',
      idem_key: key,
    };
  else if (answer.startsWith('pair:') && UUID.test(answer.slice(5)) && answer.slice(5) !== account)
    // the matching change in another of your accounts: one transfer, which clears both lines
    move = {
      moved_on: on,
      amount,
      from_asset_id: into ? answer.slice(5) : account,
      to_asset_id: into ? account : answer.slice(5),
      kind: 'transfer',
      idem_key: key,
    };
  else if (answer.startsWith('funding:') && UUID.test(answer.slice(8)) && !into)
    // the money opened a new deposit: it moved between your own holdings, and the deposit's source is recorded too
    move = {
      moved_on: on,
      amount,
      from_asset_id: account,
      to_asset_id: answer.slice(8),
      kind: 'fd_funding',
      idem_key: key,
    };
  else if (answer === 'transfer' && UUID.test(other) && other !== account)
    move = {
      moved_on: on,
      amount,
      from_asset_id: into ? other : account,
      to_asset_id: into ? account : other,
      kind: 'transfer',
      idem_key: key,
    };
  else done('Choose what the difference was.');
  const r = await write([move]);
  if (r !== 'ok' && r !== 'duplicate') done(r);
  if (answer.startsWith('proceeds:')) await markMatured(answer.slice(9));
  done(
    r === 'duplicate' ? 'Already recorded.' : 'Recorded. Own money and profit now use your answer.',
  );
}

/** Where the money for a new deposit came from: a savings account, the proceeds of another deposit, or outside money. */
export async function recordFunding(f: FormData): Promise<void> {
  const fd = String(f.get('fd') ?? '');
  const source = String(f.get('source') ?? '');
  const on = String(f.get('on') ?? '');
  const amount = money(f.get('amount'));
  if (!UUID.test(fd) || !ISO.test(on) || amount === null) done('Choose where the money came from.');
  let move: Move;
  if (source === 'outside')
    move = {
      moved_on: on,
      amount,
      from_asset_id: null,
      to_asset_id: fd,
      kind: 'contribution',
      idem_key: `fund:${fd}`,
    };
  else if (source.startsWith('proceeds:') && UUID.test(source.slice(9)))
    move = {
      moved_on: on,
      amount,
      from_asset_id: source.slice(9),
      to_asset_id: fd,
      kind: 'fd_proceeds',
      idem_key: `fund:${fd}`,
    };
  else if (UUID.test(source) && source !== fd)
    move = {
      moved_on: on,
      amount,
      from_asset_id: source,
      to_asset_id: fd,
      kind: 'fd_funding',
      idem_key: `fund:${fd}`,
    };
  else done('Choose where the money came from.');
  const r = await write([move]);
  if (r !== 'ok' && r !== 'duplicate') done(r);
  if (source.startsWith('proceeds:')) await markMatured(source.slice(9));
  done(r === 'duplicate' ? 'Already recorded.' : 'Recorded where the money came from.');
}

const MONTH = /^\d{4}-\d{2}$/;

/**
 * What the unexplained money of an earlier month was (Explain movements > Earlier months): money from outside, money taken out, or
 * earnings the app did not estimate (interest, a bonus, a refund). One confirmed movement, dated inside the month, on the holding you
 * chose; the month's remaining amount is worked out again from it. Saving the same answer twice changes nothing.
 */
export async function recordHistory(f: FormData): Promise<void> {
  const month = String(f.get('month') ?? '');
  const answer = String(f.get('answer') ?? '');
  const asset = String(f.get('asset') ?? '');
  const on = String(f.get('on') ?? '');
  const amount = money(f.get('amount'));
  if (
    !MONTH.test(month) ||
    !ISO.test(on) ||
    on.slice(0, 7) !== month ||
    !UUID.test(asset) ||
    amount === null ||
    !['outside', 'out', 'income'].includes(answer)
  )
    historyDone('Choose what it was, the holding, a date in that month and the amount.');
  const move: Move =
    answer === 'out'
      ? {
          moved_on: on,
          amount,
          from_asset_id: asset,
          to_asset_id: null,
          kind: 'withdrawal',
          idem_key: `hist:${month}:out:${Math.round(amount)}`,
        }
      : {
          moved_on: on,
          amount,
          from_asset_id: null,
          to_asset_id: asset,
          kind: answer === 'income' ? 'income' : 'contribution',
          idem_key: `hist:${month}:${answer}:${Math.round(amount)}`,
        };
  const r = await write([move]);
  if (r !== 'ok' && r !== 'duplicate') historyDone(r);
  historyDone(
    r === 'duplicate'
      ? 'Already recorded.'
      : answer === 'income'
        ? 'Recorded as earnings: lifetime profit now includes it.'
        : 'Recorded. Own money now uses your answer and its date.',
  );
}

/** Takes back an answer given for an earlier month: the month's money is "not yet explained" again. */
export async function undoHistory(f: FormData): Promise<void> {
  const key = String(f.get('key') ?? '');
  if (!/^hist:\d{4}-\d{2}:(outside|out|income):\d+$/.test(key))
    historyDone('That answer was not found.');
  const { supabase, householdId } = await loadContext();
  if (!householdId) historyDone('Create your household first.');
  const { error } = await supabase
    .from('money_moves')
    .delete()
    .eq('household_id', householdId!)
    .eq('idem_key', key);
  historyDone(error ? `That could not be undone: ${error.message}` : 'Answer taken back.');
}

function historyDone(message: string): never {
  revalidatePath('/reconcile');
  revalidatePath('/');
  redirect(`/reconcile?tab=history&msg=${encodeURIComponent(message)}`);
}

const FY = /^\d{4}-\d{2}$/;

/**
 * Records the difference between the interest the tax department was told about (AIS or Form 26AS) and the interest the app estimated
 * for one person's taxable accounts in one finished year (Explain movements > Interest). It is earnings, not money moved: one confirmed
 * movement of kind income on the account you chose, dated the year's last day, into the account when the banks paid more than the
 * estimate and out of it when they paid less. One answer per person and year; saving it again changes nothing.
 */
export async function recordInterestDifference(f: FormData): Promise<void> {
  const fy = String(f.get('fy') ?? '');
  const owner = String(f.get('owner') ?? '');
  const asset = String(f.get('asset') ?? '');
  const direction = String(f.get('direction') ?? '');
  const amount = money(f.get('amount'));
  if (
    !FY.test(fy) ||
    !UUID.test(owner) ||
    !UUID.test(asset) ||
    amount === null ||
    !['more', 'less'].includes(direction)
  )
    interestDone('Choose the account and the amount.');
  const end = `${Number(fy.slice(0, 4)) + 1}-03-31`;
  if (end >= new Date().toISOString().slice(0, 10))
    interestDone('A year still running cannot be settled: wait until it ends.');
  const { supabase, householdId } = await loadContext();
  if (!householdId) interestDone('Create your household first.');
  const { data: held } = await supabase
    .from('assets')
    .select('id')
    .eq('id', asset)
    .eq('owner_id', owner)
    .eq('household_id', householdId!)
    .maybeSingle();
  if (!held) interestDone('Choose one of that person’s own accounts.');
  const r = await write([
    {
      moved_on: end,
      amount,
      from_asset_id: direction === 'more' ? null : asset,
      to_asset_id: direction === 'more' ? asset : null,
      kind: 'income',
      note: `Interest reported for ${fy} against the app's estimate`,
      idem_key: `ais:${owner}:${fy}`,
    },
  ]);
  if (r !== 'ok' && r !== 'duplicate') interestDone(r);
  interestDone(
    r === 'duplicate'
      ? 'That year is already settled. Undo it first to record a different amount.'
      : 'Recorded as earnings for that year: lifetime profit now matches the interest reported.',
  );
}

/** Takes back a settled year: its difference is "not yet explained" again. */
export async function undoInterestDifference(f: FormData): Promise<void> {
  const key = String(f.get('key') ?? '');
  if (!/^ais:[0-9a-f-]{36}:\d{4}-\d{2}$/.test(key)) interestDone('That answer was not found.');
  const { supabase, householdId } = await loadContext();
  if (!householdId) interestDone('Create your household first.');
  const { error } = await supabase
    .from('money_moves')
    .delete()
    .eq('household_id', householdId!)
    .eq('idem_key', key);
  interestDone(error ? `That could not be undone: ${error.message}` : 'Answer taken back.');
}

function interestDone(message: string): never {
  revalidatePath('/reconcile');
  revalidatePath('/');
  redirect(`/reconcile?tab=interest&msg=${encodeURIComponent(message)}`);
}
