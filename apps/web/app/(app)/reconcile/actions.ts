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
