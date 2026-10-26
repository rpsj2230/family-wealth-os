/* eslint-disable no-console */
/**
 * Weekly: reads each rate page listed in Settings with your AI key and refreshes the stored offers.
 * Offers you typed yourself are never overwritten. A page that cannot be read leaves the previous offers in place and
 * records why, so nothing silently disappears.
 */
import { createClient } from '@supabase/supabase-js';
import { sameBank } from '@fwos/core';
import {
  buildRatesRequest,
  casPdfText,
  htmlToText,
  isPdf,
  parseRatesResponse,
  planSync,
  rateDocsFor,
  resolveModel,
  type AiProvider,
  type CorrectionReason,
  type StoredOffer,
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

let model: string | null = null;

const AGENT = 'family-wealth-os/1.0 (personal use)';
const hostOf = (u: string) => {
  try {
    return new URL(u).host;
  } catch {
    return 'bank page';
  }
};

/** One openly published page or PDF as text. A page that answers with an error or has no readable text is reported, not worked around. */
async function readDoc(url: string, max = 30_000): Promise<string> {
  const r = await fetch(url, {
    headers: { 'user-agent': AGENT },
    redirect: 'follow',
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) throw new Error(`answered ${r.status}`);
  if (isPdf(r.headers.get('content-type'), url)) {
    const text = (await casPdfText(new Uint8Array(await r.arrayBuffer()))).trim();
    if (text.length < 200) throw new Error('the PDF had almost no readable text');
    return text.slice(0, max);
  }
  const text = htmlToText(await r.text(), max);
  if (text.length < 200)
    throw new Error('the page had almost no readable text (it may need a browser to load)');
  return text;
}

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
        'Not read: no AI key is saved. Add a free Groq or Gemini key in Settings > Bank emails and AI.';
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
        // providers retire models without notice (a retired name answers 404), so ask which ones this key can use
        model ??=
          (await resolveModel(
            (u, i) => fetch(u, { ...i, signal: AbortSignal.timeout(20_000) }),
            ai.ai_provider,
            ai.ai_api_key,
          )) ?? '';
        const req = buildRatesRequest(
          ai.ai_provider,
          ai.ai_api_key,
          bankName,
          text,
          model || undefined,
          forThisBank,
        );
        const res = await fetch(req.url, { ...req.init, signal: AbortSignal.timeout(60_000) });
        if (!res.ok) {
          const body = (await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200);
          throw new Error(
            `AI service answered ${res.status}${model ? ` for model ${model}` : ''}: ${body}`,
          );
        }
        const read = parseRatesResponse(ai.ai_provider, await res.json(), bankName);
        if (read.length === 0) throw new Error('no rates could be read from the page');

        const all = await db
          .from('rate_offers')
          .select(
            'id, bank, product, account_kind, tenure_from_months, tenure_to_months, balance_from, balance_to, rate, source_kind, ai_rate, correction_reason, misread_count',
          )
          .eq('household_id', household);
        const existing: StoredOffer[] = ((all.data ?? []) as Record<string, unknown>[])
          .filter((e) => sameBank(e.bank as string, bankName))
          .map((e) => ({
            id: e.id as string,
            bank: e.bank as string,
            product: e.product as 'savings' | 'fd',
            accountKind: e.account_kind as string,
            tenureFromMonths: e.tenure_from_months as number,
            tenureToMonths: e.tenure_to_months as number,
            balanceFrom: e.balance_from === null ? null : Number(e.balance_from),
            balanceTo: e.balance_to === null ? null : Number(e.balance_to),
            rate: Number(e.rate),
            sourceKind: e.source_kind as 'manual' | 'ai',
            aiRate: e.ai_rate === null ? null : Number(e.ai_rate),
            correctionReason: (e.correction_reason as CorrectionReason | null) ?? null,
            misreadCount: Number(e.misread_count ?? 0),
          }));
        // one spelling of the bank name: the one already stored, else the name of your account's bank
        const canon = existing[0]?.bank ?? heldNames.find((n) => sameBank(n, bankName)) ?? bankName;
        const fetched = read.map((o) => ({ ...o, bank: canon }));
        // a comparison page may cover only part of what the bank offers, so it never removes a rate that is not on it
        const plan = planSync(existing, fetched, { replaceAbsent: !thirdParty });
        const must = (r: { error: { message: string } | null }) => {
          if (r.error) throw new Error(r.error.message);
        };
        const touch = {
          checked_on: today,
          source_url: used[0],
          source_note: thirdParty
            ? `Reference only, from ${[...new Set(used.map(hostOf))].join(' and ')} (third party: the bank's own page cannot be read by a program; check the date)`
            : `Read from ${[...new Set(used.map(hostOf))].join(' and ')}`,
        };
        if (plan.insert.length)
          must(
            await db.from('rate_offers').insert(
              plan.insert.map((o) => ({
                household_id: household,
                bank: o.bank,
                product: o.product,
                account_kind: o.accountKind,
                tenure_from_months: o.tenureFromMonths,
                tenure_to_months: o.tenureToMonths,
                balance_from: o.balanceFrom,
                balance_to: o.balanceTo,
                rate: o.rate,
                conditions: o.conditions,
                source_kind: 'ai',
                ...touch,
              })),
            ),
          );
        for (const c of plan.change)
          must(
            await db
              .from('rate_offers')
              .update({ rate: c.to, ...touch })
              .eq('id', c.id),
          );
        if (plan.confirm.length)
          must(await db.from('rate_offers').update(touch).in('id', plan.confirm));
        if (plan.remove.length) must(await db.from('rate_offers').delete().in('id', plan.remove));
        for (const d of plan.pageDiffers)
          must(
            await db
              .from('rate_offers')
              .update({ page_rate: d.pageRate, page_seen_on: today })
              .eq('id', d.id),
          );
        for (const d of plan.pageMoved)
          must(
            await db
              .from('rate_offers')
              .update({ page_rate: d.pageRate, page_seen_on: today })
              .eq('id', d.id),
          );
        if (plan.pageAgrees.length)
          must(
            await db
              .from('rate_offers')
              .update({ page_rate: null, page_seen_on: null, checked_on: today })
              .in('id', plan.pageAgrees),
          );
        if (plan.resolved.length)
          must(
            await db
              .from('rate_offers')
              .update({
                source_kind: 'ai',
                ai_rate: null,
                correction_reason: null,
                corrected_on: null,
                misread_count: 0,
                page_rate: null,
                page_seen_on: null,
                ...touch,
              })
              .in('id', plan.resolved),
          );
        const known = new Set(
          (
            (
              await db
                .from('rate_hints')
                .select('hint')
                .eq('household_id', household)
                .eq('active', true)
            ).data ?? []
          ).map((h) => h.hint as string),
        );
        for (const m of plan.stillMisread) {
          const cur = existing.find((e) => e.id === m.id)!;
          must(
            await db
              .from('rate_offers')
              .update({
                misread_count: cur.misreadCount + 1,
                page_rate: m.wrong,
                page_seen_on: today,
                correction_reason: m.diagnosis.cause,
              })
              .eq('id', m.id),
          );
          if (!known.has(m.diagnosis.hint))
            must(
              await db.from('rate_hints').insert({
                household_id: household,
                bank: canon,
                cause: m.diagnosis.cause,
                hint: m.diagnosis.hint,
              }),
            );
        }
        const unchanged = plan.confirm.length;
        await note(
          `read ${fetched.length} rates: ${plan.insert.length} new, ${plan.change.length} changed, ${unchanged} unchanged` +
            (plan.remove.length ? `, ${plan.remove.length} no longer on the page` : '') +
            (plan.resolved.length
              ? `; ${plan.resolved.length} of your corrections now match the page`
              : '') +
            (plan.stillMisread.length
              ? `; ${plan.stillMisread.length} still read wrongly (rule saved for next time)`
              : '') +
            (plan.pageDiffers.length + plan.pageMoved.length
              ? `; ${plan.pageDiffers.length + plan.pageMoved.length} typed rates differ from the page`
              : ''),
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
