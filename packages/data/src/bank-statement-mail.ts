/**
 * Bank statements the banks e-mail, imported by the Gmail scan (workers/src/statements.ts) with no one at the keyboard: each PDF is
 * opened with the saved statement passwords, placed on the one account it belongs to (ingest bank-statement-mail.ts) and saved
 * exactly as an upload is (saveBankStatement: new lines only, balances, the alert lines of those days replaced). The caller sorts
 * the lines again once the scan is done. The reason is one line, with no password, PAN or amount in it.
 */
import { openBankStatement, pickStatementAccount, type StatementAccount } from '@fwos/ingest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadStatementCandidates } from './cas';
import { saveBankStatement } from './statement-save';

export interface BankMailResult {
  outcome: 'imported' | 'partial' | 'failed';
  reason: string;
  ownerIds: string[];
  /** accounts a statement was saved to */
  accounts: number;
  /** lines that were not on file before */
  lines: number;
}

/** The household's rupee bank accounts, with the bank's name, for placing a statement. */
async function statementAccounts(db: SupabaseClient, hh: string): Promise<StatementAccount[]> {
  const [{ data: assets, error: e1 }, { data: insts, error: e2 }] = await Promise.all([
    db
      .from('assets')
      .select('id, owner_id, institution_id, identifier_last4, currency, status')
      .eq('household_id', hh)
      .eq('type', 'bank_account'),
    db.from('institutions').select('id, name').eq('household_id', hh),
  ]);
  if (e1 || e2) throw new Error(`accounts: ${(e1 ?? e2)!.message}`);
  const bank = new Map((insts ?? []).map((i) => [i.id as string, String(i.name)]));
  return (assets ?? [])
    .filter((a) => a.status !== 'merged')
    .map((a) => ({
      id: a.id as string,
      ownerId: a.owner_id as string,
      last4: (a.identifier_last4 as string | null) ?? null,
      bank: bank.get(a.institution_id as string) ?? '',
      currency: String(a.currency ?? 'INR'),
    }));
}

export async function importBankStatementMail(
  db: SupabaseClient,
  hh: string,
  m: {
    messageId: string;
    receivedOn: string;
    from?: string;
    attachments: { filename: string; content: Uint8Array }[];
  },
): Promise<BankMailResult> {
  const [candidates, accounts] = await Promise.all([
    loadStatementCandidates(db, hh),
    statementAccounts(db, hh),
  ]);
  const problems: string[] = [];
  const owners = new Set<string>();
  const saved = new Set<string>();
  let lines = 0;
  for (const a of m.attachments) {
    const opened = await openBankStatement(a.content, candidates);
    if (!opened.ok) {
      problems.push(`${a.filename}: ${opened.reason}`);
      continue;
    }
    if (opened.stmt.lines.length === 0) {
      problems.push(`${a.filename}: no transaction lines were found in it.`);
      continue;
    }
    const pick = pickStatementAccount(opened.stmt, opened.ownerId, m.from ?? '', accounts);
    if (!pick.ok) {
      problems.push(`${a.filename}: ${pick.reason}`);
      continue;
    }
    const r = await saveBankStatement(
      db,
      hh,
      pick.account.id,
      opened.stmt,
      `E-mailed ${m.receivedOn} ${a.filename}`.slice(0, 200),
    );
    lines += r.lines;
    saved.add(pick.account.id);
    owners.add(pick.account.ownerId);
  }
  const reason = problems.join(' ').slice(0, 300);
  return {
    outcome: saved.size === 0 ? 'failed' : problems.length ? 'partial' : 'imported',
    reason,
    ownerIds: [...owners],
    accounts: saved.size,
    lines,
  };
}
