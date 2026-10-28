/* eslint-disable no-console */
/**
 * Fund transactions sent by the household, imported by hand (Actions > Fund transactions). The lines arrive as the run's input
 * (FUND_B64: base64 of gzipped JSON { person, csv }, the csv in the layout the Import page reads: Date, Folio Number, Name of the
 * Fund, Order, Units, NAV, Current Nav, Amount (INR)), never from the repository. They go through the same comparison and the same
 * writes as Import > fund transactions (cas.ts importFundCsv): funds matched or added, lines, lots, invested amount, SIP and value.
 * MODE=plan writes nothing. Prints fund names, counts and totals only.
 */
import { gunzipSync } from 'node:zlib';
import { importFundCsv } from '@fwos/data';
import { parseTxnCsv } from '@fwos/ingest';
import { connectDb, householdId, must, need } from './shared';

async function main() {
  const input = JSON.parse(
    gunzipSync(Buffer.from(need('FUND_B64'), 'base64')).toString('utf8'),
  ) as { person: string; csv: string };
  const write = process.env.MODE === 'apply';
  const db = connectDb();
  const hh = await householdId(db);
  const owner = (
    must(await db.from('owners').select('id, display_name').eq('household_id', hh), 'owners') as {
      id: string;
      display_name: string;
    }[]
  ).find((o) => o.display_name.toLowerCase() === input.person.toLowerCase());
  if (!owner) throw new Error(`No one called ${input.person.slice(0, 2)}. is on file.`);
  const parsed = parseTxnCsv(input.csv);
  for (const w of parsed.warnings) console.log(`Note: ${w}`);
  console.log(`Lines read: ${parsed.rows.length}, mode ${write ? 'apply' : 'plan'}`);
  const today = new Date().toISOString().slice(0, 10);
  const res = await importFundCsv(db, hh, owner.id, parsed.rows, { today, apply: write });
  for (const n of res.notes) console.log(`Note: ${n}`);
  for (const i of res.diff.items)
    console.log(
      `- ${i.name}: ${i.kind}${i.why ? ` (${i.why})` : ''}; ${i.lines.newCount} new lines, ${i.lines.duplicateCount} already on file; units ${i.units ? `${i.units.before ?? '–'} → ${i.units.after}` : 'unchanged'}; invested ${i.invested ? `${i.invested.before ?? '–'} → ${i.invested.after}` : 'unchanged'}${i.value ? `; value ${Math.round(i.value.after)} on ${i.value.asOf}` : ''}`,
    );
  if (res.report) console.log(`Applied: ${res.report.summary}`);
  else console.log('Plan only: nothing was written. Run again with mode "apply" to write it.');
}

main().catch((e: unknown) => {
  console.error('Fund transactions failed:', (e as Error).message);
  process.exit(1);
});
