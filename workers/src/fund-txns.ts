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
  ) as {
    person: string;
    csv: string;
    /** answers to the import's questions, by item key: the option id (and its input), as the Import page sends them */
    choices?: Record<string, { option: string; input?: string | null }>;
  };
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
  const choices = new Map(
    Object.entries(input.choices ?? {}).map(([k, v]) => [
      k,
      { option: v.option, input: v.input ?? null },
    ]),
  );
  // the questions answered, and every item applied (the same as ticking all on the Import page)
  const first = await importFundCsv(db, hh, owner.id, parsed.rows, { today, apply: false });
  const keys = new Set(first.diff.items.map((i) => i.key));
  const res = write
    ? await importFundCsv(db, hh, owner.id, parsed.rows, {
        today,
        apply: true,
        select: { take: keys, seen: keys, choices },
      })
    : await importFundCsv(db, hh, owner.id, parsed.rows, {
        today,
        apply: false,
        ...(choices.size ? { select: { take: keys, seen: keys, choices } } : {}),
      });
  for (const n of res.notes) console.log(`Note: ${n}`);
  for (const i of res.diff.items)
    console.log(
      `- ${i.name}: ${i.kind}${i.why ? ` (${i.why})` : ''}; ${i.lines.newCount} new lines, ${i.lines.duplicateCount} already on file; units ${i.units ? `${i.units.before ?? '–'} → ${i.units.after}` : 'unchanged'}; invested ${i.invested ? `${i.invested.before ?? '–'} → ${i.invested.after}` : 'unchanged'}${i.value ? `; value ${Math.round(i.value.after)} on ${i.value.asOf}` : ''}`,
    );
  // the questions the import asks, with what it found for each possible fund
  for (const i of res.diff.items)
    for (const p of [i.prompt, i.sipPrompt].filter((x) => !!x))
      console.log(
        `  ? ${i.key}: ${p!.suggestion.found} ${p!.suggestion.suggest} ${p!.suggestion.why}\n${p!.candidates
          .map(
            (c) =>
              `    candidate ${c.name} (folio …${c.folioLast4 ?? '?'}, ${c.units ?? '?'} units, invested ${c.invested ?? '?'}, from ${c.startedOn ?? '?'}, ${c.status}; evidence ${
                Object.entries(c.evidence)
                  .filter(([, v]) => v)
                  .map(([k]) => k)
                  .join(' ') || 'none'
              })`,
          )
          .join(
            '\n',
          )}\n${p!.suggestion.options.map((o) => `    option ${o.id}: ${o.label}`).join('\n')}`,
      );
  if (res.report) console.log(`Applied: ${res.report.summary}`);
  else console.log('Plan only: nothing was written. Run again with mode "apply" to write it.');
}

main().catch((e: unknown) => {
  console.error('Fund transactions failed:', (e as Error).message);
  process.exit(1);
});
