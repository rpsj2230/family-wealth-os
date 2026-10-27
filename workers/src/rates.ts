/* eslint-disable no-console */
/**
 * Weekly: reads each rate page listed in Settings with your AI keys and refreshes the stored offers.
 * Offers you typed yourself are never overwritten. A page that cannot be read leaves the previous offers in place and
 * records why, so nothing silently disappears. The AI keys switched on are tried in their order (see @fwos/ingest `ai-chain`):
 * a key that fails is skipped for the next one, and a key that was refused is not asked again for the rest of the run.
 */
import { createClient } from '@supabase/supabase-js';
import { sameBank } from '@fwos/core';
import { aiChainFor, loadSettings, saveRatesRead } from '@fwos/data';
import {
  buildRatesRequest,
  briefOf,
  callAi,
  parseRatesResponse,
  rateDocsFor,
  readRateDoc,
  hostOf,
  PROVIDER_SHORT,
  type AiAttempt,
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

const logAiFailure = (a: AiAttempt) =>
  console.log(`AI: ${a.brief}${a.detail ? ` - ${a.detail}` : ''}`);
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
    // rates that apply only above the most you would put with one bank are not read
    const maxAmount = (await loadSettings(db, household)).config.rates.maxAmount;
    // one chain for the whole run, so a key that is refused is skipped for every page after it
    const ai = await aiChainFor(db, household, 'service', {
      limits: { callMs: 30_000, tries: 3 },
      onFailure: logAiFailure,
    });
    const sources = await db
      .from('rate_sources')
      .select('id, bank, url')
      .eq('household_id', household)
      .eq('enabled', true);
    if (!sources.data?.length) {
      console.log('No rate pages are listed in Settings; nothing to refresh.');
      continue;
    }
    if (ai.empty) {
      // say so where it can be seen: on each page's line in Settings and on the Rates page, and as a warning on this run
      const why =
        'Not read: no AI key is switched on. Add an Anthropic, OpenRouter, Groq or Gemini key, or switch one on, in Settings > Connections.';
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
        // each key's model is checked when it is first needed (providers retire models without notice)
        const ask = () => {
          const text = parts.join('\n\n');
          return callAi(ai, {
            build: (provider, key, model) =>
              buildRatesRequest(provider, key, bankName, text, model, forThisBank, maxAmount),
            parse: (provider, json) => {
              const offers = parseRatesResponse(provider, json, bankName, { maxAmount });
              return offers.length > 0 ? offers : null;
            },
          });
        };
        // every key answered but none found a rate: the page is the problem, not the keys
        const pageHadNoRates = (r: Awaited<ReturnType<typeof ask>>) =>
          !r.ok && r.attempts.length > 0 && r.attempts.every((a) => a.status === 200);
        let res = await ask();
        // a bank page that loads but builds its table with a script has text and no rates: then the public comparison pages are tried
        if (pageHadNoRates(res) && !thirdParty && docs.reference.length > 0) {
          parts.length = 0;
          used.length = 0;
          for (const d of docs.reference)
            thirdParty = (await add(d.url, d.label, 15_000)) || thirdParty;
          if (parts.length > 0) res = await ask();
        }
        if (!res.ok) {
          if (pageHadNoRates(res))
            throw new Error(
              `no rates could be read from the page${problems.length ? ` (${problems.join('; ')})` : ''}`,
            );
          throw new Error(`AI service: ${res.brief}`);
        }
        const read = res.value;

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
        await note(
          res.attempts.length > 0
            ? `${summary}; read by ${PROVIDER_SHORT[res.provider]} after ${briefOf(res.attempts)}`
            : summary,
        );
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
