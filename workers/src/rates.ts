/* eslint-disable no-console */
/**
 * Weekly: reads each rate page listed in Settings with your AI key and refreshes the stored offers.
 * Offers you typed yourself are never overwritten. A page that cannot be read leaves the previous offers in place and
 * records why, so nothing silently disappears.
 */
import { createClient } from '@supabase/supabase-js';
import { sameBank } from '@fwos/core';
import { saveRatesRead } from '@fwos/data';
import {
  buildRatesRequest,
  parseRatesResponse,
  rateDocsFor,
  readRateDoc,
  hostOf,
  aiErrorHint,
  prepareAi,
  type AiRuntime,
  type AiProvider,
} from '@fwos/ingest';

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

let runtime: AiRuntime | null = null;
const startedAt = Date.now();
/** the workflow is stopped after 15 minutes; stop starting new pages after 11 */
const BUDGET_MS = 11 * 60_000;

const readDoc = (url: string, max?: number) => readRateDoc(url, max);

async function main() {
  const hh = await db.from('households').select('id');
  if (hh.error) throw new Error(hh.error.message);
  let failed = 0;
  for (const h of hh.data ?? []) {
    const household = h.id as string;
    const cfg = await db
      .from('integration_settings')
      .select('ai_provider, ai_api_key')
      .eq('household_id', household)
      .maybeSingle();
    const ai = cfg.data as { ai_provider: AiProvider | null; ai_api_key: string | null } | null;
    const sources = await db
      .from('rate_sources')
      .select('id, bank, url')
      .eq('household_id', household)
      .eq('enabled', true);
    if (!sources.data?.length) {
      console.log('No rate pages are listed in Settings; nothing to refresh.');
      continue;
    }
    if (!ai?.ai_provider || !ai.ai_api_key) {
      // say so where it can be seen: on each page's line in Settings and on the Rates page, and as a warning on this run
      const why =
        'Not read: no AI key is saved. Add an Anthropic, OpenRouter, Groq or Gemini key in Settings > Bank emails and AI.';
      await db
        .from('rate_sources')
        .update({ last_run_on: today, last_result: why })
        .eq('household_id', household)
        .eq('enabled', true);
      console.log(`::warning::${why}`);
      continue;
    }
    // names of the banks where you hold something, used to keep one spelling of each bank's name
    const held = await db
      .from('assets')
      .select('institution_id, institutions(name)')
      .eq('household_id', household)
      .in('type', ['bank_account', 'fixed_deposit'])
      .in('status', ['active', 'stopped']);
    const heldNames = [
      ...new Set(
        ((held.data ?? []) as unknown as { institutions: { name: string } | null }[])
          .map((a) => a.institutions?.name)
          .filter((n): n is string => !!n),
      ),
    ];
    for (const src of sources.data) {
      // the job has a fixed time allowance: a page not reached in time keeps its previous rates and is tried at the next run
      if (Date.now() - startedAt > BUDGET_MS) {
        await db
          .from('rate_sources')
          .update({
            last_run_on: today,
            last_result: 'Not reached this run (time ran out). It is tried again at the next run.',
          })
          .eq('id', src.id);
        console.log(`${src.bank}: not reached, time ran out`);
        continue;
      }
      const note = async (result: string) => {
        await db
          .from('rate_sources')
          .update({ last_run_on: today, last_result: result.slice(0, 300) })
          .eq('id', src.id);
        console.log(`${src.bank}: ${result}`);
      };
      try {
        const bankName = src.bank as string;
        // the page saved in Settings, plus the bank's own published rate sheets; public comparison pages only when nothing from the bank can be read
        const docs = rateDocsFor(bankName);
        const parts: string[] = [];
        const used: string[] = [];
        const problems: string[] = [];
        const add = async (url: string, label: string, max?: number) => {
          try {
            parts.push(`### ${label}\n${await readDoc(url, max)}`);
            used.push(url);
            return true;
          } catch (e) {
            problems.push(`${hostOf(url)} ${(e as Error).message}`);
            return false;
          }
        };
        let fromBank = await add(src.url as string, `${bankName}: page saved in Settings`);
        for (const d of docs.official) fromBank = (await add(d.url, d.label, 14_000)) || fromBank;
        let thirdParty = false;
        if (!fromBank)
          for (const d of docs.reference)
            thirdParty = (await add(d.url, d.label, 15_000)) || thirdParty;
        if (parts.length === 0)
          throw new Error(
            `no page could be read (${problems.join('; ')}). Paste the rates from your notes on the Rates page, or save another address for this bank.`,
          );
        const text = parts.join('\n\n');
        // rules written when you corrected this bank's rates earlier are passed to the reader
        const bankHints = await db
          .from('rate_hints')
          .select('bank, hint')
          .eq('household_id', household)
          .eq('active', true)
          .order('created_on', { ascending: false })
          .limit(60);
        const forThisBank = ((bankHints.data ?? []) as { bank: string; hint: string }[])
          .filter((h) => sameBank(h.bank, bankName))
          .map((h) => h.hint);
        // providers retire models without notice, so the model is checked first; OpenRouter's free models fall back one to the next
        runtime ??= await prepareAi(ai.ai_provider, ai.ai_api_key, { callMs: 30_000, tries: 3 });
        const model = runtime.model;
        const req = buildRatesRequest(
          ai.ai_provider,
          ai.ai_api_key,
          bankName,
          text,
          model || undefined,
          forThisBank,
        );
        const res = await runtime.call(req.url, req.init as unknown as Record<string, unknown>);
        if (!res.ok) {
          const body = (await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300);
          const hint = aiErrorHint(ai.ai_provider, res.status, body);
          throw new Error(
            `AI service answered ${res.status}${model ? ` for model ${model}` : ''}: ${body}${hint ? ` — ${hint}` : ''}`,
          );
        }
        const read = parseRatesResponse(ai.ai_provider, await res.json(), bankName);
        if (read.length === 0) throw new Error('no rates could be read from the page');

        const summary = await saveRatesRead({
          db,
          household,
          bank: bankName,
          read,
          heldNames,
          today,
          thirdParty,
          sourceUrl: used[0],
          sourceNote: thirdParty
            ? `Reference only, from ${[...new Set(used.map(hostOf))].join(' and ')} (third party: the bank's own page cannot be read by a program; check the date)`
            : `Read from ${[...new Set(used.map(hostOf))].join(' and ')}`,
        });
        await note(summary);
      } catch (e) {
        failed++;
        await note(`could not refresh: ${(e as Error).message}`);
      }
    }
  }
  if (failed > 0) process.exitCode = 0; // a page that cannot be read is reported in Settings, not as a failed job
}

main().catch((e) => {
  console.error('Rates job failed:', (e as Error).message);
  process.exit(1);
});
