import { classifyLines, neededFromYou, type AppConfig, type Need } from '@fwos/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadPortfolioData, type LoadedPortfolio } from './index';
import { pageAll } from './paging';
import { loadSettings } from './settings';
import { classifyContext, loadStatements, stmtLinesOf } from './statement-store';

const PREFIX = 'needed:';
const PROVEN = new Set(['statement', 'person']);

/** What is still needed from the household, worked out from what is on file (core needed-from-you.ts). */
export async function loadNeeds(
  db: SupabaseClient,
  householdId: string,
  pre?: {
    loaded?: LoadedPortfolio;
    config?: AppConfig;
    stored?: Awaited<ReturnType<typeof loadStatements>>;
    toAnswer?: number;
  },
): Promise<Need[]> {
  const loaded = pre?.loaded ?? (await loadPortfolioData(db, { householdId }));
  const config = pre?.config ?? (await loadSettings(db, householdId)).config;
  const stored = pre?.stored ?? (await loadStatements(db, householdId));
  const [recorded, remits, opened] = await Promise.all([
    pageAll<{ asset_id: string; as_of: string; amount: number; source: string }>((a, b) =>
      db
        .from('observations')
        .select('asset_id, as_of, amount, source')
        .eq('household_id', householdId)
        .eq('kind', 'balance')
        .is('superseded_by', null)
        .neq('source', 'statement')
        .range(a, b),
    ),
    pageAll<{
      received_on: string;
      amount_inr: number;
      to_basis: string | null;
      candidate_asset_ids: string[];
    }>((a, b) =>
      db
        .from('remittances')
        .select('received_on, amount_inr, to_basis, candidate_asset_ids')
        .eq('household_id', householdId)
        .range(a, b),
    ),
    pageAll<{ id: string; opened_on: string | null }>((a, b) =>
      db
        .from('assets')
        .select('id, opened_on')
        .eq('household_id', householdId)
        .eq('type', 'bank_account')
        .range(a, b),
    ),
  ]);
  const openedOn = new Map(opened.map((o) => [o.id, o.opened_on]));
  const accounts = loaded.assetRows
    .filter((a) => a.type === 'bank_account' && a.currency === 'INR' && a.status === 'active')
    .map((a) => ({
      id: a.id,
      owner: loaded.ownerName.get(a.owner_id) ?? 'One of you',
      bank: (a.institution_id && loaded.institutionName?.get(a.institution_id)) || 'the bank',
      last4: a.identifier_last4 ?? null,
      kind: a.account_kind ?? null,
      openedOn: openedOn.get(a.id) ?? null,
    }));
  // the lines of an account whose statements give no balance at all, oldest first
  const unbalanced = new Map<string, { date: string; amount: number }[]>();
  const withBalance = new Set(
    stored.lines.filter((l) => l.balance !== null).map((l) => l.asset_id),
  );
  for (const l of [...stored.lines].sort((x, y) => x.txn_on.localeCompare(y.txn_on)))
    if (!withBalance.has(l.asset_id))
      unbalanced.set(l.asset_id, [
        ...(unbalanced.get(l.asset_id) ?? []),
        { date: l.txn_on, amount: Number(l.amount) },
      ]);
  return neededFromYou({
    accounts,
    statements: stored.statements.map((s) => ({
      assetId: s.asset_id,
      from: s.from_on,
      to: s.to_on,
      opening: s.opening === null ? null : Number(s.opening),
      closing: s.closing === null ? null : Number(s.closing),
    })),
    unbalanced,
    recorded: recorded.map((r) => ({
      assetId: r.asset_id,
      date: r.as_of,
      amount: Number(r.amount),
    })),
    unplaced: remits
      .filter((r) => !PROVEN.has(r.to_basis ?? ''))
      .map((r) => ({
        date: r.received_on,
        amount: Number(r.amount_inr),
        candidates: r.candidate_asset_ids ?? [],
      })),
    // the lines still to answer, sorted by the same rules as Explain movements when the caller has not counted them
    toAnswer:
      pre?.toAnswer ??
      classifyLines(
        stmtLinesOf(stored.lines, loaded),
        classifyContext(loaded, config, stored.remittances),
      ).filter((c) => c.cls === 'ask_in' || c.cls === 'ask_out').length,
    ownershipFrom: config.capital.ownershipFrom,
  });
}

/**
 * Keeps the tasks "needed from you" in step with what is needed: a new need becomes an open task, an open one gets its words
 * refreshed, and one no longer needed is marked done. A task you closed or dropped yourself is never opened again.
 */
export async function syncNeededTasks(
  db: SupabaseClient,
  householdId: string,
  needs: Need[],
): Promise<{ added: number; closed: number; open: number }> {
  const { data, error } = await db
    .from('tasks')
    .select('id, title, status, source_key')
    .eq('household_id', householdId)
    .like('source_key', `${PREFIX}%`);
  if (error) throw new Error(`tasks: ${error.message}`);
  const have = new Map(
    ((data ?? []) as { id: string; title: string; status: string; source_key: string }[]).map(
      (t) => [t.source_key, t],
    ),
  );
  const want = new Map(needs.map((n) => [`${PREFIX}${n.key}`, n]));
  const add = [...want]
    .filter(([k]) => !have.has(k))
    .map(([k, n]) => ({
      household_id: householdId,
      asset_id: n.assetId,
      title: n.title,
      source_key: k,
    }));
  if (add.length) {
    const r = await db.from('tasks').insert(add);
    if (r.error) throw new Error(`tasks: ${r.error.message}`);
  }
  let closed = 0;
  for (const [k, t] of have) {
    if (t.status !== 'open') continue;
    const n = want.get(k);
    const change = n
      ? n.title !== t.title
        ? { title: n.title }
        : null
      : { status: 'done', done_at: new Date().toISOString() };
    if (!change) continue;
    const r = await db.from('tasks').update(change).eq('id', t.id).eq('household_id', householdId);
    if (r.error) throw new Error(`tasks: ${r.error.message}`);
    if (!n) closed++;
  }
  return { added: add.length, closed, open: want.size };
}
