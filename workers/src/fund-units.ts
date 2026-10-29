/* eslint-disable no-console */
/**
 * Corrects the unit count a fund records (Actions > Fund units, run by hand) to the count on a statement, e.g. a depository (CDSL/NSDL)
 * or CAS statement, when an older figure (a spreadsheet snapshot) was stored as the fund's count. The new count must agree with what
 * the statement lines add up to on that date, so a typing error cannot be written; a later count already on file is never replaced.
 * MODE=plan writes nothing. Prints the fund name, dates and unit counts only, never amounts.
 */
import { connectDb, householdId, must, need } from './shared';

const TOLERANCE = 0.01;

async function main() {
  const write = process.env.MODE === 'apply';
  const person = need('PERSON');
  const name = need('NAME').trim();
  const units = Number(need('UNITS'));
  const asOf = need('AS_OF').trim();
  if (!(units >= 0) || !Number.isFinite(units)) throw new Error('UNITS must be a number.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new Error('AS_OF must be a date as YYYY-MM-DD.');
  const db = connectDb();
  const hh = await householdId(db);
  const owners = must(
    await db.from('owners').select('id, display_name').eq('household_id', hh),
    'owners',
  ) as { id: string; display_name: string }[];
  const owner = owners.find((o) => o.display_name.toLowerCase() === person.toLowerCase());
  if (!owner) throw new Error('No such person on file.');
  const hits = must(
    await db
      .from('assets')
      .select('id, nickname')
      .eq('household_id', hh)
      .eq('owner_id', owner.id)
      .eq('type', 'mutual_fund')
      .eq('nickname', name),
    'assets',
  ) as { id: string; nickname: string }[];
  if (hits.length !== 1)
    throw new Error(`Expected one fund named "${name}", found ${hits.length}.`);
  const fund = hits[0]!;
  const lines = must(
    await db
      .from('mf_transactions')
      .select('txn_on, units')
      .eq('asset_id', fund.id)
      .lte('txn_on', asOf),
    'mf_transactions',
  ) as { txn_on: string; units: number }[];
  const byLines = lines.reduce((s, l) => s + Number(l.units), 0);
  const pos = must(
    await db
      .from('mf_positions')
      .select('units, units_as_of')
      .eq('asset_id', fund.id)
      .eq('household_id', hh),
    'mf_positions',
  ) as { units: number | null; units_as_of: string | null }[];
  if (pos.length !== 1) throw new Error('The fund has no scheme details row.');
  const cur = pos[0]!;
  console.log(`Fund: ${fund.nickname} (${owner.display_name}), mode ${write ? 'apply' : 'plan'}`);
  console.log(`Recorded now: ${cur.units ?? 'none'} units as of ${cur.units_as_of ?? 'no date'}`);
  console.log(
    `Statement: ${units} units on ${asOf}; the ${lines.length} lines up to then add to ${byLines.toFixed(4)}`,
  );
  if (Math.abs(byLines - units) > TOLERANCE)
    throw new Error('The statement count does not agree with the lines: nothing written.');
  if (cur.units_as_of && cur.units_as_of > asOf)
    console.log(
      `A later count is on file (${cur.units_as_of}); it is replaced because it disagrees with the lines.`,
    );
  if (!write) {
    console.log('Plan only: nothing was written');
    return;
  }
  must(
    await db
      .from('mf_positions')
      .update({ units, units_as_of: asOf })
      .eq('asset_id', fund.id)
      .eq('household_id', hh),
    'mf_positions',
  );
  console.log('Written: the fund now records the statement count.');
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
