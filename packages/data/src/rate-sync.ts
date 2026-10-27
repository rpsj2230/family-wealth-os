import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isThirdPartyNote, sameBank } from '@fwos/core';
import {
  buildRatesRequest,
  briefOf,
  callAi,
  cannotReadVerdict,
  gatherRateDocs,
  hostOf,
  NO_RATES_VERDICT,
  parseRatesResponse,
  planSync,
  PROVIDER_SHORT,
  type AiChain,
  type CorrectionReason,
  type DocKind,
  type DocLine,
  type ParsedOffer,
  type RateCheckStep,
  type StoredOffer,
} from '@fwos/ingest';

type Product = 'savings' | 'fd';
const ALL_PRODUCTS: readonly Product[] = ['savings', 'fd'];

export interface RatesSaved {
  /** one line saying what changed */
  summary: string;
  /** rates read from the page(s) and now on file */
  total: number;
  inserted: number;
  changed: number;
  unchanged: number;
  /** rates that were on file, read earlier (a comparison website among them), and are no longer on the page */
  removed: number;
  /** of those, rates that had been saved from comparison websites */
  replacedThirdParty: number;
}

/**
 * Stores rates read from a bank's own pages (or from text you pasted from them): new ones are added, changed ones updated, a rate you
 * typed is never overwritten, and a rate that was read wrongly before is noted so the reader is told next time. A rate read earlier
 * that is no longer on the pages is removed, but only for the products the pages that were read carry (a savings page that could not be
 * read never removes the savings rates). Rates once saved from a comparison website are read the same way as any other read rate, so
 * the bank's own figures replace them. Shared by the weekly job, the Sync page and the "paste the page" box.
 */
export async function saveRatesRead(args: {
  db: SupabaseClient;
  household: string;
  bank: string;
  read: ParsedOffer[];
  /** names of the banks where you hold something, to keep one spelling of each bank's name */
  heldNames: string[];
  today: string;
  /** the products the pages that were read carry (default both) */
  products?: readonly Product[];
  sourceUrl: string | undefined;
  /** what the "where from" line says */
  sourceNote: string;
}): Promise<RatesSaved> {
  const { db, household, read, heldNames, today } = args;
  const products = new Set<Product>(args.products ?? ALL_PRODUCTS);
  const bankName = args.bank;
  const all = await db
    .from('rate_offers')
    .select(
      'id, bank, product, account_kind, tenure_from_months, tenure_to_months, balance_from, balance_to, rate, source_kind, ai_rate, correction_reason, misread_count, source_note',
    )
    .eq('household_id', household);
  const rows = ((all.data ?? []) as Record<string, unknown>[]).filter((e) =>
    sameBank(e.bank as string, bankName),
  );
  const existing: StoredOffer[] = rows.map((e) => ({
    id: e.id as string,
    bank: e.bank as string,
    product: e.product as Product,
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
  const thirdParty = new Set(
    rows.filter((e) => isThirdPartyNote(e.source_note as string | null)).map((e) => e.id as string),
  );
  // one spelling of the bank name: the one already stored, else the name of your account's bank
  const canon = existing[0]?.bank ?? heldNames.find((n) => sameBank(n, bankName)) ?? bankName;
  const fetched = read.filter((o) => products.has(o.product)).map((o) => ({ ...o, bank: canon }));
  const plan = planSync(existing, fetched, { replaceAbsent: true });
  // a product whose pages were not read keeps what is on file
  const productOf = new Map(existing.map((e) => [e.id, e.product]));
  plan.remove = plan.remove.filter((id) => products.has(productOf.get(id)!));
  const must = (r: { error: { message: string } | null }) => {
    if (r.error) throw new Error(r.error.message);
  };
  const touch = {
    checked_on: today,
    source_url: args.sourceUrl,
    // the column holds at most 120 characters; a longer note must shorten, not fail the whole bank
    source_note:
      args.sourceNote.length > 120
        ? `${args.sourceNote.slice(0, 117).trimEnd()}…`
        : args.sourceNote,
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
  if (plan.confirm.length) must(await db.from('rate_offers').update(touch).in('id', plan.confirm));
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
      (await db.from('rate_hints').select('hint').eq('household_id', household).eq('active', true))
        .data ?? []
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
  const replacedThirdParty = [
    ...plan.change.map((c) => c.id),
    ...plan.confirm,
    ...plan.remove,
  ].filter((id) => thirdParty.has(id)).length;
  const summary =
    `${fetched.length} rates saved: ${plan.insert.length} new, ${plan.change.length} changed, ${unchanged} unchanged` +
    (plan.remove.length ? `, ${plan.remove.length} no longer on the page` : '') +
    (replacedThirdParty
      ? `; ${replacedThirdParty} from comparison websites replaced by the bank's own`
      : '') +
    (plan.resolved.length
      ? `; ${plan.resolved.length} of your corrections now match the page`
      : '') +
    (plan.stillMisread.length
      ? `; ${plan.stillMisread.length} still read wrongly (rule saved for next time)`
      : '') +
    (plan.pageDiffers.length + plan.pageMoved.length
      ? `; ${plan.pageDiffers.length + plan.pageMoved.length} typed rates differ from the page`
      : '');
  return {
    summary,
    total: fetched.length,
    inserted: plan.insert.length,
    changed: plan.change.length,
    unchanged,
    removed: plan.remove.length,
    replacedThirdParty,
  };
}

/** What a page's kind means for the products it carries. */
export const productsOfKinds = (kinds: readonly DocKind[]): Product[] => {
  const out = new Set<Product>();
  for (const k of kinds) {
    if (k !== 'fd') out.add('savings');
    if (k !== 'savings') out.add('fd');
  }
  return [...out];
};

const NO_KEY_REASON =
  'Not read: no AI key is switched on. Add an Anthropic, OpenRouter, Groq or Gemini key, or switch one on, in Settings > Connections.';

/** "interest-rates.pdf" or the host: a document's name in the "where from" note. */
const docName = (url: string): string => {
  try {
    const u = new URL(url);
    const last = u.pathname.split('/').filter(Boolean).pop();
    return last ? decodeURIComponent(last) : u.host;
  } catch {
    return url;
  }
};

/** A page saved for the bank in Settings. */
export interface SyncSource {
  id: string;
  url: string;
  /** which rates the page carries (default both) */
  kind: DocKind;
  pageHash: string | null;
  readOn: string | null;
}

export interface SyncBankResult {
  /** synced: rates saved; unchanged: nothing new, confirmed as checked; cannot: not read (the rates on file are unchanged); no_key: no AI key is switched on */
  status: 'synced' | 'unchanged' | 'cannot' | 'no_key';
  /** one plain sentence, also written to the page rows' last result */
  message: string;
  saved: RatesSaved | null;
  /** every document read or tried, in order */
  docs: DocLine[];
  steps: RateCheckStep[];
  ms: number;
}

/**
 * Syncs one bank, the one way for the weekly job and the Sync page: reads the pages saved for the bank together with the bank's own
 * published documents, skips the AI when the text (with the corrections and the ceiling that go with it) is the same as when it was
 * last read, otherwise asks the AI keys in their order, and stores what was read. Rates you typed yourself are never overwritten. A
 * bank whose pages cannot be read keeps the rates on file and records why, in plain words. Every result is written to the bank's rows
 * in `rate_sources` (last run, result, the documents tried, the page hash). Never throws: a failure is the result.
 *
 * `db` is the service-role client in the job and the signed-in member's client on the Sync page (row level security applies); both
 * work the same.
 */
export async function syncBankRates(args: {
  db: SupabaseClient;
  household: string;
  bank: string;
  /** every page saved for the bank */
  sources: SyncSource[];
  /** the AI keys in their order; null or empty: no key is switched on */
  ai: AiChain | null;
  settings: { maxAmount: number | undefined; staleDays: number };
  today: string;
  /** names of the banks where you hold something; looked up when not given */
  heldNames?: string[];
  /** milliseconds allowed for each page */
  pageMs?: number;
  /** called for each line of the job's log */
  log?: (line: string) => void;
}): Promise<SyncBankResult> {
  const t0 = Date.now();
  const { db, household, bank, sources, ai, settings, today } = args;
  const ids = sources.map((s) => s.id);
  let docs: DocLine[] = [];
  let steps: RateCheckStep[] = [];
  const finish = async (
    status: SyncBankResult['status'],
    message: string,
    saved: RatesSaved | null,
    extra: Record<string, unknown> = {},
  ): Promise<SyncBankResult> => {
    const result = message.slice(0, 300);
    let recorded: boolean;
    try {
      const upd = await db
        .from('rate_sources')
        .update({
          last_run_on: today,
          last_result: result,
          last_docs: docs.slice(0, 12).map((d) => ({
            url: d.url.slice(0, 400),
            kind: d.kind,
            ok: d.ok,
            chars: d.chars,
            note: d.note.slice(0, 160),
            via: d.via ? d.via.slice(0, 400) : null,
            effectiveOn: d.effectiveOn,
          })),
          ...extra,
        })
        .in('id', ids);
      recorded = !upd.error;
    } catch {
      recorded = false;
    }
    args.log?.(`${bank}: ${result}`);
    return {
      status,
      message: recorded ? result : `${result} (the result could not be recorded)`,
      saved,
      docs,
      steps,
      ms: Date.now() - t0,
    };
  };

  try {
    if (!ai || ai.empty) return await finish('no_key', NO_KEY_REASON, null);

    const g = await gatherRateDocs({
      bank,
      saved: sources.map((s) => ({ url: s.url, kind: s.kind })),
      ...(args.pageMs ? { pageMs: args.pageMs } : {}),
    });
    docs = g.lines;
    steps = g.steps;
    // a bank's own pages that cannot be read: the rates on file stay, and the reason is said plainly. Nothing else is tried.
    if (g.parts.length === 0) return await finish('cannot', cannotReadVerdict(bank, g), null);

    // rules written when you corrected this bank's rates earlier are passed to the reader
    const hintRows = await db
      .from('rate_hints')
      .select('bank, hint')
      .eq('household_id', household)
      .eq('active', true)
      .order('created_on', { ascending: false })
      .limit(60);
    const hints = ((hintRows.data ?? []) as { bank: string; hint: string }[])
      .filter((h) => sameBank(h.bank, bank))
      .map((h) => h.hint);
    const text = g.parts.join('\n\n');
    const products = productsOfKinds(g.used.map((u) => u.kind));
    // a page whose text (with the corrections and the ceiling that go with it) is the same as when it was last read needs no AI call:
    // its rates are confirmed as checked today. It is read again anyway after half the time a rate counts as fresh.
    const hash = createHash('sha256')
      .update(JSON.stringify({ v: 2, text, hints, maxAmount: settings.maxAmount }))
      .digest('hex');
    const prior = sources.find((s) => s.pageHash) ?? null;
    const readOn = prior?.readOn ?? null;
    const sameAsBefore =
      prior?.pageHash === hash &&
      readOn !== null &&
      (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${readOn}T00:00:00Z`)) / 86_400_000 <
        Math.max(1, Math.floor(settings.staleDays / 2));
    if (sameAsBefore) {
      const stored = await db
        .from('rate_offers')
        .select('id, bank, source_note')
        .eq('household_id', household)
        .eq('source_kind', 'ai');
      if (stored.error) throw new Error(`stored rates: ${stored.error.message}`);
      const rows = (
        (stored.data ?? []) as { id: string; bank: string; source_note: string | null }[]
      ).filter((o) => sameBank(o.bank, bank));
      // rates saved from comparison websites are never "confirmed" by the bank's page: they are replaced
      const own = rows.filter((o) => !isThirdPartyNote(o.source_note)).map((o) => o.id);
      if (own.length > 0 && own.length === rows.length) {
        const upd = await db.from('rate_offers').update({ checked_on: today }).in('id', own);
        if (upd.error) throw new Error(`confirm rates: ${upd.error.message}`);
        return await finish(
          'unchanged',
          `Unchanged since ${readOn}: not read again (no AI cost); ${own.length} rates confirmed as checked today.`,
          null,
        );
      }
    }

    // each key's model is checked when it is first needed (providers retire models without notice)
    const res = await callAi(ai, {
      purpose: 'rates_refresh',
      build: (provider, key, model) =>
        buildRatesRequest(provider, key, bank, text, model, hints, settings.maxAmount),
      parse: (provider, json) => {
        const offers = parseRatesResponse(provider, json, bank, { maxAmount: settings.maxAmount });
        return offers.length > 0 ? offers : null;
      },
    });
    for (const a of res.attempts) steps.push({ ok: false, text: a.reason });
    if (!res.ok) {
      // every key answered but none found a rate: the page is the problem, not the keys
      if (res.attempts.length > 0 && res.attempts.every((a) => a.status === 200))
        return await finish('cannot', NO_RATES_VERDICT, null);
      return await finish('cannot', `could not refresh: AI service: ${res.brief}`, null);
    }

    const heldNames = args.heldNames ?? (await heldBankNames(db, household));
    const names = g.used.map((u) => docName(u.url));
    const hosts = [...new Set(g.used.map((u) => hostOf(u.url)))].join(' and ');
    const saved = await saveRatesRead({
      db,
      household,
      bank,
      read: res.value,
      heldNames,
      today,
      products,
      sourceUrl: g.used[0]?.url,
      sourceNote: `Read from ${hosts}: ${[...new Set(names)].join(', ')}`,
    });
    const message =
      res.attempts.length > 0
        ? `${saved.summary}; read by ${PROVIDER_SHORT[res.provider]} after ${briefOf(res.attempts)}`
        : saved.summary;
    return await finish('synced', message, saved, { page_hash: hash, read_on: today });
  } catch (e) {
    return await finish('cannot', `could not refresh: ${(e as Error).message}`, null);
  }
}

/** Names of the banks where you hold a savings account or deposit, to keep one spelling of each bank's name. */
export async function heldBankNames(db: SupabaseClient, household: string): Promise<string[]> {
  const held = await db
    .from('assets')
    .select('institution_id, institutions(name)')
    .eq('household_id', household)
    .in('type', ['bank_account', 'fixed_deposit'])
    .in('status', ['active', 'stopped']);
  return [
    ...new Set(
      ((held.data ?? []) as unknown as { institutions: { name: string } | null }[])
        .map((a) => a.institutions?.name)
        .filter((n): n is string => !!n),
    ),
  ];
}
