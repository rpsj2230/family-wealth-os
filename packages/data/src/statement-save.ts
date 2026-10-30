import { addDaysIso } from '@fwos/core';
import { cleanNarration, type BankStatement } from '@fwos/ingest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { balanceLessTwins, balanceOn, lineKeys, monthBalances } from './statement-store';

interface TwinLineRow {
  id: string;
  txn_on: string;
  amount: number;
  narration: string;
}

/**
 * Tidies an account whose lines were saved twice: once without balances (a download kept "lines only") and again from a statement
 * with balances. The copy without a balance goes; an answer given for it moves to its twin when the twin has none. A file left with
 * no lines goes too, and the others' line counts are put right. With write false it only counts.
 */
export async function mergeBalanceLessCopies(
  db: SupabaseClient,
  householdId: string,
  assetId: string,
  write: boolean,
): Promise<{ merged: number; answersMoved: number; filesRemoved: number }> {
  const lines: (TwinLineRow & {
    statement_id: string;
    balance: number | null;
    answer: string | null;
  })[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('statement_lines')
      .select('id, statement_id, txn_on, amount, narration, balance, answer')
      .eq('household_id', householdId)
      .eq('asset_id', assetId)
      .order('id')
      .range(from, from + 999);
    if (error) throw new Error(`statement lines: ${error.message}`);
    lines.push(...((data ?? []) as typeof lines).map((l) => ({ ...l, amount: Number(l.amount) })));
    if ((data ?? []).length < 1000) break;
  }
  const pairs = balanceLessTwins(
    lines.filter((l) => l.balance === null),
    lines.filter((l) => l.balance !== null),
  );
  const moving = pairs.filter(([bare, full]) => bare.answer && !full.answer);
  const touched = new Set(pairs.map(([bare]) => bare.statement_id));
  if (!write) return { merged: pairs.length, answersMoved: moving.length, filesRemoved: 0 };
  for (const [bare, full] of moving) {
    const { error } = await db
      .from('statement_lines')
      .update({ answer: bare.answer })
      .eq('id', full.id);
    if (error) throw new Error(`an answer could not move: ${error.message}`);
  }
  const ids = pairs.map(([bare]) => bare.id);
  for (let i = 0; i < ids.length; i += 200) {
    const { error } = await db
      .from('statement_lines')
      .delete()
      .in('id', ids.slice(i, i + 200));
    if (error) throw new Error(`the copies could not be removed: ${error.message}`);
  }
  let filesRemoved = 0;
  for (const id of touched) {
    const { count } = await db
      .from('statement_lines')
      .select('id', { count: 'exact', head: true })
      .eq('statement_id', id);
    const { error } = count
      ? await db.from('bank_statements').update({ line_count: count }).eq('id', id)
      : await db.from('bank_statements').delete().eq('id', id);
    if (error) throw new Error(`a statement file could not be tidied: ${error.message}`);
    if (!count) filesRemoved++;
  }
  return { merged: pairs.length, answersMoved: moving.length, filesRemoved };
}

/** The recorded balances of the account inside the statement's days that the statement shows to be different. */
export async function conflictingBalances(db: SupabaseClient, assetId: string, s: BankStatement) {
  const { data } = await db
    .from('observations')
    .select('id, as_of, amount, source')
    .eq('asset_id', assetId)
    .eq('kind', 'balance')
    .is('superseded_by', null)
    .gte('as_of', s.from!)
    .lte('as_of', s.to!);
  return ((data ?? []) as { id: string; as_of: string; amount: number; source: string }[])
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
): Promise<{
  statementId: string;
  lines: number;
  adopted: number;
  balances: number;
  opened: boolean;
}> {
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
  // lines already on the account without a balance (a download kept "lines only") take this statement's balance instead of being
  // added a second time; whatever was answered for them stays
  let adopted = 0;
  if (rows.length && rows.every((r) => r.balance !== null)) {
    const { data: onFile } = await db
      .from('statement_lines')
      .select('id, txn_on, amount, narration, balance, line_key')
      .eq('household_id', householdId)
      .eq('asset_id', assetId)
      .gte('txn_on', s.from!)
      .lte('txn_on', s.to!);
    const stored = (
      (onFile ?? []) as (TwinLineRow & { balance: number | null; line_key: string })[]
    ).map((l) => ({ ...l, amount: Number(l.amount) }));
    const keys = new Set(stored.map((l) => l.line_key));
    const pairs = balanceLessTwins(
      stored.filter((l) => l.balance === null),
      rows.filter((r) => !keys.has(r.line_key)),
    );
    for (const [old, row] of pairs) {
      const { error } = await db
        .from('statement_lines')
        .update({ balance: row.balance, line_key: row.line_key, statement_id: statementId })
        .eq('id', old.id);
      if (error) throw new Error(`A line could not take its balance: ${error.message}`);
      adopted++;
    }
  }
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

  // lines from bank alerts on the days this statement covers: the statement has them now, in the bank's own words. An answer given
  // for an alert line moves to the statement's line of the same day and amount; then the alert lines go.
  if (s.from && s.to) await replaceAlertLines(db, householdId, assetId, s.from, s.to, statementId);

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
  // an account cannot have opened after its first statement line: the recorded day moves back to it
  if (!s.openedOn && s.from) {
    const { data: a } = await db
      .from('assets')
      .select('opened_on')
      .eq('id', assetId)
      .eq('household_id', householdId)
      .maybeSingle();
    const on = (a as { opened_on: string | null } | null)?.opened_on ?? null;
    if (on && on > s.from) {
      const { error } = await db
        .from('assets')
        .update({
          opened_on: s.from,
          opened_after: null,
          opened_note: 'Its bank statement has lines from this day, before the day on record',
        })
        .eq('id', assetId)
        .eq('household_id', householdId);
      opened = !error;
    }
  }
  return { statementId, lines: added, adopted, balances, opened };
}

/** The file name of the lines bank alerts made: one per account, its days widened as alerts arrive. */
export const ALERTS_FILE = 'Bank alerts';

/** A short, steady tag for a Message-ID (FNV-1a), so the line key stays short. */
function messageKey(id: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(36);
}

/**
 * A movement a bank alert reported, as a statement line of the account, the day the alert arrives: so the rules, the trail and the
 * figures follow it without waiting for a statement. Its key is a statement line's (day, amount, balance after), so the same alert
 * read twice adds nothing; a day a statement already covers takes nothing from an alert. Returns whether a line was added.
 */
export async function saveAlertLine(
  db: SupabaseClient,
  householdId: string,
  l: {
    assetId: string;
    date: string;
    amount: number;
    /** null when the alert gives no balance */
    balance: number | null;
    words: string;
    /** the alert's Message-ID: a line with no balance is told apart from another of the same day and amount by it */
    messageId?: string;
  },
): Promise<boolean> {
  if (!l.amount) return false;
  const { data: covering } = await db
    .from('bank_statements')
    .select('id')
    .eq('household_id', householdId)
    .eq('asset_id', l.assetId)
    .neq('file_label', ALERTS_FILE)
    .lte('from_on', l.date)
    .gte('to_on', l.date)
    .limit(1);
  if ((covering ?? []).length) return false;
  const { data: found } = await db
    .from('bank_statements')
    .select('id, from_on, to_on, line_count, closing')
    .eq('household_id', householdId)
    .eq('asset_id', l.assetId)
    .eq('file_label', ALERTS_FILE)
    .maybeSingle();
  type AlertFile = { id: string; from_on: string; to_on: string; line_count: number };
  let st = found as AlertFile | null;
  if (!st) {
    const { data, error } = await db
      .from('bank_statements')
      .insert({
        household_id: householdId,
        asset_id: l.assetId,
        from_on: l.date,
        to_on: l.date,
        opening: null,
        closing: l.balance,
        line_count: 0,
        layout: 'balance-moves',
        breaks: 0,
        file_label: ALERTS_FILE,
      })
      .select('id, from_on, to_on, line_count')
      .single();
    if (error || !data) throw new Error(`alerts file: ${error?.message ?? ''}`);
    st = data as AlertFile;
  }
  const [balanceKey] = lineKeys([
    {
      date: l.date,
      narration: '',
      ref: null,
      debit: l.amount < 0 ? -l.amount : 0,
      credit: l.amount > 0 ? l.amount : 0,
      balance: l.balance,
    },
  ]);
  // with no balance, two payments of one amount on one day would share a key: the alert's own id keeps them apart, and the same
  // alert read twice still adds one line
  const key =
    l.balance === null && l.messageId
      ? `${balanceKey!.replace(/\|\d+$/, '')}|m${messageKey(l.messageId)}`
      : balanceKey!;
  const { data: added, error } = await db
    .from('statement_lines')
    .upsert(
      {
        household_id: householdId,
        statement_id: st!.id,
        asset_id: l.assetId,
        txn_on: l.date,
        amount: Math.round(l.amount * 100) / 100,
        balance: l.balance,
        narration: cleanNarration(`ALERT ${l.amount < 0 ? 'DEBIT' : 'CREDIT'} ${l.words}`),
        line_key: key,
      },
      { onConflict: 'household_id,asset_id,line_key', ignoreDuplicates: true },
    )
    .select('id');
  if (error) throw new Error(`alert line: ${error.message}`);
  if (!added?.length) return false;
  await db
    .from('bank_statements')
    .update({
      from_on: l.date < st!.from_on ? l.date : st!.from_on,
      to_on: l.date > st!.to_on ? l.date : st!.to_on,
      line_count: st!.line_count + 1,
      ...(l.date >= st!.to_on && l.balance !== null ? { closing: l.balance } : {}),
    })
    .eq('id', st!.id);
  return true;
}

/** Removes the alert lines of the days a statement covers, moving any answer to the statement's line of the same day and amount. */
async function replaceAlertLines(
  db: SupabaseClient,
  householdId: string,
  assetId: string,
  from: string,
  to: string,
  statementId: string,
) {
  const { data: alertFile } = await db
    .from('bank_statements')
    .select('id, line_count')
    .eq('household_id', householdId)
    .eq('asset_id', assetId)
    .eq('file_label', ALERTS_FILE)
    .maybeSingle();
  if (!alertFile) return;
  const af = alertFile as { id: string; line_count: number };
  const { data: alerts } = await db
    .from('statement_lines')
    .select('id, txn_on, amount, narration, answer')
    .eq('statement_id', af.id)
    .gte('txn_on', from)
    .lte('txn_on', to);
  const rows = (
    (alerts ?? []) as {
      id: string;
      txn_on: string;
      amount: number;
      narration: string;
      answer: string | null;
    }[]
  ).map((r) => ({ ...r, amount: Number(r.amount) }));
  if (!rows.length) return;
  const answered = rows.filter((r) => r.answer);
  if (answered.length) {
    const { data: mine } = await db
      .from('statement_lines')
      .select('id, txn_on, amount, narration, answer')
      .eq('statement_id', statementId);
    const theirs = ((mine ?? []) as typeof rows).map((r) => ({ ...r, amount: Number(r.amount) }));
    for (const [alert, line] of balanceLessTwins(answered, theirs))
      if (!line.answer)
        await db.from('statement_lines').update({ answer: alert.answer }).eq('id', line.id);
  }
  await db
    .from('statement_lines')
    .delete()
    .in(
      'id',
      rows.map((r) => r.id),
    );
  const left = af.line_count - rows.length;
  if (left > 0) await db.from('bank_statements').update({ line_count: left }).eq('id', af.id);
  else await db.from('bank_statements').delete().eq('id', af.id);
}
