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
import { loadMoneyTrail, loadPortfolioData, rebuildStatementMoves } from '@fwos/data';
import { connectDb, householdId, must, need } from './shared';

interface RuleInput {
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
const STATEMENT_LOAN = /^From the bank statements/;

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
    if (pick.length === 1) return { assetId: pick[0]!.id, why: label(pick[0]!.id) };
    return {
      assetId: null,
      why: `${pick.length} holdings match "${r.target}": ${pick.map((a) => label(a.id)).join('; ') || 'none'}`,
    };
  };

  let t = await loadMoneyTrail(db, hh, loaded);
  const existing = must(
    await db.from('statement_rules').select('name, action').eq('household_id', hh),
    'rules',
  ) as { name: string; action: string }[];
  const toSave: (RuleInput & { assetId: string | null })[] = [];
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
    if (dup || (needsTarget && !target.assetId)) continue;
    toSave.push({ ...r, assetId: target.assetId });
  }
  if (!write) {
    console.log(`\nPlan only: ${toSave.length} rules would be saved. Run again with mode "apply".`);
    return;
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
          notes: `From the bank statements, by your rule for ${r.name}.${r.interest ? ' Pays interest.' : ''}${r.note ? ` ${r.note}` : ''}`,
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
  t = await loadMoneyTrail(db, hh, loaded);
  const loans = loaded.assetRows.filter(
    (a) => a.type === 'receivable' && a.status !== 'merged' && STATEMENT_LOAN.test(a.notes ?? ''),
  );
  for (const loan of loans) {
    const linked = t.lines
      .filter((l) => {
        const c = t.classified.get(l.id);
        return c?.cls === 'own_transfer' && c.counterpart === loan.id;
      })
      .sort((a, b) => a.txn_on.localeCompare(b.txn_on));
    if (!linked.length) continue;
    const lent = -linked.filter((l) => l.amount < 0).reduce((s, l) => s + l.amount, 0);
    const back = linked.filter((l) => l.amount > 0);
    const steps: { date: string; owed: number }[] = [];
    let owed = 0;
    for (const l of linked) {
      owed = Math.max(0, Math.round((owed - l.amount) * 100) / 100);
      const last = steps[steps.length - 1];
      if (last && last.date === l.txn_on) last.owed = owed;
      else steps.push({ date: l.txn_on, owed });
    }
    // paid back in full outside the statements (said so when it was recorded), or forgiven: nothing owed after the last line
    const outside = /paid back outside these statements/.test(loan.notes ?? '');
    const forgive = waived.has(loan.id);
    if ((outside || forgive) && owed > 1) steps[steps.length - 1]!.owed = 0;
    const final = steps[steps.length - 1]!.owed;
    console.log(
      `  ${loan.nickname}: lent ${lakh(lent)}, paid back ${lakh(back.reduce((s, l) => s + l.amount, 0))} in ${back.length}, still owed ${lakh(final)}${forgive && owed > 1 ? ` (${lakh(owed)} forgiven)` : ''}`,
    );
    must(
      await db
        .from('receivables')
        .update({
          lent: Math.max(1, Math.round(lent * 100) / 100),
          lent_on: linked.find((l) => l.amount < 0)?.txn_on ?? null,
        })
        .eq('asset_id', loan.id)
        .eq('household_id', hh)
        .select('asset_id'),
      'loan',
    );
    must(
      await db
        .from('receivable_payments')
        .delete()
        .eq('asset_id', loan.id)
        .eq('household_id', hh)
        .like('note', 'From the bank statement%')
        .select('id'),
      'old repayments',
    );
    if (back.length)
      must(
        await db
          .from('receivable_payments')
          .insert(
            back.map((l) => ({
              household_id: hh,
              asset_id: loan.id,
              amount: l.amount,
              paid_on: l.txn_on,
              note: 'From the bank statement',
            })),
          )
          .select('id'),
        'repayments',
      );
    // the amounts owed: earlier ones from the statements are superseded by these
    const old = must(
      await db
        .from('observations')
        .select('id')
        .eq('asset_id', loan.id)
        .eq('source', 'statement')
        .is('superseded_by', null),
      'amounts owed',
    ) as { id: string }[];
    const made = must(
      await db
        .from('observations')
        .insert(
          steps.map((s) => ({
            household_id: hh,
            asset_id: loan.id,
            kind: 'valuation',
            amount: s.owed,
            currency: 'INR',
            as_of: s.date,
            source: 'statement',
            source_ref: `loan:${loan.id}:${s.date}:v2`,
            confidence: 'verified',
            note:
              forgive && s === steps[steps.length - 1] && owed > 1
                ? 'The rest was forgiven (a gift)'
                : 'Still owed, from the bank statements',
          })),
        )
        .select('id'),
      'amounts owed',
    ) as { id: string }[];
    for (const o of old)
      await db
        .from('observations')
        .update({ superseded_by: made[made.length - 1]!.id })
        .eq('id', o.id);
    const status = final <= Math.max(1, lent * 0.01) ? 'closed' : 'active';
    if (status !== loan.status)
      must(
        await db
          .from('assets')
          .update({ status })
          .eq('id', loan.id)
          .eq('household_id', hh)
          .select('id'),
        'loan status',
      );
  }
  const rb = await rebuildStatementMoves(db, hh);
  console.log(
    `Movements from statements: ${rb.added} added, ${rb.removed} replaced. Lines to answer: ${rb.toAnswer}`,
  );
}

main().catch((e: unknown) => {
  console.error((e as Error).message);
  process.exit(1);
});
