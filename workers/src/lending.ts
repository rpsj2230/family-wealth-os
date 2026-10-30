/* eslint-disable no-console */
/**
 * Money lent to people, from the bank statements (core statement-lending.ts), run by hand (Actions > Money lent from statements).
 * NAMES lists the people (as you write them; the bank's own spelling is found). For each, payments to them of at least the limit
 * are loans and what came back from them afterwards is them paying back. MODE=plan lists it; MODE=apply records a "Loan to …" for
 * each person not on file yet, with every repayment and what was still owed after each, so the statement lines are explained by
 * it (the rules link them by the name). REVIEW_ABOVE, when given, sets the limit for asking about a line no rule places (Settings).
 * The plan also lists the words that recur in the large payments still to answer, to find people not named yet.
 */
import { lendingFromLines, nameKey, personNamed } from '@fwos/core';
import { loadMoneyTrail, loadPortfolioData, loadSettings, rebuildStatementMoves } from '@fwos/data';
import { connectDb, householdId, must } from './shared';

const lakh = (n: number) => `₹${(n / 100_000).toFixed(2)} L`;

async function main() {
  const write = process.env.MODE === 'apply';
  const names = (process.env.NAMES ?? '')
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean);
  // accounts of yours held in someone else's name, "Name@Bank" ("Atul@IDFC")
  const held = (process.env.HELD ?? '')
    .split(',')
    .map((h) => h.trim().split('@'))
    .filter((h) => h.length === 2 && h[0]!.trim() && h[1]!.trim())
    .map(([who, bank]) => ({ who: who!.trim(), bank: bank!.trim() }));
  // the household says every loan named here was paid back in full, some of it outside these statements
  const allRepaid = process.env.ALL_REPAID === 'true';
  const db = connectDb();
  const hh = await householdId(db);
  const { config } = await loadSettings(db, hh);
  const reviewAbove =
    Number(process.env.REVIEW_ABOVE) > 0 ? Number(process.env.REVIEW_ABOVE) : null;
  const atLeast = reviewAbove ?? config.statements.reviewAbove;
  const loaded = await loadPortfolioData(db, { householdId: hh });
  const t = await loadMoneyTrail(db, hh, loaded);
  const asset = new Map(loaded.assetRows.map((a) => [a.id, a]));
  const label = (id: string) => {
    const a = asset.get(id);
    const bank = a?.institution_id ? loaded.institutionName?.get(a.institution_id) : null;
    return [
      bank,
      a?.account_kind,
      a?.identifier_last4 ? `…${a.identifier_last4}` : null,
      loaded.ownerName.get(a?.owner_id ?? ''),
    ]
      .filter(Boolean)
      .join(' ');
  };
  const lines = t.lines.map((l) => ({
    id: l.id,
    assetId: l.asset_id,
    date: l.txn_on,
    amount: l.amount,
    narration: l.narration,
  }));
  const onFile = loaded.assetRows.filter((a) => a.type === 'receivable');
  console.log(`Limit for a loan (and for asking): ₹${atLeast.toLocaleString('en-IN')}`);

  const pictures = lendingFromLines(lines, names, atLeast);
  const toAdd: typeof pictures = [];
  for (const p of pictures) {
    const existing = onFile.find(
      (a) => personNamed(a.nickname.replace(/^(loan|gift|money lent)\s+to\s+/i, ''), [p]) !== null,
    );
    const accounts = [...new Set([...p.lent, ...p.repaid].map((l) => label(l.assetId)))];
    const lent = -p.lent.reduce((s, l) => s + l.amount, 0);
    const back = p.repaid.reduce((s, l) => s + l.amount, 0);
    console.log(
      `\n${p.name}: lent ${p.lent.length} times, ${lakh(lent)}${p.lent.length ? ` (${p.lent[0]!.date} to ${p.lent[p.lent.length - 1]!.date})` : ''}; paid back ${p.repaid.length} times, ${lakh(back)}${p.repaid.length ? ` (to ${p.repaid[p.repaid.length - 1]!.date})` : ''}; still owed ${lakh(Math.max(0, p.owed))}${p.owed < -1 ? ` (${lakh(-p.owed)} more came back than was lent)` : ''}`,
    );
    if (accounts.length) console.log(`  accounts: ${accounts.join('; ')}`);
    // the other side's bank, by the IFSC codes and bank names the narrations print
    const codes = new Map<string, number>();
    for (const l of [...p.lent, ...p.repaid])
      for (const m of l.narration
        .toUpperCase()
        .matchAll(
          /\b([A-Z]{4})(?:0|…)|\b(IDFC|HDFC|ICICI|AXIS|KOTAK|SBI|YES|INDUSIND|EQUITAS|JANA|RBL|ESAF)\b/g,
        )) {
        const c = (m[1] ?? m[2])!;
        codes.set(c, (codes.get(c) ?? 0) + 1);
      }
    if (codes.size)
      console.log(
        `  banks named in these lines: ${[...codes]
          .sort((a, b) => b[1] - a[1])
          .map(([c, n]) => `${c} ×${n}`)
          .join(', ')}`,
      );
    if (existing)
      console.log(
        `  already on file as "${existing.nickname}" (${existing.status}): left as it is`,
      );
    else if (p.lent.length) toAdd.push(p);
  }

  // words that recur in the large payments still to answer: people not named yet
  const big = t.lines.filter(
    (l) => t.classified.get(l.id)?.cls === 'ask_out' && -l.amount >= atLeast,
  );
  const common = new Set(
    'imps neft rtgs transfer upi from with bank hdfc idfc yesb sbin icic punb barb utib kkbk netbanking mobile ltd limited payment singh pratap kumar jadon rupash ragini'
      .split(' ')
      .map(nameKey),
  );
  const count = new Map<string, { word: string; n: number }>();
  for (const l of big)
    for (const w of new Set(l.narration.split(/[^A-Za-z]+/).filter((x) => x.length >= 4))) {
      const k = nameKey(w);
      if (common.has(k) || names.some((n) => nameKey(n.split(/\s+/)[0]!) === k)) continue;
      const c = count.get(k) ?? { word: w.toLowerCase(), n: 0 };
      c.n++;
      count.set(k, c);
    }
  console.log(
    `\nLarge payments out still to answer: ${big.length}. Words in two or more of them (people not named yet?): ${
      [...count.values()]
        .filter((c) => c.n >= 2)
        .sort((a, b) => b.n - a.n)
        .slice(0, 30)
        .map((c) => `${c.word} ×${c.n}`)
        .join(', ') || 'none'
    }`,
  );
  if (reviewAbove !== null) {
    const below = t.lines.filter((l) => {
      const c = t.classified.get(l.id)?.cls;
      return (c === 'ask_out' || c === 'ask_in') && Math.abs(l.amount) < reviewAbove;
    });
    console.log(
      `Asking limit from ₹${config.statements.reviewAbove.toLocaleString('en-IN')} to ₹${reviewAbove.toLocaleString('en-IN')}: ${below.filter((l) => l.amount < 0).length} payments out become spending, ${below.filter((l) => l.amount > 0).length} payments in become small amounts in`,
    );
  }
  // the accounts held in someone else's name: which bank on file, whose money (the person most of the lines are with)
  const heldToAdd: { who: string; instId: string; bank: string; owner: string }[] = [];
  for (const h of held) {
    const inst = [...(loaded.institutionName ?? new Map<string, string>())].find(([, n]) =>
      n.toLowerCase().includes(h.bank.toLowerCase()),
    );
    const named = t.lines.filter((l) => personNamed(l.narration, [{ name: h.who }]));
    const byOwner = new Map<string, number>();
    for (const l of named) {
      const o = asset.get(l.asset_id)?.owner_id ?? '';
      byOwner.set(o, (byOwner.get(o) ?? 0) + 1);
    }
    const owner = [...byOwner].sort((a, b) => b[1] - a[1])[0]?.[0];
    const there = loaded.assetRows.find(
      (a) =>
        a.type === 'bank_account' &&
        a.institution_id === inst?.[0] &&
        personNamed(a.holder_name ?? '', [{ name: h.who }]) !== null,
    );
    console.log(
      `\nAccount in ${h.who}'s name at ${inst?.[1] ?? `${h.bank} (no such bank on file)`}: ${named.length} statement lines name ${h.who}; ${there ? `already on file ("${there.nickname}")` : owner ? `to be added as ${loaded.ownerName.get(owner)}'s` : 'nobody to own it'}`,
    );
    if (inst && owner && !there)
      heldToAdd.push({ who: h.who, instId: inst[0], bank: inst[1], owner });
  }
  if (allRepaid)
    console.log(
      'Every loan is recorded as paid back in full; what the statements do not show coming back was paid outside them.',
    );
  if (!write) {
    console.log(
      `\nPlan only: ${toAdd.length} loans and ${heldToAdd.length} accounts would be recorded. Run again with mode "apply".`,
    );
    return;
  }
  for (const h of heldToAdd)
    must(
      await db
        .from('assets')
        .insert({
          household_id: hh,
          type: 'bank_account',
          owner_id: h.owner,
          institution_id: h.instId,
          nickname: `${h.bank} account in ${h.who}'s name`,
          holder_name: h.who,
          status: 'active',
          currency: 'INR',
          notes: `Your account, held in ${h.who}'s name. Money to and from ${h.who} at ${h.bank} is money moved between your own accounts. Its statement would give its balance.`,
        })
        .select('id'),
      `account in ${h.who}'s name`,
    );

  if (reviewAbove !== null) {
    const row = must(
      await db.from('household_config').select('config').eq('household_id', hh).maybeSingle(),
      'settings',
    ) as { config: Record<string, unknown> } | null;
    const cfg = { ...(row?.config ?? {}) };
    cfg.statements = { ...((cfg.statements as Record<string, unknown>) ?? {}), reviewAbove };
    must(
      await db
        .from('household_config')
        .upsert({ household_id: hh, config: cfg }, { onConflict: 'household_id' })
        .select('household_id'),
      'settings',
    );
  }
  let added = 0;
  for (const p of toAdd) {
    const first = p.lent[0]!;
    const owner = asset.get(first.assetId)!.owner_id;
    const lent = Math.round(-p.lent.reduce((s, l) => s + l.amount, 0) * 100) / 100;
    const settled = allRepaid || p.owed <= Math.max(1, lent * 0.01);
    // paid back in full, the rest outside these statements: nothing owed after the last line with them
    const last = [...p.lent, ...p.repaid]
      .map((l) => l.date)
      .sort()
      .pop()!;
    const steps =
      allRepaid && p.owed > 1
        ? [...p.steps.filter((x) => x.date !== last), { date: last, owed: 0 }]
        : p.steps;
    const a = must(
      await db
        .from('assets')
        .insert({
          household_id: hh,
          type: 'receivable',
          owner_id: owner,
          nickname: `Loan to ${p.name}`,
          status: settled ? 'closed' : 'active',
          currency: 'INR',
          notes: `From the bank statements: lent ${p.lent.length} times from ${first.date}, paid back ${p.repaid.length} times${allRepaid && p.owed > 1 ? '; the rest was paid back outside these statements' : ''}.`,
        })
        .select('id')
        .single(),
      `loan to ${p.name}`,
    ) as { id: string };
    must(
      await db
        .from('receivables')
        .insert({
          asset_id: a.id,
          household_id: hh,
          counterparty: p.name,
          lent,
          lent_on: first.date,
        })
        .select('asset_id'),
      'loan',
    );
    if (p.repaid.length)
      must(
        await db
          .from('receivable_payments')
          .insert(
            p.repaid.map((l) => ({
              household_id: hh,
              asset_id: a.id,
              amount: l.amount,
              paid_on: l.date,
              note: 'From the bank statement',
            })),
          )
          .select('id'),
        'repayments',
      );
    // what was owed after each loan and repayment, so every day's figures count it
    must(
      await db
        .from('observations')
        .insert(
          steps.map((s) => ({
            household_id: hh,
            asset_id: a.id,
            kind: 'valuation',
            amount: Math.max(0, s.owed),
            currency: 'INR',
            as_of: s.date,
            source: 'statement',
            source_ref: `loan:${a.id}:${s.date}`,
            confidence: 'verified',
            note: 'Still owed, from the bank statements',
          })),
        )
        .select('id'),
      'amounts owed',
    );
    added++;
  }
  console.log(
    `\nRecorded ${added} loans and ${heldToAdd.length} accounts in another's name${reviewAbove !== null ? `; asking limit set to ₹${reviewAbove.toLocaleString('en-IN')}` : ''}.`,
  );
  const rb = await rebuildStatementMoves(db, hh);
  console.log(
    `Movements from statements: ${rb.added} added, ${rb.removed} replaced. Lines to answer: ${rb.toAnswer}`,
  );
}

main().catch((e: unknown) => {
  console.error((e as Error).message);
  process.exit(1);
});
