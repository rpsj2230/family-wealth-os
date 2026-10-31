/* eslint-disable no-console */
/**
 * Read-only: where the money trail (money-chain.ts) stops on the live data, and why. Prints counts, dates and shares only: each
 * account by its bank, last four digits and holder, with its statement dates and line counts, never an amount of a holding. Writes
 * nothing. Run by hand (Actions > Trail gaps).
 */
import { createClient } from '@supabase/supabase-js';
import {
  addDaysIso,
  capitalLedger,
  chainCoverage,
  dayEndBalances,
  disagreements,
  historyReview,
  monthChanges,
  ORIGIN_LABEL,
  REAL_STARTS,
  statementCoverage,
  lastFinishedMonthEnd,
  twoWayPeople,
} from '@fwos/core';
import {
  ALERTS_FILE,
  capitalDays,
  capitalStart,
  ledgerMovesFor,
  loadMoneyTrail,
  loadPortfolioData,
  loadPositionInput,
  loadSettings,
  loadStatements,
  positionFor,
  statementPicture,
} from '@fwos/data';

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

  // 0. what the trail page's "How complete the trail is" shows: the share of today's money traced to a real start, and the rest
  // by where it stops, with the holdings and steps behind the largest gaps (shares only)
  const kindOf = (id: string) => t.holdings.find((h) => h.id === id)?.kind ?? null;
  const cov = chainCoverage(c, kindOf);
  console.log(
    `\n== How complete the trail is (as the page shows it): traced ${pct(cov.traced * cov.total, cov.total)}`,
  );
  const byKind = new Map<string, number>();
  for (const p of cov.starts) byKind.set(p.kind, (byKind.get(p.kind) ?? 0) + p.amount);
  for (const [k, v] of [...byKind].sort((a, b) => b[1] - a[1]))
    console.log(
      `  ${REAL_STARTS.has(k as never) ? 'traced' : 'GAP   '} ${ORIGIN_LABEL[k as keyof typeof ORIGIN_LABEL] ?? k}: ${pct(v, cov.total)}`,
    );
  console.log(
    '  where today’s money is: ' +
      cov.where.map((w) => `${w.kind} ${pct(w.amount, cov.total)}`).join(', '),
  );
  const gaps = cov.starts
    .filter((p) => !REAL_STARTS.has(p.kind))
    .sort((a, b) => b.amount - a.amount);
  console.log('  largest gap starts (step, holding, share of all money held):');
  for (const p of gaps.slice(0, 40)) {
    const n = c.nodes.get(p.node);
    console.log(
      `    ${p.kind} [${t.classified.get(p.node)?.cls ?? n?.kind ?? '?'}${t.classified.get(p.node)?.counterpart ? ` → ${name(t.classified.get(p.node)!.counterpart)}` : ''}] ${n?.date ?? p.date} ${name(n?.assetId ?? p.assetId ?? null)}${
        n && n.kind === 'line'
          ? ` "${String((n as { narration?: string }).narration ?? '')
              .toLowerCase()
              .replace(/\d/g, '#')
              .slice(0, 50)}"`
          : ''
      }: ${pct(p.amount, cov.total)}`,
    );
  }

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

/**
 * After the rules: how much of the money moved is placed and traced, what is left and its shape (the bank's own words of the
 * narrations, never a name or an amount of a holding), whether every statement is there, and how much of own money is still worked
 * out from balances. Shares and counts only.
 */
async function afterRules(household: string) {
  const loaded = await loadPortfolioData(db, { householdId: household });
  const { config } = await loadSettings(db, household);
  // an account by its bank, kind, last four digits and holder (no amounts)
  const name = (id: string) => {
    const a = loaded.assetRows.find((x) => x.id === id);
    if (!a) return '(not on file)';
    return [
      a.institution_id ? loaded.institutionName?.get(a.institution_id) : null,
      a.account_kind ?? a.type,
      a.identifier_last4 ? `…${a.identifier_last4}` : null,
      loaded.ownerName.get(a.owner_id),
    ]
      .filter(Boolean)
      .join(' ');
  };
  const stored = await loadStatements(db, household);
  const picture = statementPicture(stored, loaded, config, positionFor(loaded, config, true));
  const byId = new Map(picture.lines.map((l) => [l.id, l]));
  const abs = (n: number) => Math.abs(n);
  const total = picture.lines.reduce((a, l) => a + abs(l.amount), 0);
  console.log(`\n== After the rules: ${picture.lines.length} statement lines`);
  const byCls = new Map<string, { n: number; v: number }>();
  for (const c of picture.classified) {
    const l = byId.get(c.id);
    if (!l) continue;
    const g = byCls.get(c.cls) ?? { n: 0, v: 0 };
    g.n++;
    g.v += abs(l.amount);
    byCls.set(c.cls, g);
  }
  for (const [k, g] of [...byCls].sort((a, b) => b[1].v - a[1].v))
    console.log(
      `  ${k.padEnd(13)} ${String(g.n).padStart(5)} lines, ${pct(g.v, total)} of the money`,
    );

  // the trail: lines between the family's own holdings that do not name the other side
  const INTERNAL = new Set(['own_transfer', 'fd_funding', 'fd_proceeds', 'fund_buy', 'fund_sell']);
  const internal = picture.classified.filter((c) => INTERNAL.has(c.cls));
  const open = internal.filter((c) => !c.counterpart && !c.remittanceId);
  const iv = internal.reduce((a, c) => a + abs(byId.get(c.id)?.amount ?? 0), 0);
  const ov = open.reduce((a, c) => a + abs(byId.get(c.id)?.amount ?? 0), 0);
  console.log(
    `\n== Trail: ${pct(iv - ov, iv)} of the money moved between your own holdings names its other side; ${open.length} lines do not`,
  );
  // their shape: the bank's own words only (no names, no numbers), and the reason the rule gave
  const BANKWORD =
    /^(neft|rtgs|imps|upi|ach|nach|ecs|trf|transfer|to|from|by|cr|dr|chq|clg|atm|pos|int|tds|si|fd|td|rd|cms|mmt|inb|ib|mb|own|self|ac|acct|account|deposit|closure|proceeds|maturity|renewal|sweep|auto|iccl|bse|cams|kfin|nse|mf|sip|wise|remittance|inward|outward|ft|funds?|tpt|p2a|vpa|ref)$/i;
  const shape = (n: string) =>
    (n.match(/[A-Za-z]+/g) ?? [])
      .filter((w) => BANKWORD.test(w))
      .slice(0, 4)
      .map((w) => w.toUpperCase())
      .join(' ') || '(no bank words)';
  const shapes = new Map<string, { n: number; v: number; cls: Set<string> }>();
  for (const c of open) {
    const l = byId.get(c.id)!;
    const k = shape(l.narration);
    const g = shapes.get(k) ?? { n: 0, v: 0, cls: new Set<string>() };
    g.n++;
    g.v += abs(l.amount);
    g.cls.add(`${c.cls}${l.amount > 0 ? '+' : '-'}`);
    shapes.set(k, g);
  }
  for (const [k, g] of [...shapes].sort((a, b) => b[1].v - a[1].v).slice(0, 20))
    console.log(
      `  ${pct(g.v, ov).padStart(4)}  ${String(g.n).padStart(4)} lines  [${[...g.cls].join(',')}]  ${k}`,
    );
  const reasons = new Map<string, number>();
  for (const c of open) {
    const r = c.reason
      .replace(/\d[\d,.]*/g, '#')
      .replace(/₹#/g, '₹#')
      .slice(0, 70);
    reasons.set(r, (reasons.get(r) ?? 0) + abs(byId.get(c.id)!.amount));
  }
  console.log('  by the reason given:');
  for (const [r, v] of [...reasons].sort((a, b) => b[1] - a[1]).slice(0, 12))
    console.log(`    ${pct(v, ov).padStart(4)}  ${r}`);

  // lines still to answer, and their shape
  const ask = picture.classified.filter((c) => c.cls === 'ask_in' || c.cls === 'ask_out');
  const av = ask.reduce((a, c) => a + abs(byId.get(c.id)?.amount ?? 0), 0);
  console.log(`\n== Lines still to answer: ${ask.length}, ${pct(av, total)} of the money`);
  const askShapes = new Map<string, { n: number; v: number }>();
  for (const c of ask) {
    const l = byId.get(c.id)!;
    const k = `${l.amount > 0 ? 'in ' : 'out'} ${shape(l.narration)}`;
    const g = askShapes.get(k) ?? { n: 0, v: 0 };
    g.n++;
    g.v += abs(l.amount);
    askShapes.set(k, g);
  }
  for (const [k, g] of [...askShapes].sort((a, b) => b[1].v - a[1].v).slice(0, 12))
    console.log(`  ${pct(g.v, av).padStart(4)}  ${String(g.n).padStart(4)} lines  ${k}`);

  // are all the statements here?
  const real = stored.statements.filter((x) => x.file_label !== ALERTS_FILE);
  const recs = new Map<string, string[]>();
  for (const o of loaded.obsRows) recs.set(o.asset_id, [...(recs.get(o.asset_id) ?? []), o.as_of]);
  const today = loaded.today.toISOString().slice(0, 10);
  const accts = loaded.assetRows
    .filter(
      (a) =>
        a.type === 'bank_account' &&
        a.currency === 'INR' &&
        a.status !== 'gifted' &&
        a.status !== 'merged',
    )
    .flatMap((a) => {
      const ds = [
        ...(recs.get(a.id) ?? []),
        ...real.filter((x) => x.asset_id === a.id).map((x) => x.from_on),
      ].sort();
      const held = a.status === 'active' || a.status === 'stopped';
      return ds.length
        ? [
            {
              assetId: a.id,
              from: ds[0]!,
              to: held ? lastFinishedMonthEnd(today) : ds[ds.length - 1]!,
            },
          ]
        : [];
    });
  const cov = statementCoverage(
    accts,
    real.map((x) => ({
      assetId: x.asset_id,
      from: x.from_on,
      to: x.to_on,
      opening: x.opening === null ? null : Number(x.opening),
      closing: x.closing === null ? null : Number(x.closing),
    })),
  );
  const months = cov.reduce((a, r) => a + r.months.length, 0);
  const full = cov.reduce((a, r) => a + r.full, 0);
  console.log(
    `\n== Statements: ${pct(full, months)} of ${months} account-months covered in full; ${cov.filter((r) => r.full === r.months.length && !r.breaks.length).length} of ${cov.length} accounts complete`,
  );
  console.log(
    `  gaps between statements: ${cov.reduce((a, r) => a + r.breaks.filter((b) => b.kind === 'gap').length, 0)}; statements opening off the last close: ${cov.reduce((a, r) => a + r.breaks.filter((b) => b.kind === 'balance').length, 0)}`,
  );
  for (const r of cov
    .filter((x) => x.full < x.months.length)
    .sort((a, b) => b.months.length - b.full - (a.months.length - a.full)))
    console.log(
      `  ${name(r.assetId)}: ${r.full}/${r.months.length} months; missing ${r.missing.map((m) => (m.from === m.to ? m.from : `${m.from}..${m.to}`)).join(', ')}`,
    );
  // each statement of a flagged account, against every account at the same bank: whose typed balances do its balances match?
  for (const bad of loaded.bank?.untrusted ?? []) {
    const acct = loaded.assetRows.find((a) => a.id === bad);
    const peers = loaded.assetRows.filter(
      (a) =>
        a.type === 'bank_account' &&
        a.currency === 'INR' &&
        a.institution_id === acct?.institution_id,
    );
    const linesOf = await db
      .from('statement_lines')
      .select('statement_id, txn_on, amount, balance')
      .eq('asset_id', bad);
    for (const st of real.filter((x) => x.asset_id === bad)) {
      const ls = (linesOf.data ?? []).filter((l) => l.statement_id === st.id);
      const ends =
        dayEndBalances(
          ls.map((l) => ({
            assetId: 'x',
            date: l.txn_on as string,
            amount: Number(l.amount),
            balance: l.balance === null ? null : Number(l.balance),
          })),
        ).get('x') ?? [];
      const score = peers.map((p) => {
        const typed = loaded.obsRows.filter(
          (o) => o.asset_id === p.id && o.as_of >= st.from_on && o.as_of <= st.to_on,
        );
        const judged = typed
          .map((o) => {
            const b = ends.filter((e) => e.date <= o.as_of).pop();
            return b
              ? Math.abs(b.amount - Number(o.amount)) <= Math.max(1, 0.01 * Math.abs(b.amount))
              : null;
          })
          .filter((x): x is boolean => x !== null);
        return { p: name(p.id), n: judged.length, ok: judged.filter(Boolean).length };
      });
      console.log(
        `  statement ${st.from_on}..${st.to_on} filed to ${name(bad)}: ${score.map((x) => `${x.p} ${x.ok}/${x.n}`).join('; ')}`,
      );
    }
  }
  if (loaded.bank?.untrusted?.length)
    console.log(
      `  statements that do not agree with the typed balances (typed kept): ${loaded.bank.untrusted.map(name).join('; ')}`,
    );
  if (loaded.bank) {
    const ds = disagreements(
      loaded.obsRows.map((o) => ({ assetId: o.asset_id, date: o.as_of, amount: Number(o.amount) })),
      loaded.bank,
      1,
    );
    const size = new Map<string, number>();
    const day = new Map<string, number>();
    for (const d of ds) {
      const r = Math.abs(d.typed - d.bank) / Math.max(1, Math.abs(d.bank));
      const k1 =
        r < 0.001
          ? 'under 0.1%'
          : r < 0.01
            ? '0.1–1%'
            : r < 0.05
              ? '1–5%'
              : r < 0.5
                ? '5–50%'
                : 'over 50%';
      size.set(k1, (size.get(k1) ?? 0) + 1);
      const dd = Number(d.date.slice(8, 10));
      const k2 = dd <= 3 ? 'day 1–3' : dd >= 28 ? 'day 28–31' : 'mid-month';
      day.set(k2, (day.get(k2) ?? 0) + 1);
    }
    console.log(`  typed balances that differ from the bank's: ${ds.length}`);
    console.log(`    by size: ${[...size].map(([k, v]) => `${k} ${v}`).join(', ')}`);
    console.log(
      `    by day of the month typed: ${[...day].map(([k, v]) => `${k} ${v}`).join(', ')}`,
    );
    // would the bank's balance a day or a month earlier match? (a tab dated the 1st for the month before)
    const ends = loaded.bank.dayEnds;
    const prevMonth = ds.filter((d) => {
      const before = (ends[d.assetId] ?? [])
        .filter((p) => p.date < `${d.date.slice(0, 7)}-01`)
        .pop();
      return before && Math.abs(before.amount - d.typed) <= 1;
    }).length;
    const later = ds.filter((d) =>
      (ends[d.assetId] ?? []).some(
        (p) =>
          p.date > d.date &&
          p.date <= `${d.date.slice(0, 8)}31` &&
          Math.abs(p.amount - d.typed) <= 1,
      ),
    ).length;
    console.log(
      `    equal to the bank's balance at the end of the month before: ${prevMonth}; later in the same month: ${later}`,
    );
    // by account: how many differ, by how much (the typed one as a share of the bank's), and whether the account's statements
    // chain without a break (each line's balance follows from the one before)
    const per = new Map<string, number[]>();
    for (const d of ds)
      per.set(d.assetId, [...(per.get(d.assetId) ?? []), d.typed / Math.max(1, d.bank)]);
    const breaks = new Map<string, number>();
    for (const st of real) breaks.set(st.asset_id, (breaks.get(st.asset_id) ?? 0) + st.breaks);
    for (const [id, rs] of [...per].sort((a, b) => b[1].length - a[1].length)) {
      const sorted = [...rs].sort((a, b) => a - b);
      const mid = sorted[Math.floor(sorted.length / 2)]!;
      console.log(
        `    ${name(id)}: ${rs.length} differ; typed ÷ bank median ${mid.toFixed(2)} (from ${sorted[0]!.toFixed(2)} to ${sorted[sorted.length - 1]!.toFixed(2)}); line breaks in its statements ${breaks.get(id) ?? 0}`,
      );
    }
  }

  // own money still worked out from balances, and the months the review asks about
  const position = await loadPositionInput(db, loaded, {
    config,
    days: capitalDays(capitalStart(loaded, config), today, config.home.changeDays),
  });
  const ledger = capitalLedger({
    position,
    moves: ledgerMovesFor(loaded.engine.moves, position, config),
    openingDate: config.capital.openingDate || null,
    reinvestDays: config.harvest.reinvestDays,
  });
  const tt = ledger.totals;
  console.log(
    `\n== Money movements: own money is ${pct(abs(tt.confirmedExternal + tt.corrections), abs(tt.confirmedExternal) + abs(tt.corrections) + abs(tt.unexplained))} confirmed, the rest worked out from balances`,
  );
  const r = historyReview({
    ledger,
    position,
    minimum: config.capital.reviewMinimum,
    minimumPct: config.capital.reviewMinimumPct,
    pairMonths: config.capital.reviewPairMonths,
    before: addDaysIso(today, -Math.max(config.deposits.hideMaturedAfterDays, 120)),
    coverage: real.map((x) => ({ assetId: x.asset_id, from: x.from_on, to: x.to_on })),
  });
  console.log(
    `  earlier months: ${r.open.length} to answer, ${r.byStatements.length} decided by statements, ${r.settled.length} settled by the records, ${r.cancelling.length} pairs cancelling, ${r.small.count} below the limits`,
  );
  const people = twoWayPeople(picture.lines, picture.classified, {
    ownNames: [...loaded.ownerName.values()],
    borrowers: loaded.assetRows
      .filter((a) => a.type === 'receivable')
      .map((a) => a.nickname.replace(/^(loan|money lent|gift)\s+to\s+/i, '')),
    minimum: config.statements.reviewAbove,
  });
  console.log(`  people paid and paying back, not yet recorded as loans: ${people.length}`);

  // where the money still worked out from balances sits: each month's unexplained amount, put on the accounts that moved that month
  // with no statement covering them (shares of the whole, by account; and by year)
  const spans = loaded.bank?.spans ?? {};
  const covers = (id: string, from: string, to: string) =>
    (spans[id] ?? []).some((x) => x.from <= from && x.to >= to);
  const byAcct = new Map<string, number>();
  const byYear = new Map<string, number>();
  let allUnx = 0;
  for (const m of ledger.months) {
    const u = Math.abs(m.unexplained);
    if (u < 1) continue;
    allUnx += u;
    byYear.set(m.from.slice(0, 4), (byYear.get(m.from.slice(0, 4)) ?? 0) + u);
    const ch = monthChanges(position, m, Number.POSITIVE_INFINITY).filter(
      (c) => Math.abs(c.change) >= config.capital.reviewMinimum,
    );
    const open = ch.filter((c) => {
      const a = loaded.assetRows.find((x) => x.id === c.assetId);
      if (!a) return false;
      if (a.type === 'bank_account' && a.currency === 'INR')
        return !covers(c.assetId, m.from, m.through);
      return a.type !== 'fixed_deposit' && a.type !== 'mutual_fund';
    });
    const w = open.reduce((x, c) => x + Math.abs(c.change), 0);
    if (!w) {
      byAcct.set(
        '(no account without a statement moved: residual of estimates and lines)',
        (byAcct.get('(no account without a statement moved: residual of estimates and lines)') ??
          0) + u,
      );
      continue;
    }
    for (const c of open) {
      const a = loaded.assetRows.find((x) => x.id === c.assetId)!;
      const k =
        a.type === 'bank_account' && a.currency !== 'INR'
          ? `${name(c.assetId)} (abroad)`
          : name(c.assetId);
      byAcct.set(k, (byAcct.get(k) ?? 0) + (u * Math.abs(c.change)) / w);
    }
  }
  console.log('\n== Where the money worked out from balances sits (share of all of it)');
  for (const [k, v] of [...byAcct].sort((a, b) => b[1] - a[1]).slice(0, 25))
    console.log(`  ${pct(v, allUnx).padStart(4)}  ${k}`);
  console.log(
    '  by year: ' +
      [...byYear]
        .sort()
        .map(([y, v]) => `${y} ${pct(v, allUnx)}`)
        .join(', '),
  );
  console.log(
    `  own money: opening ${pct(Math.abs(tt.opening), Math.abs(tt.opening) + Math.abs(tt.confirmedExternal) + Math.abs(tt.corrections) + Math.abs(tt.unexplained))}, confirmed ${pct(Math.abs(tt.confirmedExternal + tt.corrections), Math.abs(tt.opening) + Math.abs(tt.confirmedExternal) + Math.abs(tt.corrections) + Math.abs(tt.unexplained))}, from balances ${pct(Math.abs(tt.unexplained), Math.abs(tt.opening) + Math.abs(tt.confirmedExternal) + Math.abs(tt.corrections) + Math.abs(tt.unexplained))}`,
  );
  console.log(
    '  earlier months to answer: ' +
      r.open
        .map((m) => `${m.key} (${m.changes.map((c) => name(c.assetId)).join(' / ')})`)
        .join('; '),
  );
}

main()
  .then(async () => {
    const hh = await db.from('households').select('id').limit(1);
    await afterRules(String(hh.data?.[0]?.id ?? ''));
  })
  .catch((e) => {
    console.error('Trail gaps failed:', (e as Error).message);
    process.exit(1);
  });
