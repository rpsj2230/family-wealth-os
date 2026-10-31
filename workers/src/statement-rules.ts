/* eslint-disable no-console */
/**
 * Rules for bank statement lines, from what the household said (Actions > Statement rules). RULES is a JSON list:
 *   { "name": "Arjun", "action": "own", "target": "property:bellaire", "direction": "out" }
 *   { "name": "Krunal Dhansukhlal / Swati Krunalkumar", "action": "loan", "target": "new", "interest": true }
 *   { "name": "Shivani Kumari", "action": "loan", "target": "new", "waive": true }
 *   { "name": "autopay", "match": "words", "action": "out", "direction": "out" }
 * A target names the holding: "property:<words>", "account:<bank or words>", "loan:<person>" (a "Loan to …" on file), or "new" (a
 * new "Loan to <name>" record). MODE=plan lists what each rule finds; MODE=apply saves the rules, then brings every loan the
 * statements built up to date with the lines now linked to it (what was lent, each repayment, what was owed after each; interest
 * paid on a loan is earnings, not repayment), and rebuilds the movements. "waive": what is still owed after the last repayment was
 * forgiven (a gift). Prints names, counts and dates; amounts only as each loan's totals.
 */
import { personNamed, ruleMatches, type StatementRule } from '@fwos/core';
import {
  LOAN_FORGIVEN,
  LOAN_REPAID_OUTSIDE,
  loadMoneyTrail,
  loadPortfolioData,
  rebuildStatementMoves,
  syncStatementLoans,
} from '@fwos/data';
import { connectDb, householdId, must, need } from './shared';

interface RuleInput {
  /** paid back in full (some of it outside the statements): nothing is owed after the last line */
  repaidInFull?: boolean;
  /** only update the loan named by the target; save no rule */
  noRule?: boolean;
  name: string;
  match?: 'name' | 'words';
  action: StatementRule['action'];
  target?: string;
  direction?: StatementRule['direction'];
  interest?: boolean;
  waive?: boolean;
  note?: string;
}

const lakh = (n: number) => `₹${(n / 100_000).toFixed(2)} L`;

async function main() {
  const write = process.env.MODE === 'apply';
  const inputs = JSON.parse(need('RULES')) as RuleInput[];
  const db = connectDb();
  const hh = await householdId(db);
  let loaded = await loadPortfolioData(db, { householdId: hh });
  const bankOf = (id: string) => {
    const a = loaded.assetRows.find((x) => x.id === id);
    return a?.institution_id ? (loaded.institutionName?.get(a.institution_id) ?? '') : '';
  };
  const label = (id: string) => {
    const a = loaded.assetRows.find((x) => x.id === id);
    return a
      ? `${bankOf(id)} ${a.nickname} (${loaded.ownerName.get(a.owner_id) ?? ''}, ${a.status})`.trim()
      : '?';
  };

  // the holding each rule points at
  const resolve = (r: RuleInput): { assetId: string | null; why: string } => {
    if (r.action !== 'own' && r.action !== 'loan') return { assetId: null, why: '' };
    const [kind, ...rest] = (r.target ?? '').split(':');
    const words = rest.join(':').trim().toLowerCase();
    const has = (a: (typeof loaded.assetRows)[number]) =>
      `${a.nickname} ${a.label ?? ''} ${a.notes ?? ''} ${bankOf(a.id)}`
        .toLowerCase()
        .includes(words);
    const live = loaded.assetRows.filter((a) => a.status !== 'merged');
    const pick =
      kind === 'property'
        ? live.filter((a) => a.type === 'property' && has(a))
        : kind === 'account'
          ? live.filter((a) => a.type === 'bank_account' && has(a))
          : kind === 'loan'
            ? live.filter(
                (a) =>
                  a.type === 'receivable' &&
                  personNamed(a.nickname.replace(/^(loan|gift|money lent)\s+to\s+/i, ''), [
                    { name: words },
                  ]) !== null,
              )
            : [];
    if (kind === 'new') return { assetId: null, why: 'a new "Loan to …" record' };
    // several of one person's loans: the one whose name holds the words as written ("somesh pratap (2025-06-20)")
    const exact =
      pick.length > 1 ? pick.filter((a) => a.nickname.toLowerCase().includes(words)) : pick;
    if (exact.length === 1) return { assetId: exact[0]!.id, why: label(exact[0]!.id) };
    return {
      assetId: null,
      why: `${pick.length} holdings match "${r.target}": ${pick.map((a) => label(a.id)).join('; ') || 'none'}`,
    };
  };

  const t = await loadMoneyTrail(db, hh, loaded);
  const existing = must(
    await db.from('statement_rules').select('name, action').eq('household_id', hh),
    'rules',
  ) as { name: string; action: string }[];
  const toSave: (RuleInput & { assetId: string | null })[] = [];
  const repaidTargets = new Set<string>();
  for (const r of inputs) {
    const target = resolve(r);
    const probe: StatementRule = {
      id: 'probe',
      name: r.name,
      match: r.match ?? 'name',
      action: r.action,
      assetId: target.assetId,
      direction: r.direction ?? 'any',
      interest: !!r.interest,
    };
    const hits = t.lines.filter((l) =>
      ruleMatches(probe, { amount: l.amount, narration: l.narration }),
    );
    const out = hits.filter((l) => l.amount < 0);
    const into = hits.filter((l) => l.amount > 0);
    const dup = existing.some(
      (e) => e.name.toLowerCase() === r.name.toLowerCase() && e.action === r.action,
    );
    console.log(
      `- "${r.name}" (${r.match ?? 'name'}, ${r.direction ?? 'any'}) → ${r.action}${target.why ? ` ${target.why}` : ''}: ${hits.length} lines (${out.length} out ${lakh(-out.reduce((s, l) => s + l.amount, 0))}, ${into.length} in ${lakh(into.reduce((s, l) => s + l.amount, 0))})${hits.length ? `, ${hits[0]!.txn_on} to ${hits[hits.length - 1]!.txn_on}` : ''}${dup ? ' — already a rule; left as it is' : ''}`,
    );
    const needsTarget = (r.action === 'own' || r.action === 'loan') && r.target !== 'new';
    if (r.repaidInFull && target.assetId) repaidTargets.add(target.assetId);
    if (r.noRule || dup || (needsTarget && !target.assetId)) continue;
    toSave.push({ ...r, assetId: target.assetId });
  }
  // lines of one amount after a day (FIND "200000@2023-11-01"): to find a repayment that does not name the person; or lines
  // whose words hold all of these (FIND "words:cold store@2025-01-01"), money in only
  const findText = process.env.FIND ?? '';
  if (findText.startsWith('words:')) {
    const [w, after] = findText.slice(6).split('@');
    const want = (w ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    for (const l of t.lines.filter(
      (x) =>
        x.amount > 0 &&
        x.txn_on >= (after ?? '') &&
        want.every((k) => x.narration.toLowerCase().includes(k)),
    ))
      console.log(
        `  found ${l.txn_on} in ${lakh(l.amount)} ${label(l.asset_id)} [${t.classified.get(l.id)?.cls}] "${l.narration.toLowerCase().replace(/\d/g, '#').slice(0, 60)}"`,
      );
  }
  const [findAmount, findAfter] = (findText.startsWith('words:') ? '' : findText).split('@');
  if (Number(findAmount) > 0)
    for (const l of t.lines.filter(
      (x) => Math.abs(Math.abs(x.amount) - Number(findAmount)) < 1 && x.txn_on >= (findAfter ?? ''),
    ))
      console.log(
        `  found ${l.txn_on} ${l.amount > 0 ? 'in ' : 'out'} ${label(l.asset_id)} [${t.classified.get(l.id)?.cls}] "${l.narration.toLowerCase().replace(/\d/g, '#').slice(0, 60)}"`,
      );
  if (!write) {
    console.log(`\nPlan only: ${toSave.length} rules would be saved. Run again with mode "apply".`);
    return;
  }
  for (const id of repaidTargets) {
    const a = loaded.assetRows.find((x) => x.id === id);
    if (a && !(a.notes ?? '').includes(LOAN_REPAID_OUTSIDE))
      must(
        await db
          .from('assets')
          .update({
            notes: `${a.notes ?? ''} ${LOAN_REPAID_OUTSIDE}`.trim(),
          })
          .eq('id', id)
          .eq('household_id', hh)
          .select('id'),
        'loan note',
      );
  }

  // new loan records first, so their rules can point at them
  const waived = new Set<string>();
  for (const r of toSave.filter((x) => x.action === 'loan' && x.target === 'new')) {
    const firstOut = t.lines
      .filter((l) => l.amount < 0 && personNamed(l.narration, [{ name: r.name }]))
      .sort((a, b) => a.txn_on.localeCompare(b.txn_on))[0];
    const owner =
      loaded.assetRows.find((a) => a.id === firstOut?.asset_id)?.owner_id ??
      loaded.assetRows[0]!.owner_id;
    const a = must(
      await db
        .from('assets')
        .insert({
          household_id: hh,
          type: 'receivable',
          owner_id: owner,
          nickname: `Loan to ${r.name}`,
          status: 'active',
          currency: 'INR',
          notes: `From the bank statements, by your rule for ${r.name}.${r.interest ? ' Pays interest.' : ''}${r.waive ? ` ${LOAN_FORGIVEN}` : ''}${r.note ? ` ${r.note}` : ''}`,
        })
        .select('id')
        .single(),
      `loan to ${r.name}`,
    ) as { id: string };
    must(
      await db
        .from('receivables')
        .insert({
          asset_id: a.id,
          household_id: hh,
          counterparty: r.name,
          lent: 1,
          lent_on: firstOut?.txn_on ?? null,
          interest_note: r.interest ? 'Pays interest (from the bank statements)' : null,
        })
        .select('asset_id'),
      'loan',
    );
    r.assetId = a.id;
    if (r.waive) waived.add(a.id);
  }
  for (const r of toSave)
    must(
      await db
        .from('statement_rules')
        .insert({
          household_id: hh,
          name: r.name,
          match: r.match ?? 'name',
          action: r.action,
          asset_id: r.assetId,
          direction: r.direction ?? 'any',
          interest: !!r.interest,
          note: r.note ?? null,
        })
        .select('id'),
      `rule ${r.name}`,
    );
  console.log(`Saved ${toSave.length} rules.`);

  // every loan the statements built, brought up to date with the lines now linked to it
  loaded = await loadPortfolioData(db, { householdId: hh });
  const sync = await syncStatementLoans(db, hh, {
    loaded,
    waived,
    log: (l) => console.log(l),
  });
  console.log(`Loans from the statements: ${sync.loans}, brought up to date ${sync.updated}.`);
  const rb = await rebuildStatementMoves(db, hh);
  console.log(
    `Movements from statements: ${rb.added} added, ${rb.removed} replaced. Lines to answer: ${rb.toAnswer}`,
  );
}

main().catch((e: unknown) => {
  console.error((e as Error).message);
  process.exit(1);
});
