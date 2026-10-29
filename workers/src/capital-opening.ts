/* eslint-disable no-console */
/**
 * Sets the day your own money and profit are measured from (Settings > "Measure your own money and profit from"; Actions > Capital
 * opening, run by hand). Only that one setting changes; every other setting is kept as it is. An empty DATE clears it, so the app
 * picks the first day every kind of holding has a value. MODE=plan writes nothing. Prints dates only.
 */
import { configFromJson } from '@fwos/core';
import { connectDb, householdId, must } from './shared';

async function main() {
  const write = process.env.MODE === 'apply';
  const date = (process.env.DATE ?? '').trim();
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date))
    throw new Error('DATE must be YYYY-MM-DD or empty.');
  const db = connectDb();
  const hh = await householdId(db);
  const rows = must(
    await db.from('household_config').select('config').eq('household_id', hh),
    'household configuration',
  ) as { config: Record<string, unknown> | null }[];
  const prior = rows[0]?.config ?? {};
  const before = configFromJson(prior).capital.openingDate;
  const capital = {
    ...((prior.capital as Record<string, unknown> | undefined) ?? {}),
    openingDate: date,
  };
  const doc = { ...prior, capital };
  if (configFromJson(doc).capital.openingDate !== date)
    throw new Error('The date was not accepted.');
  console.log(
    `Opening day: ${before || 'not set (picked by the app)'} → ${date || 'not set (picked by the app)'}, mode ${write ? 'apply' : 'plan'}`,
  );
  if (!write) {
    console.log('Plan only: nothing was written');
    return;
  }
  must(
    await db
      .from('household_config')
      .upsert({ household_id: hh, config: doc, updated_at: new Date().toISOString() }),
    'household configuration',
  );
  console.log('Written.');
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
