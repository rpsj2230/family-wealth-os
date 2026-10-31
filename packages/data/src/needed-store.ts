import {
  classifyLines,
  feedNeeds,
  feedStatus,
  neededFromYou,
  type FeedStatusRow,
  type AppConfig,
  type FeedPoint,
  type Need,
} from '@fwos/core';
import { bankForDomain } from '@fwos/ingest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadPortfolioData, type LoadedPortfolio } from './index';
import { pageAll } from './paging';
import { loadSettings } from './settings';
import { ALERTS_FILE } from './statement-save';
import { classifyContext, loadStatements, stmtLinesOf } from './statement-store';

const PREFIX = 'needed:';
const PROVEN = new Set(['statement', 'person']);

/**
 * Transactions > Bank feed: each account's last alert, e-mailed statement and e-mailed balance, the day its lines are proven
 * complete through, and the money that moved with no alert; with what became of the banks' e-mails of the last Settings days.
 */
export async function loadFeedStatus(
  db: SupabaseClient,
  householdId: string,
): Promise<{
  rows: (FeedStatusRow & { label: string })[];
  mail: { since: string; applied: number; waiting: number; passed: number; errors: number };
}> {
  let rows: (FeedStatusRow & { label: string })[] = [];
  await loadNeeds(db, householdId, {
    // the lines to answer are not needed here, so they are not counted
    toAnswer: 0,
    onFeed: (input) => {
      const name = new Map(
        input.accounts.map((a) => [
          a.id,
          `${a.owner} · ${a.bank}${a.kind ? ` ${a.kind}` : ''}${a.last4 ? ` …${a.last4}` : ''}`,
        ]),
      );
      rows = feedStatus(input).map((r) => ({ ...r, label: name.get(r.accountId) ?? '' }));
    },
  });
  const days = (await loadSettings(db, householdId)).config.statementMail.regularDays;
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const { data } = await db
    .from('inbox_messages')
    .select('outcome, from_domain, message_id')
    .eq('household_id', householdId)
    .gte('received_on', since);
  const bank = (
    (data ?? []) as { outcome: string; from_domain: string; message_id: string }[]
  ).filter(
    (m) => m.message_id.startsWith('bank-statement:') || bankForDomain(m.from_domain) !== null,
  );
  const n = (o: string) => bank.filter((m) => m.outcome === o).length;
  return {
    rows: rows.sort((a, b) => a.label.localeCompare(b.label)),
    mail: {
      since,
      applied: n('applied'),
      waiting: n('needs_review'),
      passed: n('ignored'),
      errors: n('error'),
    },
  };
}

/** What is still needed from the household, worked out from what is on file (core needed-from-you.ts). */
export async function loadNeeds(
  db: SupabaseClient,
  householdId: string,
  pre?: {
    loaded?: LoadedPortfolio;
    config?: AppConfig;
    stored?: Awaited<ReturnType<typeof loadStatements>>;
    toAnswer?: number;
    /** handed the feed's figures as they are worked out (Transactions > Bank feed) */
    onFeed?: (input: Parameters<typeof feedStatus>[0]) => void;
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
  const fi = await feedInputs(db, householdId, accounts, stored, recorded, config);
  pre?.onFeed?.(fi);
  const feed = feedNeeds(fi);
  const needs = neededFromYou({
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
        classifyContext(loaded, config, stored.remittances, stored.rules),
      ).filter((c) => c.cls === 'ask_in' || c.cls === 'ask_out').length,
    ownershipFrom: config.capital.ownershipFrom,
  });
  return [...needs, ...feed].sort((x, y) => x.rank - y.rank || x.title.localeCompare(y.title));
}

/** The gaps in what the banks tell us by e-mail, now that statements are not uploaded (core feed-health.ts). */
async function feedInputs(
  db: SupabaseClient,
  householdId: string,
  accounts: Parameters<typeof feedNeeds>[0]['accounts'],
  stored: Awaited<ReturnType<typeof loadStatements>>,
  recorded: { asset_id: string; as_of: string; amount: number; source: string }[],
  config: AppConfig,
): Promise<Parameters<typeof feedStatus>[0]> {
  const today = new Date().toISOString().slice(0, 10);
  const alertFiles = new Set(
    stored.statements.filter((s) => s.file_label === ALERTS_FILE).map((s) => s.id),
  );
  const lastHeard = new Map<string, string>();
  const heard = (id: string, d: string) => {
    if (d > (lastHeard.get(id) ?? '')) lastHeard.set(id, d);
  };
  const latest = (m: Map<string, string>, id: string, d: string) => {
    if (d > (m.get(id) ?? '')) m.set(id, d);
  };
  const lastAlert = new Map<string, string>();
  const lastEStatement = new Map<string, string>();
  const lastEmailBalance = new Map<string, string>();
  for (const s of stored.statements) {
    heard(s.asset_id, s.to_on);
    if (s.file_label === ALERTS_FILE) latest(lastAlert, s.asset_id, s.to_on);
    else if (/^E-mailed /.test(s.file_label ?? '')) latest(lastEStatement, s.asset_id, s.to_on);
  }
  for (const r of recorded)
    if (r.source === 'email') {
      heard(r.asset_id, r.as_of);
      latest(lastEmailBalance, r.asset_id, r.as_of);
    }
  const from = new Date(Date.now() - config.statementMail.gapDays * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const points = new Map<string, FeedPoint[]>();
  const add = (id: string, p: FeedPoint) => points.set(id, [...(points.get(id) ?? []), p]);
  // the bank's own order of lines (loadStatements keeps date, then id), and the balances alone from the bank's e-mails
  for (const l of stored.lines)
    if (l.txn_on >= from)
      add(l.asset_id, {
        date: l.txn_on,
        amount: Number(l.amount),
        balance: l.balance === null ? null : Number(l.balance),
        fromAlert: alertFiles.has(l.statement_id),
      });
  // a balance from the bank's e-mail, or one you typed (Monthly update): each is a checkpoint the lines must reach
  for (const r of recorded)
    if ((r.source === 'email' || r.source === 'manual') && r.as_of >= from)
      add(r.asset_id, {
        date: r.as_of,
        amount: 0,
        balance: Number(r.amount),
        fromAlert: true,
        balanceOnly: true,
      });
  for (const [id, ps] of points)
    points.set(
      id,
      ps.sort((a, b) => a.date.localeCompare(b.date)),
    );
  // statements the banks e-mailed that could not be saved, for a reason you can fix
  const { data: failed } = await db
    .from('inbox_messages')
    .select('received_on, from_domain, reason')
    .eq('household_id', householdId)
    .eq('outcome', 'needs_review')
    .or('reason.ilike.%saved passwords%,reason.ilike.%No account ending%');
  const locked = (
    (failed ?? []) as { received_on: string; from_domain: string; reason: string | null }[]
  )
    .map((m) => {
      const r = m.reason ?? '';
      if (/saved passwords/i.test(r))
        return { sender: m.from_domain, date: m.received_on, why: 'password' as const };
      const acct = /No account ending (\d{4})/i.exec(r);
      return acct
        ? { sender: m.from_domain, date: m.received_on, why: 'account' as const, last4: acct[1]! }
        : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  return {
    today,
    silentDays: config.statementMail.silentDays,
    gapDays: config.statementMail.gapDays,
    accounts,
    lastHeard,
    points,
    locked,
    lastAlert,
    lastEStatement,
    lastEmailBalance,
  };
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
