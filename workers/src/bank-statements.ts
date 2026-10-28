/* eslint-disable no-console */
/**
 * Bank statements sent by the household, imported by hand (Actions > Bank statements). The files arrive as the run's input
 * (STMT_B64: base64 of gzipped JSON { account: { bank, person, last4 }, files: [{ name, text | data (base64) }] }), never from the
 * repository.
 * Each file is read with the same reader as Import (bank-statement.ts), checked against the account's last four digits, and saved
 * with the same code (statement-save.ts): new lines only, month-end balances, the opening date it prints. Then every line is sorted
 * again, the transfers from Singapore it shows are placed, and the ledger's movements follow. MODE=plan reads and checks only.
 * Prints counts, dates and bank names only.
 */
import { gunzipSync } from 'node:zlib';
import { LINE_CLASS_LABEL } from '@fwos/core';
import {
  classifyContext,
  loadPortfolioData,
  loadSettings,
  loadStatements,
  rebuildStatementMoves,
  saveBankStatement,
  stmtLinesOf,
} from '@fwos/data';
import { bankOnFile, readBankStatement } from '@fwos/ingest';
import { classifyLines } from '@fwos/core';
import { connectDb, householdId, must, need } from './shared';

interface Input {
  account: { bank: string; person: string; last4: string };
  /** a text file (CSV, XML, a web page) as text, any other as base64 */
  files: { name: string; data?: string; text?: string }[];
}

async function main() {
  const input = JSON.parse(
    gunzipSync(Buffer.from(need('STMT_B64'), 'base64')).toString('utf8'),
  ) as Input;
  const write = process.env.MODE === 'apply';
  const db = connectDb();
  const hh = await householdId(db);
  const [owners, insts, assets] = await Promise.all([
    db.from('owners').select('id, display_name').eq('household_id', hh),
    db.from('institutions').select('id, name').eq('household_id', hh),
    db
      .from('assets')
      .select('id, owner_id, institution_id, account_kind, identifier_last4, currency')
      .eq('household_id', hh)
      .eq('type', 'bank_account'),
  ]);
  const owner = must(owners, 'owners').find(
    (o) => String(o.display_name).toLowerCase() === input.account.person.toLowerCase(),
  )?.id;
  const instRows = must(insts, 'institutions') as { id: string; name: string }[];
  const bank = bankOnFile(
    input.account.bank,
    instRows.map((i) => i.name),
  );
  const inst = instRows.find((i) => i.name === bank);
  const cands = (must(assets, 'assets') as Record<string, unknown>[]).filter(
    (a) => a.owner_id === owner && a.institution_id === inst?.id && a.currency === 'INR',
  );
  const byDigits = cands.filter((a) => a.identifier_last4 === input.account.last4);
  const nre = cands.filter((a) => a.account_kind === 'NRE');
  const acct =
    byDigits.length === 1
      ? byDigits[0]
      : nre.length === 1
        ? nre[0]
        : cands.length === 1
          ? cands[0]
          : undefined;
  if (!acct)
    throw new Error(
      `The account at ${bank ?? input.account.bank} was not found (${cands.length} candidates).`,
    );
  const assetId = acct.id as string;
  console.log(
    `Account: ${bank} (${input.account.person.slice(0, 2)}.), ${input.files.length} files, mode ${write ? 'apply' : 'plan'}`,
  );

  let lines = 0;
  for (const f of [...input.files].sort((a, b) => a.name.localeCompare(b.name))) {
    const bytes =
      f.text !== undefined ? Buffer.from(f.text, 'utf8') : Buffer.from(f.data ?? '', 'base64');
    const s = await readBankStatement(new Uint8Array(bytes));
    const tag = `${s.from} to ${s.to}`;
    if (s.last4 && s.last4 !== input.account.last4) {
      console.log(`- ${tag}: the statement is for another account (ending ${s.last4}); skipped`);
      continue;
    }
    lines += s.lines.length;
    if (!write) {
      console.log(
        `- ${tag}: ${s.lines.length} lines, ${s.breaks} breaks${s.warnings.length ? `; ${s.warnings.join(' ')}` : ''}`,
      );
      continue;
    }
    const saved = await saveBankStatement(db, hh, assetId, s, f.name.replace(/^[0-9a-f]{8}-/, ''));
    console.log(
      `- ${tag}: ${s.lines.length} lines (${saved.lines} new), ${saved.balances} month-end balances${saved.opened ? `, opened ${s.openedOn}` : ''}${s.breaks ? `, ${s.breaks} breaks` : ''}`,
    );
  }
  console.log(`Lines read: ${lines}`);
  if (!write) {
    console.log('Plan only: nothing was written. Run again with mode "apply" to write it.');
    return;
  }

  const rb = await rebuildStatementMoves(db, hh);
  console.log(
    `Movements from statements: ${rb.added} added, ${rb.removed} replaced. Lines to answer: ${rb.toAnswer}`,
  );
  // what the account's lines are, by kind
  const loaded = await loadPortfolioData(db, { householdId: hh });
  const { config } = await loadSettings(db, hh);
  const stored = await loadStatements(db, hh);
  const mine = stmtLinesOf(
    stored.lines.filter((l) => l.asset_id === assetId),
    loaded,
  );
  const all = classifyLines(
    stmtLinesOf(stored.lines, loaded),
    classifyContext(loaded, config, stored.remittances),
  );
  const by = new Map<string, { n: number; sum: number }>();
  const ids = new Set(mine.map((l) => l.id));
  const amount = new Map(mine.map((l) => [l.id, l.amount]));
  for (const c of all) {
    if (!ids.has(c.id)) continue;
    const k = LINE_CLASS_LABEL[c.cls];
    const g = by.get(k) ?? { n: 0, sum: 0 };
    g.n++;
    g.sum += amount.get(c.id) ?? 0;
    by.set(k, g);
  }
  for (const [k, g] of [...by].sort((a, b) => Math.abs(b[1].sum) - Math.abs(a[1].sum)))
    console.log(`    ${k}: ${g.n} lines, ₹${(g.sum / 100000).toFixed(2)} L`);
  const placed = must(
    await db.from('remittances').select('to_basis').eq('household_id', hh),
    'transfers',
  ) as { to_basis: string | null }[];
  const count = (b: string | null) => placed.filter((p) => p.to_basis === b).length;
  console.log(
    `Transfers from Singapore: ${placed.length}; proven by a statement ${count('statement')}, from balances ${count('balances')}, only one possible ${count('only_open')}, not yet known ${count(null)}`,
  );
}

main().catch((e: unknown) => {
  console.error((e as Error).message);
  process.exit(1);
});
