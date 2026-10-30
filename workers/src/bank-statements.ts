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
  conflictingBalances,
  saveBankStatement,
  stmtLinesOf,
} from '@fwos/data';
import { bankOnFile, fromAccountOpening, readBankStatement } from '@fwos/ingest';
import { classifyLines } from '@fwos/core';
import { connectDb, householdId, must, need } from './shared';

interface Input {
  account: {
    bank: string;
    person: string;
    last4: string;
    /** the files have no balances but cover the account from the day it was opened: the balances are summed from nothing */
    fromOpening?: boolean;
    /**
     * with fromOpening: save the lines only, and keep the balances on record. For a download the recorded balances show to miss a
     * line (a steady gap from one month on), so the summed balances are wrong by that line from then on.
     */
    linesOnly?: boolean;
  };
  /** a text file (CSV, XML, a web page) as text, any other as base64 */
  files: { name: string; data?: string; text?: string }[];
}

async function main() {
  const raw = JSON.parse(gunzipSync(Buffer.from(need('STMT_B64'), 'base64')).toString('utf8')) as
    Input | { accounts: Input[] };
  // one account, or several in one run (the movements are rebuilt once, after all of them)
  const inputs = 'accounts' in raw ? raw.accounts : [raw];
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
  const ownerRows = must(owners, 'owners');
  const instRows = must(insts, 'institutions') as { id: string; name: string }[];
  const assetRows = must(assets, 'assets') as Record<string, unknown>[];
  // every account is found before anything is written
  const resolved = inputs.map((input) => {
    const owner = ownerRows.find(
      (o) => String(o.display_name).toLowerCase() === input.account.person.toLowerCase(),
    )?.id;
    const bank = bankOnFile(
      input.account.bank,
      instRows.map((i) => i.name),
    );
    const inst = instRows.find((i) => i.name === bank);
    const cands = assetRows.filter(
      (a) => a.owner_id === owner && a.institution_id === inst?.id && a.currency === 'INR',
    );
    const byDigits = cands.filter((a) => a.identifier_last4 === input.account.last4);
    // when the digits given are on no account there, an account with no digits on record can still be it, if it is the only one
    const blank = cands.filter((a) => !a.identifier_last4);
    const one = (list: Record<string, unknown>[]) => {
      const nre = list.filter((a) => a.account_kind === 'NRE');
      return list.length === 1 ? list[0] : nre.length === 1 ? nre[0] : undefined;
    };
    const acct = input.account.last4
      ? byDigits.length === 1
        ? byDigits[0]
        : byDigits.length === 0
          ? one(blank)
          : undefined
      : one(cands);
    if (!acct)
      throw new Error(
        `The account at ${bank ?? input.account.bank} (${input.account.person.slice(0, 2)}., …${input.account.last4}) was not found (${cands.length} at that bank: ${cands.map((c) => `…${String(c.identifier_last4 ?? '?')} ${String(c.account_kind ?? '')}`).join(', ')}).`,
      );
    return {
      input,
      bank,
      assetId: acct.id as string,
      fillLast4: !acct.identifier_last4 && input.account.last4 ? input.account.last4 : null,
    };
  });
  for (const r of resolved) {
    await importOne(db, hh, write, r.input, r.bank, r.assetId);
    // the account's last four digits, from the statement, when none were on record
    if (write && r.fillLast4) {
      const { error } = await db
        .from('assets')
        .update({ identifier_last4: r.fillLast4 })
        .eq('id', r.assetId)
        .eq('household_id', hh);
      if (error) throw new Error(`last four digits: ${error.message}`);
    }
  }
  if (!write) {
    console.log('Plan only: nothing was written. Run again with mode "apply" to write it.');
    return;
  }
  await afterImport(
    db,
    hh,
    resolved.map((r) => ({
      assetId: r.assetId,
      label: `${r.bank} (${r.input.account.person.slice(0, 2)}., …${r.input.account.last4})`,
    })),
  );
}

async function importOne(
  db: ReturnType<typeof connectDb>,
  hh: string,
  write: boolean,
  input: Input,
  bank: string | null,
  assetId: string,
) {
  console.log(
    `Account: ${bank} (${input.account.person.slice(0, 2)}., …${input.account.last4}), ${input.files.length} files, mode ${write ? 'apply' : 'plan'}`,
  );
  let lines = 0;
  for (const f of [...input.files].sort((a, b) => a.name.localeCompare(b.name))) {
    const bytes =
      f.text !== undefined ? Buffer.from(f.text, 'utf8') : Buffer.from(f.data ?? '', 'base64');
    const read = await readBankStatement(new Uint8Array(bytes));
    const opened = input.account.fromOpening ? fromAccountOpening(read) : null;
    const s = opened && !input.account.linesOnly ? opened : read;
    const tag = `${s.from} to ${s.to}`;
    if (s.last4 && s.last4 !== input.account.last4) {
      console.log(`- ${tag}: the statement is for another account (ending ${s.last4}); skipped`);
      continue;
    }
    lines += s.lines.length;
    if (!write) {
      const wrong = await conflictingBalances(db, assetId, s);
      if (opened && s === opened && wrong.length)
        // the gap (recorded less summed) at each recorded balance, in thousands, with where the recorded figure came from (diary or
        // workbook, a bank e-mail, a statement, typed by hand): a step shows where a line is missing
        console.log(
          `  gap by date (thousands): ${[...wrong]
            .sort((a, b) => a.as_of.localeCompare(b.as_of))
            .map(
              (w) =>
                `${w.as_of.slice(0, 7)} ${Math.round((Number(w.amount) - w.proved!) / 1000)} (${w.source})`,
            )
            .join(', ')}`,
        );
      if (opened && s === opened && wrong.length) {
        // how far apart, and whether the recorded figure is the statement's on a nearby day (a reading taken on another date)
        const near = (o: { as_of: string; amount: number }) =>
          s.lines.some(
            (l) =>
              Math.abs(Date.parse(l.date) - Date.parse(o.as_of)) <= 20 * 86400000 &&
              Math.abs((l.balance ?? 0) - Number(o.amount)) <= 1,
          );
        const gaps = wrong.map((w) => Math.abs(Number(w.amount) - w.proved!)).sort((a, b) => a - b);
        const pct = wrong.map(
          (w) => Math.abs(Number(w.amount) - w.proved!) / Math.max(w.proved!, 1),
        );
        console.log(
          `  differences: median ${Math.round(gaps[Math.floor(gaps.length / 2)]!)}, largest ${Math.round(gaps[gaps.length - 1]!)}; within 1% ${pct.filter((x) => x <= 0.01).length}, within 10% ${pct.filter((x) => x <= 0.1).length}; recorded figure is the balance on a day within 20 days ${wrong.filter(near).length}; recorded higher ${wrong.filter((w) => Number(w.amount) > w.proved!).length}; years ${[...new Set(wrong.map((w) => w.as_of.slice(0, 4)))].join(' ')}`,
        );
      }
      console.log(
        `- ${tag}: ${s.lines.length} lines, ${s.breaks} breaks${opened && s === opened ? `, balances summed from the opening (closing ${Math.round(s.closing ?? 0)}), ${wrong.length} recorded balances differ` : ''}${opened && s !== opened ? ', lines only: the recorded balances are kept' : ''}${s.warnings.length ? `; ${s.warnings.join(' ')}` : ''}`,
      );
      continue;
    }
    const saved = await saveBankStatement(db, hh, assetId, s, f.name.replace(/^[0-9a-f]{8}-/, ''));
    if (opened?.firstLineOn) {
      // the first line of a download from the opening is the opening deposit: the account was opened that day or just before
      const { error } = await db
        .from('assets')
        .update({
          opened_on: opened.firstLineOn,
          opened_after: null,
          opened_note: 'The first line of the full transaction download (the opening deposit)',
        })
        .eq('id', assetId)
        .eq('household_id', hh);
      if (error) throw new Error(`opening date: ${error.message}`);
    }
    console.log(
      `- ${tag}: ${s.lines.length} lines (${saved.lines} new), ${saved.balances} month-end balances${saved.opened ? `, opening day set to ${s.openedOn ?? s.from}` : ''}${s.breaks ? `, ${s.breaks} breaks` : ''}`,
    );
  }
  console.log(`Lines read: ${lines}`);
}

async function afterImport(
  db: ReturnType<typeof connectDb>,
  hh: string,
  done: { assetId: string; label: string }[],
) {
  const rb = await rebuildStatementMoves(db, hh);
  console.log(
    `Movements from statements: ${rb.added} added, ${rb.removed} replaced. Lines to answer: ${rb.toAnswer}`,
  );
  console.log(
    `Needed from you (Tasks): ${rb.needed.open} open, ${rb.needed.added} added, ${rb.needed.closed} closed`,
  );
  // what the account's lines are, by kind
  const loaded = await loadPortfolioData(db, { householdId: hh });
  const { config } = await loadSettings(db, hh);
  const stored = await loadStatements(db, hh);
  const all = classifyLines(
    stmtLinesOf(stored.lines, loaded),
    classifyContext(loaded, config, stored.remittances),
  );
  for (const { assetId, label } of done) {
    const mine = stmtLinesOf(
      stored.lines.filter((l) => l.asset_id === assetId),
      loaded,
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
    console.log(`  ${label}:`);
    for (const [k, g] of [...by].sort((a, b) => Math.abs(b[1].sum) - Math.abs(a[1].sum)))
      console.log(`    ${k}: ${g.n} lines, ₹${(g.sum / 100000).toFixed(2)} L`);
  }
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
