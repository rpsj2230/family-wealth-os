/* eslint-disable no-console */
/**
 * Joins two records of the same fund held by one person (Actions > Fund merge, run by hand): everything recorded against the record
 * named FROM (its statement lines, value readings, SIP changes, folio links, goal shares, tasks) moves to the record named INTO, the
 * scheme details on file for FROM fill in what INTO lacks, and the empty FROM record is removed. INTO keeps its own name, status and
 * history. Used when a fund was entered twice (a spreadsheet row and a statement under a newer scheme name). Value readings are
 * append-only and cannot move or be deleted: when FROM has any, it is retired instead of removed (merged, so it counts on no day, with
 * its scheme details row removed so no fund list shows it; its readings stay as history). MODE=plan writes nothing. Prints the two
 * names and counts only, never amounts.
 */
import { connectDb, householdId, must, need } from './shared';

/** Tables that point at a holding by asset_id, and the columns that make a row unique for one holding (a clash keeps INTO's row). */
const TABLES: { table: string; unique: string[] | null }[] = [
  { table: 'mf_transactions', unique: ['source_ref'] },
  { table: 'mf_snapshots', unique: ['as_of'] },
  { table: 'mf_sip_changes', unique: ['effective_on'] },
  { table: 'fund_import_ignores', unique: ['verdict', 'basis'] },
  { table: 'goal_allocations', unique: ['goal_id'] },
  { table: 'fund_folio_links', unique: null },
  { table: 'tasks', unique: null },
  { table: 'inbox_messages', unique: null },
  { table: 'asset_rate_history', unique: null },
];
/** Tables a fund never uses: the merge stops if FROM has rows there, rather than guess. */
const NOT_FOR_FUNDS = ['statement_lines', 'bank_statements', 'fixed_deposits', 'receivables'];

async function main() {
  const write = process.env.MODE === 'apply';
  const person = need('PERSON');
  const fromName = need('FROM');
  const intoName = need('INTO');
  const db = connectDb();
  const hh = await householdId(db);
  const owners = must(
    await db.from('owners').select('id, display_name').eq('household_id', hh),
    'owners',
  ) as { id: string; display_name: string }[];
  const owner = owners.find((o) => o.display_name.toLowerCase() === person.toLowerCase());
  if (!owner) throw new Error('No such person on file.');
  const funds = must(
    await db
      .from('assets')
      .select('id, nickname, status')
      .eq('household_id', hh)
      .eq('owner_id', owner.id)
      .eq('type', 'mutual_fund'),
    'assets',
  ) as { id: string; nickname: string; status: string }[];
  const pick = (n: string) => {
    const hits = funds.filter((f) => f.nickname === n);
    if (hits.length !== 1) throw new Error(`Expected one fund named "${n}", found ${hits.length}.`);
    return hits[0]!;
  };
  const from = pick(fromName);
  const into = pick(intoName);
  if (from.id === into.id) throw new Error('FROM and INTO are the same record.');
  console.log(
    `Joining "${from.nickname}" into "${into.nickname}" (${into.status}), mode ${write ? 'apply' : 'plan'}`,
  );

  for (const t of NOT_FOR_FUNDS) {
    const { count } = await db
      .from(t)
      .select('*', { count: 'exact', head: true })
      .eq('asset_id', from.id);
    if (count)
      throw new Error(
        `"${from.nickname}" has ${count} rows in ${t}: not a fund-only record, stopping.`,
      );
  }
  for (const col of ['from_asset_id', 'to_asset_id']) {
    const { count } = await db
      .from('money_moves')
      .select('*', { count: 'exact', head: true })
      .eq(col, from.id);
    if (count) throw new Error(`"${from.nickname}" is in ${count} money moves: stopping.`);
  }

  for (const { table, unique } of TABLES) {
    const sel = unique ? ['asset_id', ...unique].join(', ') : 'asset_id';
    const rows = must(
      await db.from(table).select(sel).eq('asset_id', from.id),
      table,
    ) as unknown as Record<string, unknown>[];
    if (rows.length === 0) continue;
    let clash = 0;
    if (unique) {
      const theirs = must(
        await db.from(table).select(unique.join(', ')).eq('asset_id', into.id),
        table,
      ) as unknown as Record<string, unknown>[];
      const key = (r: Record<string, unknown>) => unique.map((u) => String(r[u])).join('|');
      const have = new Set(theirs.map(key));
      const clashing = rows.filter((r) => have.has(key(r)));
      clash = clashing.length;
      if (write)
        for (const r of clashing) {
          let q = db.from(table).delete().eq('asset_id', from.id);
          for (const u of unique) q = q.eq(u, r[u] as string);
          must(await q, `${table} clash`);
        }
    }
    console.log(
      `- ${table}: ${rows.length - clash} move${clash ? `, ${clash} already on "${into.nickname}" (kept there)` : ''}`,
    );
    if (write)
      must(await db.from(table).update({ asset_id: into.id }).eq('asset_id', from.id), table);
  }

  // the scheme details: what INTO lacks comes from FROM (the scheme code lets later imports find INTO)
  const pos = must(
    await db.from('mf_positions').select('*').in('asset_id', [from.id, into.id]),
    'mf_positions',
  ) as Record<string, unknown>[];
  const pf = pos.find((p) => p.asset_id === from.id);
  const pi = pos.find((p) => p.asset_id === into.id);
  if (pf && pi) {
    const fill: Record<string, unknown> = {};
    for (const k of [
      'amfi_code',
      'folio_last4',
      'started_on',
      'nav_hint',
      'exit_load_pct',
      'exit_load_days',
    ])
      if ((pi[k] === null || pi[k] === undefined) && pf[k] !== null && pf[k] !== undefined)
        fill[k] = pf[k];
    // the plan and the money put in follow the statement lines, which now sit on INTO
    if (pf.plan_type && pf.plan_type !== 'regular_or_unknown') fill.plan_type = pf.plan_type;
    if (Number(pf.invested) > 0) fill.invested = pf.invested;
    if (pf.provenance === 'cas') fill.provenance = 'cas';
    console.log(
      `- scheme details filled on "${into.nickname}": ${Object.keys(fill).join(', ') || 'none'}`,
    );
    if (write && Object.keys(fill).length)
      must(await db.from('mf_positions').update(fill).eq('asset_id', into.id), 'mf_positions');
  }
  const { count: readings } = await db
    .from('observations')
    .select('*', { count: 'exact', head: true })
    .eq('asset_id', from.id);
  if (readings)
    console.log(
      `- observations: ${readings} stay on the retired record (value readings are append-only)`,
    );
  if (write) {
    if (readings) {
      must(await db.from('mf_positions').delete().eq('asset_id', from.id), 'mf_positions');
      must(
        await db
          .from('assets')
          .update({ status: 'merged' })
          .eq('id', from.id)
          .eq('household_id', hh),
        'assets',
      );
      console.log(
        `Retired "${from.nickname}": kept as history, counted on no day and no longer listed with the funds.`,
      );
    } else {
      must(await db.from('assets').delete().eq('id', from.id).eq('household_id', hh), 'assets');
      console.log(`Removed the empty record "${from.nickname}".`);
    }
  } else console.log('Plan only: nothing was written');
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
