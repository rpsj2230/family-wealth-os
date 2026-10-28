/* eslint-disable no-console */
/**
 * Diary notes into the history (run by hand: Actions > Diary notes). The notes arrive as the run's input (DIARY_B64: base64 of the JSON
 * below), never from the repository. MODE=plan prints what importing would do and writes nothing; MODE=apply writes it through the
 * same importer as the monthly tabs (history.ts, history-import.ts), so accounts and deposits on file are matched, a value on file is
 * never overwritten and running it twice adds nothing. It prints counts, bank names and initials only: no balances or numbers.
 *
 * Input: { notes: DiaryNote[], openings: DiaryOpening[] } (packages/ingest/src/diary-history.ts).
 */
import {
  alignDiary,
  applyHistoryMonth,
  bankOnFile,
  derivedOpenings,
  diaryWorkbook,
  planHistoryFrom,
  type DiaryNote,
  type DiaryOpening,
  type HistoryPlan,
} from '@fwos/ingest';
import {
  historyIo,
  loadHistoryExisting,
  loadSettings,
  pageAll,
  rebuildSnapshots,
} from '@fwos/data';
import type { SupabaseClient } from '@supabase/supabase-js';
import { connectDb, householdId, must, need } from './shared';

interface Input {
  notes: DiaryNote[];
  openings: DiaryOpening[];
}

const initial = (name: string | null | undefined) => (name ? `${name.slice(0, 2)}.` : '?');
const ISO = /^\d{4}-\d{2}-\d{2}$/;

function read(): Input {
  const raw = Buffer.from(need('DIARY_B64'), 'base64').toString('utf8');
  const input = JSON.parse(raw) as Input;
  if (!Array.isArray(input.notes) || input.notes.length === 0)
    throw new Error('No notes in the input.');
  for (const n of input.notes) {
    if (!ISO.test(n.asOf) || !/^[A-Z][a-z]{2} \d{4}$/.test(n.title) || !Array.isArray(n.lines))
      throw new Error('A note needs a title like "Jul 2020", a date and lines.');
    for (const l of n.lines) {
      if (!(typeof l.amount === 'number' && l.amount >= 0))
        throw new Error('A line has no amount.');
      if (l.kind === 'fd' && (!l.maturity || !ISO.test(l.maturity)))
        throw new Error('A deposit line has no maturity date.');
    }
  }
  return { notes: input.notes, openings: input.openings ?? [] };
}

async function plan(db: SupabaseClient, hh: string, notes: DiaryNote[]) {
  const [{ existing, owners }, settings] = await Promise.all([
    loadHistoryExisting(db, hh),
    loadSettings(db, hh),
  ]);
  const aligned = alignDiary(notes, existing.assets);
  const p = planHistoryFrom(diaryWorkbook(aligned.notes), {
    today: new Date().toISOString().slice(0, 10),
    ownerNames: owners,
    ...(owners[0] ? { defaultOwner: owners[0] } : {}),
    existing,
    startsAfterDays: settings.config.estimates.historyStartsAfterDays,
    identity: {
      jumpFactor: settings.config.estimates.historyJumpFactor,
      jumpFloor: settings.config.estimates.historyJumpFloor,
      tieRatio: settings.config.estimates.historyTieRatio,
    },
    latestIsHistory: true,
  });
  return { plan: p, aligned, existing };
}

function report(p: HistoryPlan, aligned: { renamedBanks: number; movedMaturities: number }) {
  console.log(
    `Banks written as on file: ${aligned.renamedBanks}; deposit maturities moved onto the deposit on file: ${aligned.movedMaturities}`,
  );
  for (const m of [...p.months].sort((a, b) => a.asOf.localeCompare(b.asOf))) {
    console.log(
      `- ${m.tab} (${m.asOf}, from ${m.asOfSource}): ${m.rowsRead} lines; matched ${m.matched}, added ${m.created}, not tied ${m.unmatched}; ` +
        `values new ${m.counts.new}, already on file ${m.counts.identical}, differing from file ${m.counts.conflicts} (kept as on file); ` +
        `${m.selectable ? 'will be imported' : 'NOT importable'}${m.doubt ? ` (doubt: ${m.doubt.kinds.join(', ')})` : ''}`,
    );
    for (const u of m.unmatchedRows)
      console.log(`    not tied: ${u.bank ?? '?'} ${u.label} (${initial(u.owner)}): ${u.reason}`);
    for (const w of m.warnings) console.log(`    note: ${w}`);
  }
  const added = p.historical.filter((h) => !h.skipReason);
  console.log(`Records not on file that will be added (ended, from the notes): ${added.length}`);
  for (const h of added)
    console.log(
      `    ${h.kind === 'fd' ? 'deposit' : 'account'} at ${h.bank ?? '?'} (${initial(h.ownerName)}), ${h.status} ${h.endedOn}${h.fd?.startEstimated ? ', start estimated' : ''}`,
    );
  const skipped = p.historical.filter((h) => h.skipReason);
  for (const h of skipped)
    console.log(
      `    not added: ${h.kind} at ${h.bank ?? '?'} (${initial(h.ownerName)}): ${h.skipReason}`,
    );
}

/** Sets the opening window of each account the notes date, unless a record on file shows it open earlier. */
async function openings(db: SupabaseClient, hh: string, list: DiaryOpening[], write: boolean) {
  const [owners, insts, assets, obs] = await Promise.all([
    db.from('owners').select('id, display_name').eq('household_id', hh),
    db.from('institutions').select('id, name').eq('household_id', hh),
    db
      .from('assets')
      .select('id, owner_id, institution_id, account_kind, type, opened_on')
      .eq('household_id', hh)
      .eq('type', 'bank_account'),
    pageAll<{ asset_id: string; as_of: string }>((from, to) =>
      db
        .from('observations')
        .select('asset_id, as_of')
        .eq('household_id', hh)
        .is('superseded_by', null)
        .order('as_of')
        .order('id')
        .range(from, to),
    ),
  ]);
  const ownerOf = new Map(
    must(owners, 'owners').map((o) => [String(o.display_name).toLowerCase(), o.id as string]),
  );
  const instRows = must(insts, 'institutions') as { id: string; name: string }[];
  const firstSeen = new Map<string, string>();
  for (const o of obs) if (!firstSeen.has(o.asset_id)) firstSeen.set(o.asset_id, o.as_of);
  console.log('Account opening dates:');
  const done = new Set<string>();
  for (const o of list) {
    const bank = bankOnFile(
      o.bank,
      instRows.map((i) => i.name),
    );
    const inst = instRows.find((i) => i.name === bank);
    const owner = ownerOf.get(o.person.toLowerCase());
    const cands = (must(assets, 'assets') as Record<string, unknown>[]).filter(
      (a) => a.owner_id === owner && a.institution_id === inst?.id,
    );
    const nre = cands.filter((a) => a.account_kind === 'NRE');
    const pick = nre.length === 1 ? nre[0] : cands.length === 1 ? cands[0] : undefined;
    const who = `${bank ?? o.bank} (${initial(o.person)})`;
    if (!pick) {
      console.log(
        `    ${who}: ${cands.length === 0 ? 'no account on file' : 'more than one account, left alone'}`,
      );
      continue;
    }
    const seen = firstSeen.get(pick.id as string);
    if (o.after && seen && seen <= o.after) {
      console.log(`    ${who}: a record on file is older than the notes allow, left alone`);
      continue;
    }
    const by = seen && seen < o.by ? seen : o.by;
    console.log(`    ${who}: opened ${o.after ? `after ${o.after} and ` : ''}by ${by}`);
    if (write)
      must(
        await db
          .from('assets')
          .update({
            opened_on: by,
            opened_after: o.after ?? null,
            opened_note: o.note.slice(0, 200),
          })
          .eq('id', pick.id as string)
          .eq('household_id', hh)
          .select('id'),
        'set opening',
      );
    done.add(pick.id as string);
  }
  // every other bank account: opened by its first record, after the last full snapshot without it
  const derived = derivedOpenings(obs.map((o) => ({ assetId: o.asset_id, asOf: o.as_of })));
  const instName = new Map(instRows.map((i) => [i.id, i.name]));
  const nameOf = new Map(
    must(owners, 'owners').map((o) => [o.id as string, o.display_name as string]),
  );
  let dated = 0;
  for (const a of must(assets, 'assets') as Record<string, unknown>[]) {
    const id = a.id as string;
    if (done.has(id) || a.opened_on) continue;
    const w = derived.get(id);
    if (!w) continue;
    dated++;
    console.log(
      `    ${instName.get(a.institution_id as string) ?? '?'} (${initial(nameOf.get(a.owner_id as string))}): from the records, opened ${w.after ? `after ${w.after} and ` : ''}by ${w.by}`,
    );
    if (write)
      must(
        await db
          .from('assets')
          .update({
            opened_on: w.by,
            opened_after: w.after,
            opened_note: w.after
              ? 'First recorded then; not in the records of the snapshot before'
              : 'First recorded then; in the earliest records, so it may be older',
          })
          .eq('id', id)
          .eq('household_id', hh)
          .select('id'),
        'set opening',
      );
  }
  console.log(`    ${dated} more accounts dated from the records`);
}

async function main() {
  const input = read();
  const mode = process.env.MODE === 'apply' ? 'apply' : 'plan';
  const db = connectDb();
  const hh = await householdId(db);
  const first = await plan(db, hh, input.notes);
  console.log(`Diary notes: ${input.notes.length} notes, mode ${mode}`);
  report(first.plan, first.aligned);
  await openings(db, hh, input.openings, false);
  if (mode !== 'apply') {
    console.log('Plan only: nothing was written. Run again with mode "apply" to write it.');
    return;
  }
  // one note at a time, oldest first, planning again each time so a record added for one note is matched in the next
  const order = [...first.plan.months]
    .sort((a, b) => a.asOf.localeCompare(b.asOf))
    .map((m) => m.tab);
  let failed = 0;
  for (const tab of order) {
    const { plan: p } = await plan(db, hh, input.notes);
    const m = p.months.find((x) => x.tab === tab);
    if (!m?.selectable) {
      console.log(`${tab}: not importable, skipped`);
      continue;
    }
    const r = await applyHistoryMonth(p, tab, {}, historyIo(db, hh));
    console.log(
      `${tab}: added ${r.addedAssets} records, ${r.observations} values, ${r.identical} already on file, ${r.conflictsKept} kept as on file${r.errors.length ? `; ${r.errors.length} problems` : ''}`,
    );
    for (const e of r.errors) console.log(`    problem: ${e.replace(/\d[\d,.]{3,}/g, '…')}`);
    if (!r.ok) failed++;
  }
  await openings(db, hh, input.openings, true);
  const rb = await rebuildSnapshots(db, hh);
  console.log(
    rb.ok
      ? `Net-worth history rebuilt: ${rb.written} month ends written of ${rb.planned} planned (${rb.keptRecorded} kept as recorded on the day).`
      : `Net-worth history could not be rebuilt: ${rb.error ?? 'unknown'}`,
  );
  if (!rb.ok) failed++;
  if (failed) process.exit(1);
}

main().catch((e: unknown) => {
  console.error((e as Error).message);
  process.exit(1);
});
