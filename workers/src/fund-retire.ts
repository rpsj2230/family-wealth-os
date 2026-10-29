/* eslint-disable no-console */
/**
 * Retires fund records that repeat a holding already on file (Actions > Fund retire, run by hand): each named record of the person is
 * marked merged, so it counts on no day (not even the days before it was found out), and its scheme details row is removed, so no fund list shows it; its value readings stay as
 * history (they are append-only). Only a record with no statement lines can be retired: one with lines carries real history and is
 * refused. MODE=plan writes nothing. Prints names and counts only.
 */
import { connectDb, householdId, must, need } from './shared';

async function main() {
  const write = process.env.MODE === 'apply';
  const person = need('PERSON');
  const names = need('NAMES')
    .split('|')
    .map((n) => n.trim())
    .filter(Boolean);
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
  const picked = names.map((n) => {
    const hits = funds.filter((f) => f.nickname === n);
    if (hits.length !== 1) throw new Error(`Expected one fund named "${n}", found ${hits.length}.`);
    return hits[0]!;
  });
  for (const f of picked) {
    const { count } = await db
      .from('mf_transactions')
      .select('*', { count: 'exact', head: true })
      .eq('asset_id', f.id);
    if (count) throw new Error(`"${f.nickname}" has ${count} statement lines: not retired.`);
  }
  console.log(
    `Retiring ${picked.length} record(s) of ${owner.display_name}, mode ${write ? 'apply' : 'plan'}`,
  );
  for (const f of picked) {
    console.log(
      `- ${f.nickname} (${f.status}) → merged, counted on no day, removed from the fund lists; readings kept`,
    );
    if (!write) continue;
    must(await db.from('mf_positions').delete().eq('asset_id', f.id), 'mf_positions');
    must(
      await db.from('assets').update({ status: 'merged' }).eq('id', f.id).eq('household_id', hh),
      'assets',
    );
  }
  if (!write) console.log('Plan only: nothing was written');
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
