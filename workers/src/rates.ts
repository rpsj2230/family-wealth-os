/* eslint-disable no-console */
/**
 * Weekly: reads each bank's rate pages listed in Settings (and the bank's own published rate documents) with your AI keys and refreshes
 * the stored offers. The reading is the same function the Sync bank rates page uses (`syncBankRates` in @fwos/data), so the two cannot
 * differ. Offers you typed yourself are never overwritten. A bank whose pages cannot be read keeps its previous offers and the reason is
 * recorded in plain words, so nothing silently disappears. Rates are only ever read from the bank's own pages. The AI keys switched on
 * are tried in their order (see @fwos/ingest `ai-chain`): a key that fails is skipped for the next one, and a key that was refused is
 * not asked again for the rest of the run.
 */
import { createClient } from '@supabase/supabase-js';
import { sameBank } from '@fwos/core';
import {
  aiChainFor,
  heldBankNames,
  loadSettings,
  syncBankRates,
  type SyncSource,
} from '@fwos/data';
import { isDocKind, type AiAttempt } from '@fwos/ingest';

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
const today = new Date().toISOString().slice(0, 10);

const logAiFailure = (a: AiAttempt) =>
  console.log(`AI: ${a.brief}${a.detail ? ` - ${a.detail}` : ''}`);
const startedAt = Date.now();
/** the workflow is stopped after 15 minutes; stop starting new banks after 11 */
const BUDGET_MS = 11 * 60_000;

interface Row {
  id: string;
  bank: string;
  url: string;
  kind: string | null;
  page_hash: string | null;
  read_on: string | null;
}

async function main() {
  const hh = await db.from('households').select('id');
  if (hh.error) throw new Error(hh.error.message);
  for (const h of hh.data ?? []) {
    const household = h.id as string;
    // rates that apply only above the most you would put with one bank are not read
    const rateCfg = (await loadSettings(db, household)).config.rates;
    // one chain for the whole run, so a key that is refused is skipped for every bank after it
    const ai = await aiChainFor(db, household, 'service', {
      limits: { callMs: 30_000, tries: 3 },
      onFailure: logAiFailure,
    });
    const listed = await db
      .from('rate_sources')
      .select('id, bank, url, kind, page_hash, read_on')
      .eq('household_id', household)
      .eq('enabled', true)
      .order('bank');
    const rows = (listed.data ?? []) as Row[];
    if (!rows.length) {
      console.log('No rate pages are listed in Settings; nothing to refresh.');
      continue;
    }
    // a bank can have several pages (savings on one, deposits on another): they are read together
    const banks: { bank: string; rows: Row[] }[] = [];
    for (const r of rows) {
      const g = banks.find((b) => sameBank(b.bank, r.bank));
      if (g) g.rows.push(r);
      else banks.push({ bank: r.bank, rows: [r] });
    }
    const heldNames = await heldBankNames(db, household);
    for (const b of banks) {
      const sources: SyncSource[] = b.rows.map((r) => ({
        id: r.id,
        url: r.url,
        kind: isDocKind(r.kind) ? r.kind : 'both',
        pageHash: r.page_hash,
        readOn: r.read_on,
      }));
      // the job has a fixed time allowance: a bank not reached in time keeps its previous rates and is tried at the next run
      if (Date.now() - startedAt > BUDGET_MS) {
        await db
          .from('rate_sources')
          .update({
            last_run_on: today,
            last_result: 'Not reached this run (time ran out). It is tried again at the next run.',
          })
          .in(
            'id',
            sources.map((s) => s.id),
          );
        console.log(`${b.bank}: not reached, time ran out`);
        continue;
      }
      // no AI key is switched on: say so on every bank (shown in Settings, on the Rates page and on the Sync page) and as a warning
      const r = await syncBankRates({
        db,
        household,
        bank: b.bank,
        sources,
        ai,
        settings: { maxAmount: rateCfg.maxAmount, staleDays: rateCfg.staleDays },
        today,
        heldNames,
        log: (line) => console.log(line),
      });
      if (r.status === 'no_key') console.log(`::warning::${r.message}`);
    }
  }
}

main().catch((e) => {
  console.error('Rates job failed:', (e as Error).message);
  process.exit(1);
});
