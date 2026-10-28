import { addDaysIso } from '@fwos/core';
import type { BankStatement } from '@fwos/ingest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { balanceOn, lineKeys, monthBalances } from './statement-store';

/** The recorded balances of the account inside the statement's days that the statement shows to be different. */
export async function conflictingBalances(db: SupabaseClient, assetId: string, s: BankStatement) {
  const { data } = await db
    .from('observations')
    .select('id, as_of, amount')
    .eq('asset_id', assetId)
    .eq('kind', 'balance')
    .is('superseded_by', null)
    .gte('as_of', s.from!)
    .lte('as_of', s.to!);
  return ((data ?? []) as { id: string; as_of: string; amount: number }[])
    .map((o) => ({ ...o, proved: balanceOn(s, o.as_of) }))
    .filter((o) => o.proved !== null && Math.abs(Number(o.amount) - o.proved) > 1);
}

/**
 * Saves a statement read for one account: the statement, its new lines (an overlapping statement adds nothing twice), the balances it
 * proves at each month's end (a different recorded balance on a day it covers is replaced, never deleted) and, when the statement
 * prints it, the day the account was opened. The movements are rebuilt separately (rebuildStatementMoves), once for many statements.
 */
export async function saveBankStatement(
  db: SupabaseClient,
  householdId: string,
  assetId: string,
  s: BankStatement,
  fileName: string,
): Promise<{ statementId: string; lines: number; balances: number; opened: boolean }> {
  const { data: st, error: e1 } = await db
    .from('bank_statements')
    .insert({
      household_id: householdId,
      asset_id: assetId,
      from_on: s.from,
      to_on: s.to,
      opening: s.opening,
      closing: s.closing,
      line_count: s.lines.length,
      layout: s.layout,
      breaks: s.breaks,
      file_label: fileName.replace(/\d{6,}/g, (m) => `…${m.slice(-4)}`).slice(0, 120),
    })
    .select('id')
    .single();
  if (e1 || !st) throw new Error(`The statement could not be saved: ${e1?.message ?? ''}`);
  const statementId = st.id as string;
  const keys = lineKeys(s.lines);
  const rows = s.lines.map((l, i) => ({
    household_id: householdId,
    statement_id: statementId,
    asset_id: assetId,
    txn_on: l.date,
    amount: Math.round((l.credit - l.debit) * 100) / 100,
    balance: l.balance,
    narration: l.narration,
    line_key: keys[i]!,
  }));
  let added = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const { data, error } = await db
      .from('statement_lines')
      .upsert(rows.slice(i, i + 500), {
        onConflict: 'household_id,asset_id,line_key',
        ignoreDuplicates: true,
      })
      .select('id');
    if (error) throw new Error(`The lines could not be saved: ${error.message}`);
    added += data?.length ?? 0;
  }

  // the balances the statement proves, and the recorded ones it shows to be different
  const wrong = await conflictingBalances(db, assetId, s);
  const { data: existing } = await db
    .from('observations')
    .select('as_of, amount')
    .eq('asset_id', assetId)
    .eq('kind', 'balance')
    .is('superseded_by', null)
    .gte('as_of', addDaysIso(s.from!, -1))
    .lte('as_of', s.to!);
  const have = new Set(
    ((existing ?? []) as { as_of: string; amount: number }[])
      .filter((o) => !wrong.some((w) => w.as_of === o.as_of))
      .map((o) => `${o.as_of}|${Math.round(Number(o.amount))}`),
  );
  const proven = new Map<string, number>();
  for (const b of monthBalances(s)) proven.set(b.date, b.amount);
  for (const w of wrong) proven.set(w.as_of, w.proved!);
  let balances = 0;
  const now = new Date().toISOString();
  for (const [date, amount] of proven) {
    if (have.has(`${date}|${Math.round(amount)}`)) continue;
    const { data: obs, error } = await db
      .from('observations')
      .insert({
        household_id: householdId,
        asset_id: assetId,
        kind: 'balance',
        amount,
        currency: 'INR',
        fx_rate: null,
        as_of: date,
        received_at: now,
        source: 'statement',
        source_ref: `stmt:${statementId}:${date}`,
        confidence: 'verified',
        note: 'Balance from a bank statement',
      })
      .select('id')
      .single();
    if (error || !obs) continue;
    balances++;
    for (const w of wrong.filter((x) => x.as_of === date))
      await db
        .from('observations')
        .update({ superseded_by: obs.id as string })
        .eq('id', w.id);
  }

  // the day the account was opened, as the bank prints it
  let opened = false;
  if (s.openedOn) {
    const { error } = await db
      .from('assets')
      .update({
        opened_on: s.openedOn,
        opened_after: addDaysIso(s.openedOn, -1),
        opened_note: 'The opening date printed on the bank statement',
      })
      .eq('id', assetId)
      .eq('household_id', householdId);
    opened = !error;
  }
  return { statementId, lines: added, balances, opened };
}
