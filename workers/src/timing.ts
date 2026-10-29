/* eslint-disable no-console */
/**
 * How long the data behind the pages takes to load (Actions > Page data timing). Each loader the pages call is run once against
 * the live database (read only), timed, and its database requests and rows are counted; the work done after the data arrives is
 * timed apart by running it again on what was loaded. The runner is far from the database, so the times are longer than on the
 * site; the request counts and the compute times are what to compare. Prints counts and times only.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  buildDigestInput,
  loadHarvestPositions,
  loadMoneyTrail,
  loadNeeds,
  loadPortfolioData,
  loadPositionInput,
  loadSettings,
  loadStatements,
} from '@fwos/data';
import { householdId, need } from './shared';

let requests = 0;
let rows = 0;
const counting: typeof fetch = async (input, init) => {
  requests++;
  const r = await fetch(input, init);
  const range = r.headers.get('content-range');
  const n = range
    ? Number(range.split('/')[0]!.split('-')[1]) - Number(range.split('-')[0]) + 1
    : 0;
  if (Number.isFinite(n) && n > 0) rows += n;
  return r;
};

async function time<T>(label: string, f: () => Promise<T>): Promise<T> {
  requests = 0;
  rows = 0;
  const t0 = performance.now();
  const out = await f();
  console.log(
    `${label.padEnd(34)} ${String(Math.round(performance.now() - t0)).padStart(6)} ms  ${String(requests).padStart(4)} requests  ${String(rows).padStart(6)} rows`,
  );
  return out;
}

async function main() {
  const db: SupabaseClient = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false },
    global: { fetch: counting },
  });
  const hh = await householdId(db);
  // one round trip, to tell the distance from the work
  await time('one small request (distance)', async () =>
    db.from('households').select('id').limit(1),
  );
  const loaded = await time('portfolio (most pages)', () =>
    loadPortfolioData(db, { householdId: hh }),
  );
  const { config } = await time('settings', () => loadSettings(db, hh));
  await time('statements (all lines)', () => loadStatements(db, hh));
  await time('money trail (given the portfolio)', () => loadMoneyTrail(db, hh, loaded));
  await time('position input (investments)', () =>
    loadPositionInput(db, loaded, { config, householdId: hh }),
  );
  await time('harvest positions (tax)', () => loadHarvestPositions(db, { householdId: hh }));
  await time('needed from you', () => loadNeeds(db, hh, { loaded, config }));
  await time('digest input (home and e-mail)', () =>
    buildDigestInput(db, {
      householdId: hh,
      date: new Date().toISOString().slice(0, 10),
      householdName: 'Household',
      appUrl: 'https://example.invalid',
    }),
  );
  console.log(
    `\nSizes: ${loaded.assetRows.length} holdings, ${loaded.obsRows.length} readings, ${loaded.fdRows.length} deposits.`,
  );
}

main().catch((e) => {
  console.error('Timing failed:', (e as Error).message);
  process.exit(1);
});
