/* eslint-disable no-console */
/**
 * Read-only: where the money trail (money-chain.ts) stops on the live data, and why. Prints counts, dates and shares only: each
 * account by its bank, last four digits and holder, with its statement dates and line counts, never an amount of a holding. Writes
 * nothing. Run by hand (Actions > Trail gaps).
 */
import { createClient } from '@supabase/supabase-js';
import { loadMoneyTrail, loadPortfolioData } from '@fwos/data';

const need = (n: string) => {
  const v = process.env[n];
  if (!v) {
    console.error(`${n} is required`);
    process.exit(2);
  }
  return v;
};
const db = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false },
});
const pct = (a: number, b: number) => `${b > 0 ? Math.round((a / b) * 100) : 0}%`;

async function main() {
  const hh = await db.from('households').select('id').limit(1);
  const household = String(hh.data?.[0]?.id ?? '');
  const loaded = await loadPortfolioData(db, { householdId: household });
  const t = await loadMoneyTrail(db, household, loaded);
  const c = t.chain;
  const label = new Map(
    loaded.assetRows.map((a) => [
      a.id,
      [
        a.institution_id ? loaded.institutionName?.get(a.institution_id) : null,
        a.type === 'fixed_deposit' ? 'FD' : (a.account_kind ?? a.type),
        a.identifier_last4 ? `…${a.identifier_last4}` : null,
        loaded.ownerName.get(a.owner_id),
        a.status !== 'active' ? `(${a.status})` : null,
      ]
        .filter(Boolean)
        .join(' '),
    ]),
  );
  const name = (id: string | null | undefined) =>
    !id ? '(none named)' : (label.get(id) ?? '(not on file)');

  // 1. every bank account: statements on file, Wise transfers into it, lines in and out
  console.log('\n== Bank accounts: statements and Wise transfers (counts and dates only)');
  const remits = await db.from('remittances').select('id, received_on, to_asset_id, to_basis');
  const linesBy = new Map<string, { first: string; last: string; n: number }>();
  for (const l of t.lines) {
    const x = linesBy.get(l.asset_id) ?? { first: '9999', last: '0000', n: 0 };
    x.n++;
    if (l.txn_on < x.first) x.first = l.txn_on;
    if (l.txn_on > x.last) x.last = l.txn_on;
    linesBy.set(l.asset_id, x);
  }
  const debitsTo = new Map<string, number>();
  for (const n of c.nodes.values())
    for (const e of n.ends)
      if (e.assetId) debitsTo.set(e.assetId, (debitsTo.get(e.assetId) ?? 0) + 1);
  for (const a of loaded.assetRows.filter((x) => x.type === 'bank_account')) {
    const s = linesBy.get(a.id);
    const r = (remits.data ?? []).filter((x) => x.to_asset_id === a.id);
    const before = s ? r.filter((x) => String(x.received_on) < s.first).length : r.length;
    console.log(
      `  ${name(a.id)} | statements: ${s ? `${s.first} to ${s.last}, ${s.n} lines` : 'none'} | Wise in: ${r.length} (${before} before the first statement) | lines out of other accounts that stop here: ${debitsTo.get(a.id) ?? 0}`,
    );
  }
  console.log(
    `  Wise transfers with no account named: ${(remits.data ?? []).filter((x) => !x.to_asset_id).length} of ${(remits.data ?? []).length}`,
  );

  // 2. where money comes from nowhere the statements follow, by kind and year (shares of all money in)
  const ins = [...c.nodes.values()].filter((n) => n.kind === 'line' && n.amount > 0);
  const allIn = ins.reduce((s, n) => s + n.amount, 0);
  const starts = new Map<string, number>();
  const byYear = new Map<string, number>();
  for (const n of c.nodes.values())
    for (const s of n.starts) {
      starts.set(s.kind, (starts.get(s.kind) ?? 0) + s.amount);
      if (
        s.kind === 'untraced_deposit' ||
        s.kind === 'untraced_account' ||
        s.kind === 'unexplained'
      )
        byYear.set(
          `${s.kind} ${n.date.slice(0, 4)}`,
          (byYear.get(`${s.kind} ${n.date.slice(0, 4)}`) ?? 0) + s.amount,
        );
    }
  console.log('\n== Where money starts, as a share of all money in on the statements');
  for (const [k, v] of [...starts].sort((a, b) => b[1] - a[1]))
    console.log(`  ${k}: ${pct(v, allIn)}`);
  console.log('  by year (gaps only):');
  for (const [k, v] of [...byYear].sort()) console.log(`    ${k}: ${pct(v, allIn)}`);

  // 3. deposits paid back with nothing found that booked them: why
  console.log('\n== Deposit pay-backs with no booking found (count, by account and year)');
  const dep = new Map<string, number>();
  for (const n of ins)
    if (n.starts.some((s) => s.kind === 'untraced_deposit')) {
      const k = `${name(n.assetId)} ${n.date.slice(0, 4)} ${n.holding ? 'deposit on file' : 'deposit not on file'}`;
      dep.set(k, (dep.get(k) ?? 0) + 1);
    }
  for (const [k, v] of [...dep].sort()) console.log(`  ${k}: ${v}`);
  const deps = loaded.assetRows.filter((a) => a.type === 'fixed_deposit');
  const fdOf = new Map(loaded.fdRows.map((f) => [f.asset_id, f]));
  console.log('\n== Deposits on file: how each was booked and paid back (no amounts)');
  for (const d of deps) {
    const into = c.into.get(d.id) ?? [];
    const how = into.length
      ? [
          ...new Set(
            into.map((l) =>
              l.node.startsWith('before:')
                ? 'before the statements'
                : l.node.startsWith('renew:')
                  ? 'renewal'
                  : `line (${l.basis})`,
            ),
          ),
        ].join(', ')
      : 'nothing';
    const out = (c.outOf.get(d.id) ?? []).length;
    const f = fdOf.get(d.id);
    console.log(
      `  ${name(d.id)} booked ${f?.booked_on ?? '?'} ends ${f?.ended_on ?? f?.maturity_on ?? '?'}: from ${how}; paid back to ${out} line(s)`,
    );
  }

  // 3b. for each deposit on file booked with nothing found on the statements: the lines around its booking day in its holder's
  // accounts (days apart, kind, amount as a share of the principal, the bank's words with digits hidden)
  const mask = (t: string) =>
    t
      .toLowerCase()
      .replace(/[0-9]/g, '#')
      .replace(/[a-z]{2,}[0-9#]{4,}/g, '…')
      .slice(0, 50);
  const days = (a: string, b: string) =>
    Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000);
  console.log(
    '\n== Deposits booked with nothing found: lines within 10 days in the holder’s accounts',
  );
  for (const d of deps) {
    const f = fdOf.get(d.id);
    if (!f) continue;
    const into = c.into.get(d.id) ?? [];
    const before = into.find((l) => l.node.startsWith('before:'));
    if (!before) continue;
    const node = c.nodes.get(before.node);
    if (node && node.from.length) continue; // booked from money outside the statements
    const principal = Number(f.principal);
    const near = [...c.nodes.values()].filter(
      (n) =>
        n.kind === 'line' &&
        loaded.assetRows.find((a) => a.id === n.assetId)?.owner_id === d.owner_id &&
        Math.abs(days(n.date, f.booked_on)) <= 10 &&
        Math.abs(n.amount) >= principal * 0.2,
    );
    console.log(`  ${name(d.id)} booked ${f.booked_on}: ${near.length} line(s)`);
    for (const n of near.slice(0, 8))
      console.log(
        `    ${days(n.date, f.booked_on) >= 0 ? '+' : ''}${days(n.date, f.booked_on)}d ${name(n.assetId)} ${n.cls} ${(n.amount / principal).toFixed(2)}x "${mask(n.narration)}"`,
      );
  }
  console.log(
    '\n== Deposit pay-backs with no deposit found: the deposits on file of that person ending within 45 days',
  );
  for (const n of ins) {
    if (!n.starts.some((s) => s.kind === 'untraced_deposit') || n.holding) continue;
    const who = loaded.assetRows.find((a) => a.id === n.assetId)?.owner_id;
    const cands = deps
      .filter((d) => d.owner_id === who)
      .map((d) => ({ d, f: fdOf.get(d.id) }))
      .filter((x) => x.f && Math.abs(days(n.date, x.f.ended_on ?? x.f.maturity_on)) <= 45);
    console.log(
      `  ${n.date} ${name(n.assetId)} "${mask(n.narration)}": ${
        cands
          .map(
            (x) =>
              `${name(x.d.id)} ends ${days(x.f!.ended_on ?? x.f!.maturity_on, n.date)}d ${(n.amount / Number(x.f!.principal)).toFixed(2)}x${(c.outOf.get(x.d.id) ?? []).length ? ' (paid)' : ''}`,
          )
          .join('; ') || 'none'
      }`,
    );
  }

  // 4. money out that stops: where, by kind and the account named
  console.log(
    '\n== Money out that stops, by kind and the account named (count, share of all money out)',
  );
  const outs = [...c.nodes.values()].filter((n) => n.kind === 'line' && n.amount < 0);
  const allOut = outs.reduce((s, n) => s - n.amount, 0);
  const ends = new Map<string, { n: number; v: number }>();
  for (const n of outs)
    for (const e of n.ends) {
      const k = `${e.kind} -> ${e.kind === 'spent' || e.kind === 'fee' || e.kind === 'tax' ? '' : name(e.assetId)}`;
      const x = ends.get(k) ?? { n: 0, v: 0 };
      x.n++;
      x.v += e.amount;
      ends.set(k, x);
    }
  for (const [k, x] of [...ends].sort((a, b) => b[1].v - a[1].v))
    console.log(`  ${k}: ${x.n} lines, ${pct(x.v, allOut)}`);

  // 5. lines left to answer that have the same sum going the other way in another account within a week: a transfer between
  // your own accounts the pairing missed, and what that other line was taken for instead
  console.log(
    '\n== Lines to answer with the same sum the other way in another account within 7 days (no amounts)',
  );
  const all = t.lines.map((l) => ({
    ...l,
    cls: t.classified.get(l.id)?.cls ?? 'ask_in',
    counterpart: t.classified.get(l.id)?.counterpart ?? null,
  }));
  const byCents = new Map<number, typeof all>();
  for (const l of all) {
    const k = Math.round(Math.abs(l.amount) * 100);
    byCents.set(k, [...(byCents.get(k) ?? []), l]);
  }
  const dayMs = 86_400_000;
  const words = (x: string) => x.toLowerCase().replace(/\d/g, '#').slice(0, 50);
  let missed = 0;
  for (const l of all.filter((x) => x.cls === 'ask_in' || x.cls === 'ask_out')) {
    const twins = (byCents.get(Math.round(Math.abs(l.amount) * 100)) ?? []).filter(
      (m) =>
        m.asset_id !== l.asset_id &&
        Math.sign(m.amount) === -Math.sign(l.amount) &&
        Math.abs(Date.parse(m.txn_on) - Date.parse(l.txn_on)) <= 7 * dayMs,
    );
    if (!twins.length) continue;
    missed++;
    console.log(`  ${l.txn_on} ${name(l.asset_id)} ${l.cls} "${words(l.narration)}"`);
    for (const m of twins)
      console.log(
        `    ${m.txn_on} ${name(m.asset_id)} ${m.cls}${m.counterpart ? ` (paired with ${name(m.counterpart)})` : ''} "${words(m.narration)}"`,
      );
  }
  console.log(`  ${missed} lines`);
}

main().catch((e) => {
  console.error('Trail gaps failed:', (e as Error).message);
  process.exit(1);
});
